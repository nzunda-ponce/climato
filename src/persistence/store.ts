import { isReportServer } from "@/runtime/role";
import { randomUUID } from "node:crypto";
import {
  defaultRules,
  Pivot,
  Rules,
  WeatherForecast,
  localDate,
} from "@/domain/types";
import {
  cellKey,
  EnsembleAssessment,
  HistoricalClimate,
  Observation,
  rulesSignature,
} from "@/domain/evidence";
import type { SeasonalAssessment } from "@/domain/seasonal";
import {
  freezePredictions,
  ValidationArchive,
} from "@/domain/forecast-validation";
import { mergeHistory } from "@/domain/history-training";
import {
  openPostgres,
  openSqlite,
  ApplicationDatabase,
  DatabaseRecord,
  DatabaseTransaction,
  RecordQuery,
} from "./database";
import {
  archiveNamespaces,
  decodeState,
  encodeState,
  makeRecord,
  planningNamespaces,
  stateNamespaces,
  unpack,
} from "./records";
import { cacheBudget, migrateLegacy } from "./migrate";

export interface State {
  validationArchive?: ValidationArchive;
  pivots: Pivot[];
  rules: Rules;
  forecasts: Record<string, WeatherForecast>;
  ensembles?: Record<string, EnsembleAssessment>;
  ensembleFailures?: Record<string, { at: string; message: string }>;
  climate?: Record<string, HistoricalClimate>;
  observations?: Observation[];
  seasonal?: Record<string, SeasonalAssessment>;
}
const globalStore = globalThis as unknown as {
  climatoDatabase?: Promise<ApplicationDatabase>;
  climatoPlanningCache?: { revision: string; state: State };
};
let lastPrune = 0;
export async function getDatabase() {
  if (!globalStore.climatoDatabase)
    globalStore.climatoDatabase = (async () => {
      const reportOnly = isReportServer();
      if (reportOnly && !process.env.DATABASE_URL?.trim())
        throw new Error("El servidor de consulta requiere DATABASE_URL.");
      const db = process.env.DATABASE_URL?.trim()
        ? await openPostgres(undefined, {
            initialize: !reportOnly,
            readOnly: reportOnly,
          })
        : await openSqlite();
      try {
        if (reportOnly)
          return {
            ...db,
            transaction: async () => {
              throw new Error("La web de consulta no modifica datos.");
            },
          };
        await migrateLegacy(db);
        return db;
      } catch (e) {
        await db.close();
        throw e;
      }
    })().catch((e) => {
      delete globalStore.climatoDatabase;
      throw e;
    });
  return globalStore.climatoDatabase;
}
export async function closeDatabase() {
  const db = await globalStore.climatoDatabase;
  delete globalStore.climatoDatabase;
  delete globalStore.climatoPlanningCache;
  if (db) await db.close();
}
export interface ReadOptions {
  purpose?: "planning" | "full";
  validation?: boolean;
  namespaces?: string[];
}
export async function readState(options: ReadOptions = {}): Promise<State> {
  if (
    options.purpose === "planning" &&
    !options.validation &&
    !options.namespaces
  )
    return (await readPlanningSnapshot()).state;
  const db = await getDatabase();
  const namespaces =
    options.namespaces ??
    (options.purpose === "planning" ? planningNamespaces : stateNamespaces);
  return db.read(async (tx) => {
    const state = decodeState(
      await tx.list({
        namespaces: [
          ...namespaces,
          ...(options.validation ? archiveNamespaces : []),
        ],
      }),
    );
    return state;
  });
}
// Data and its revision must come from the same database snapshot.
export async function readPlanningSnapshot() {
  const db = await getDatabase();
  return db.read(async (tx) => {
    const revision = await tx.get("system", "revision");
    const cached = globalStore.climatoPlanningCache;
    let state: State;
    if (revision && cached?.revision === revision.hash)
      state = structuredClone(cached.state);
    else {
      state = decodeState(await tx.list({ namespaces: planningNamespaces }));
      if (revision)
        globalStore.climatoPlanningCache = {
          revision: revision.hash,
          state: structuredClone(state),
        };
    }
    return {
      state,
      revision: revision?.hash ?? null,
      sourceUpdatedAt: revision?.updatedAt ?? 0,
    };
  });
}
async function revision(tx: DatabaseTransaction) {
  await tx.put(makeRecord("system", "revision", randomUUID()));
}
export async function mutateState(
  fn: (state: State) => void | Promise<void>,
  options: { namespaces?: string[] } = {},
): Promise<void> {
  const db = await getDatabase();
  const namespaces = options.namespaces ?? stateNamespaces;
  await db.transaction(async (tx) => {
    const before = await tx.list({ namespaces });
    const state = decodeState(before);
    await fn(state);
    const encoded = encodeState(state),
      old = new Map(before.map((r) => [`${r.namespace}\0${r.key}`, r]));
    const allowed = new Set(namespaces);
    const after = encoded.filter(
      (r) =>
        allowed.has(r.namespace) || archiveNamespaces.includes(r.namespace),
    );
    const changed = after.filter(
      (r) => old.get(`${r.namespace}\0${r.key}`)?.hash !== r.hash,
    );
    const current = new Set(after.map((r) => `${r.namespace}\0${r.key}`));
    for (const r of before)
      if (
        !current.has(`${r.namespace}\0${r.key}`) &&
        !archiveNamespaces.includes(r.namespace)
      )
        await tx.remove(r.namespace, r.key);
    await tx.putMany(
      changed.filter((r) => !["prediction", "outcome"].includes(r.namespace)),
    );
    await tx.putMany(
      changed.filter((r) => ["prediction", "outcome"].includes(r.namespace)),
      true,
    );
    const changedEnsembles = allowed.has("ensemble")
      ? Object.values(state.ensembles ?? {})
      : [];
    if (changedEnsembles.length) {
      const archive: ValidationArchive = { predictions: [], outcomes: [] };
      freezePredictions(
        archive,
        Object.fromEntries(changedEnsembles.map((e) => [e.key, e])),
        state.rules,
      );
      await tx.putMany(
        encodeState({
          ...state,
          pivots: [],
          forecasts: {},
          ensembles: {},
          climate: {},
          seasonal: {},
          observations: [],
          validationArchive: archive,
        }).filter((r) => r.namespace === "prediction"),
        true,
      );
    }
    if (changed.length || before.length !== after.length) await revision(tx);
    if (Date.now() - lastPrune > 3600000) {
      await tx.prune(Date.now(), cacheBudget());
      lastPrune = Date.now();
    }
  });
}
export async function readCache<T>(
  kind: "research" | "long-range",
  key: string,
): Promise<T | undefined> {
  const db = await getDatabase();
  return db.read(async (tx) => {
    const r = await tx.get(`cache:${kind}`, key);
    return r && (r.expiresAt === null || r.expiresAt > Date.now())
      ? unpack<T>(r)
      : undefined;
  });
}
export async function writeCache(
  kind: "research" | "long-range",
  key: string,
  value: unknown,
) {
  const db = await getDatabase();
  await db.transaction(async (tx) => {
    await tx.put(
      makeRecord(`cache:${kind}`, key, value, {
        expiresAt:
          kind === "research" && key.startsWith("ensemble-")
            ? Date.now() + 7 * 86400000
            : null,
      }),
    );
    if (Date.now() - lastPrune > 60000) {
      await tx.prune(Date.now(), cacheBudget());
      lastPrune = Date.now();
    }
  });
}
export async function saveResearchRaw(
  key: string,
  kind: "ensemble" | "history",
  value: unknown,
) {
  await writeCache(
    "research",
    `${kind}-${key.replace(/[^\d,.-]/g, "")}`,
    value,
  );
}
export async function readResearchRaw<T>(
  key: string,
  kind: "ensemble" | "history",
) {
  return readCache<T>("research", `${kind}-${key.replace(/[^\d,.-]/g, "")}`);
}
export async function saveSnapshot(pivotId: string, forecast: WeatherForecast) {
  if (!forecast.models.length) return;
  const db = await getDatabase();
  await db.transaction((tx) =>
    tx.put(
      makeRecord(
        "snapshot",
        `${pivotId}-${localDate(new Date(forecast.fetchedAt))}`,
        forecast,
        { expiresAt: Date.parse(forecast.fetchedAt) + 14 * 86400000 },
      ),
      true,
    ),
  );
}
export async function mergeClimateBatch(
  results: HistoricalClimate[],
  signature: string,
) {
  const db = await getDatabase();
  await db.transaction(async (tx) => {
    const rule = await tx.get("settings", "rules");
    const rules = rule ? unpack<Rules>(rule) : defaultRules;
    if (rulesSignature(rules) !== signature) return;
    const active = new Set(
      (await tx.list({ namespaces: ["pivot"] })).map((r) => {
        const { pivot } = unpack<{ pivot: Pivot }>(r);
        return cellKey(pivot.lat, pivot.lon);
      }),
    );
    const updates: DatabaseRecord[] = [];
    for (const h of results) {
      if (!active.has(h.key) || h.rulesSignature !== signature) continue;
      const row = await tx.get("climate", h.key),
        feature = await tx.get("climate-feature", h.key);
      const previous = row ? unpack<HistoricalClimate>(row) : undefined;
      if (previous && feature) previous.features = unpack(feature);
      const merged = mergeHistory(previous, h),
        { features, ...summary } = merged;
      updates.push(
        makeRecord("climate", h.key, summary),
        makeRecord("climate-feature", h.key, features ?? []),
      );
    }
    await tx.putMany(updates);
    await revision(tx);
  });
}
export async function readValidationArchive(
  query: RecordQuery = {},
): Promise<ValidationArchive> {
  const db = await getDatabase();
  return db.read(async (tx) => {
    const [predictions, outcomes] = await Promise.all([
      tx.list({ ...query, namespaces: ["prediction"] }),
      tx.list({ ...query, lead: undefined, namespaces: ["outcome"] }),
    ]);
    return {
      predictions: predictions.map((r) => unpack(r)),
      outcomes: outcomes.map((r) => unpack(r)),
    };
  });
}

