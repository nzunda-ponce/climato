import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import {
  openSqlite,
  sqlitePath,
  type ApplicationDatabase,
  type DatabaseRecord,
} from "./database";
import { makeRecord, encodeState, unpack } from "./records";
import type { State } from "./store";
import { defaultRules, localDate } from "@/domain/types";
export const cacheBudget = () =>
  Math.max(8, Math.min(1024, Number(process.env.CLIMATO_CACHE_MAX_MB) || 128)) *
  1024 *
  1024;
const root = () => path.join(process.cwd(), "data");
async function exists(file: string) {
  try {
    await fs.access(file);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
// Originals are retained. Every insert is resumable and never overwrites an
// already committed database record. A renewable database lease prevents a
// second app process from reimporting deleted data during the initial switch.
export async function migrateLegacy(db: ApplicationDatabase) {
  const token = randomUUID();
  let acquired = false;
  for (let i = 0; i < 600; i++) {
    const status = await db.transaction(async (tx) => {
      if (await tx.get("system", "migration-v2-complete")) return "done";
      const old = await tx.get("system", "migration-lease");
      if (old && unpack<{ expires: number }>(old).expires > Date.now())
        return "busy";
      await tx.put(
        makeRecord("system", "migration-lease", {
          token,
          expires: Date.now() + 120000,
        }),
      );
      return "acquired";
    });
    if (status === "done") return;
    if (status === "acquired") {
      acquired = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!acquired)
    throw new Error(
      "La base está migrando en otro proceso. Se reintentará sin modificar los archivos originales.",
    );
  async function save(rows: DatabaseRecord[], progress?: [string, string]) {
    await db.transaction(async (tx) => {
      const lease = await tx.get("system", "migration-lease");
      if (!lease || unpack<{ token: string }>(lease).token !== token)
        throw new Error(
          "Otro proceso retomó la migración. Reintentá la operación.",
        );
      await tx.putMany(rows, true);
      if (progress)
        await tx.put(makeRecord("system", progress[0], progress[1]));
      await tx.put(
        makeRecord("system", "migration-lease", {
          token,
          expires: Date.now() + 120000,
        }),
      );
      await tx.prune(Date.now(), cacheBudget());
    });
  }
  try {
    const file = path.join(root(), "state.json");
    const legacy = (await db.legacyState()) as State | undefined;
    let localRows: DatabaseRecord[] = [];
    if (!legacy && db.kind === "postgresql" && (await exists(sqlitePath()))) {
      const local = await openSqlite();
      try {
        localRows = await local.read((tx) => tx.list());
      } finally {
        await local.close();
      }
      localRows = localRows.filter(
        (r) =>
          r.namespace !== "system" &&
          r.namespace !== "lease" &&
          (r.expiresAt === null || r.expiresAt > Date.now()),
      );
      for (let i = 0; i < localRows.length; i += 150)
        await save(localRows.slice(i, i + 150));
    }
    let state = legacy;
    if (!state && !localRows.length && (await exists(file)))
      state = JSON.parse(await fs.readFile(file, "utf8"));
    if (state) {
      if (
        !Array.isArray(state.pivots) ||
        !state.forecasts ||
        typeof state.forecasts !== "object"
      )
        throw new Error(
          "El estado local no es válido. Se conservó el original; no se inicializará una campaña vacía.",
        );
      state.rules = { ...defaultRules, ...state.rules };
      const rows = encodeState(state);
      for (let i = 0; i < rows.length; i += 150)
        await save(rows.slice(i, i + 150));
    }
    for (const directory of ["research", "long-range", "snapshots"]) {
      const folder = path.join(root(), directory);
      if (!(await exists(folder))) continue;
      const marker = await db.read((tx) =>
        tx.get("system", `migration-${directory}`),
      );
      const last = marker ? unpack<string>(marker) : "";
      const files = (await fs.readdir(folder))
        .sort()
        .filter(
          (name) =>
            name > last &&
            (directory === "snapshots"
              ? name.endsWith(".json")
              : name.endsWith(".json.gz")),
        );
      for (const name of files) {
        const raw = await fs.readFile(path.join(folder, name));
        let value: any;
        try {
          value = JSON.parse(
            directory === "snapshots"
              ? raw.toString()
              : gunzipSync(raw).toString(),
          );
        } catch (e) {
          // These are reproducible caches, never the authoritative campaign.
          // Keep the damaged original, skip it and let its provider redownload.
          if (
            !(e instanceof SyntaxError) &&
            (e as NodeJS.ErrnoException).code !== "Z_DATA_ERROR"
          )
            throw e;
          console.warn(
            "Migración: se omitió una caché dañada; se volverá a descargar.",
          );
          await save([], [`migration-${directory}`, name]);
          continue;
        }
        let row: DatabaseRecord;
        if (directory === "snapshots") {
          const fetched = Date.parse(value.fetchedAt);
          const pivotId = name.replace(
            /-(?:\d{13}|\d{4}-\d{2}-\d{2}.*)\.json$/,
            "",
          );
          if (
            !Number.isFinite(fetched) ||
            fetched + 14 * 86400000 <= Date.now()
          ) {
            await save([], [`migration-${directory}`, name]);
            continue;
          }
          row = makeRecord(
            "snapshot",
            `${pivotId}-${localDate(new Date(fetched))}`,
            value,
            {
              expiresAt: fetched + 14 * 86400000,
            },
          );
        } else
          row = makeRecord(
            `cache:${directory}`,
            name.replace(/\.json\.gz$/, ""),
            value,
            {
              expiresAt:
                directory === "research" && name.startsWith("ensemble-")
                  ? Date.now() + 7 * 86400000
                  : null,
            },
          );
        await save([row], [`migration-${directory}`, name]);
      }
    }
    await db.transaction(async (tx) => {
      await tx.put(
        makeRecord("system", "migration-v2-complete", {
          at: new Date().toISOString(),
        }),
      );
      await tx.put(makeRecord("system", "revision", randomUUID()));
      await tx.remove("system", "migration-lease");
    });
  } catch (e) {
    await db
      .transaction(async (tx) => {
        const row = await tx.get("system", "migration-lease");
        if (row && unpack<{ token: string }>(row).token === token)
          await tx.remove("system", "migration-lease");
      })
      .catch(() => {});
    throw e;
  }
}