export async function readForecastTimes(): Promise<Record<string, string>> {
  const db = await getDatabase();
  return db.read(async (tx) =>
    Object.fromEntries(
      (await tx.list({ namespaces: ["forecast"], metadataOnly: true })).map(
        (r) => [r.key, r.validDate ?? ""],
      ),
    ),
  );
}
export async function readClimate(
  key: string,
): Promise<HistoricalClimate | undefined> {
  const db = await getDatabase();
  return db.read(async (tx) => {
    const row = await tx.get("climate", key);
    if (!row) return;
    const value = unpack<HistoricalClimate>(row),
      features = await tx.get("climate-feature", key);
    if (features) value.features = unpack(features);
    return value;
  });
}

// Read one diagnostic batch in a single consistent snapshot, rather than
// opening a database transaction for each location and its feature record.
export async function readClimateBatch(
  keys: string[],
): Promise<HistoricalClimate[]> {
  if (!keys.length) return [];
  const db = await getDatabase();
  return db.read(async (tx) => {
    const rows = await tx.list({
      namespaces: ["climate", "climate-feature"],
      keys: [...new Set(keys)],
    });
    const features = new Map(
      rows
        .filter((r) => r.namespace === "climate-feature")
        .map((r) => [r.key, unpack<HistoricalClimate["features"]>(r)]),
    );
    return rows
      .filter((r) => r.namespace === "climate")
      .map((row) => {
        const history = unpack<HistoricalClimate>(row);
        const values = features.get(row.key);
        return values ? { ...history, features: values } : history;
      });
  });
}

// A renewable lease coordinates the three download lanes across server processes.
// No connection is held while waiting for a weather provider.
export async function acquireSyncLease(name: string) {
  const db = await getDatabase(),
    token = randomUUID();
  const acquired = await db.transaction(async (tx) => {
    const previous = await tx.get("lease", name);
    if (previous && unpack<{ until: number }>(previous).until > Date.now())
      return false;
    await tx.put(
      makeRecord("lease", name, { token, until: Date.now() + 180000 }),
    );
    return true;
  });
  if (!acquired) return undefined;
  const timer = setInterval(() => {
    void db
      .transaction(async (tx) => {
        const current = await tx.get("lease", name);
        if (current && unpack<{ token: string }>(current).token === token)
          await tx.put(
            makeRecord("lease", name, { token, until: Date.now() + 180000 }),
          );
      })
      .catch(() => {
        /* Expiry permits recovery after a disconnected process. */
      });
  }, 60000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    await db.transaction(async (tx) => {
      const current = await tx.get("lease", name);
      if (current && unpack<{ token: string }>(current).token === token)
        await tx.remove("lease", name);
    });
  };
}
