import { loadEnvConfig } from "@next/env";
import { promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { getDatabase, closeDatabase } from "../src/persistence/store";
import { openPostgres, type DatabaseRecord } from "../src/persistence/database";
import {
  makeRecord,
  encodeState,
  stateNamespaces,
  archiveNamespaces,
} from "../src/persistence/records";
loadEnvConfig(process.cwd());
class ConfigurationError extends Error {}
function secret(): Promise<string> {
  if (!process.stdin.isTTY)
    throw new ConfigurationError(
      "Ejecutá la configuración en una terminal interactiva.",
    );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  (rl as any)._writeToOutput = () => {};
  return new Promise((resolve, reject) => {
    rl.on("SIGINT", () => {
      rl.close();
      process.stdout.write("\n");
      reject(new ConfigurationError("Configuración cancelada."));
    });
    rl.question("", (value) => {
      rl.close();
      process.stdout.write("\n");
      resolve(value.trim());
    });
    process.stdout.write("Pegá la URL PostgreSQL de Neon (no se mostrará): ");
  });
}
async function main() {
  const command = process.argv[2] ?? "status";
  if (command === "setup") {
    const raw = await secret();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ConfigurationError("La URL no es válida.");
    }
    if (!["postgres:", "postgresql:"].includes(url.protocol))
      throw new ConfigurationError("Se necesita una URL PostgreSQL.");
    if (
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !["require", "verify-full", "verify-ca"].includes(
        url.searchParams.get("sslmode") ?? "",
      )
    )
      throw new ConfigurationError(
        "La conexión remota debe usar SSL. Copiá la URL segura del proveedor.",
      );
    if (!url.searchParams.has("connection_limit"))
      url.searchParams.set("connection_limit", "3");
    // Check access before changing the saved connection. Never print DB errors:
    // drivers can include the connection string in their error messages.
    let probe;
    try {
      probe = await openPostgres(url.toString());
    } catch {
      throw new ConfigurationError(
        "No se pudo conectar. Revisá la URL, acceso de red y estado de la base. No se cambió la configuración.",
      );
    }
    await probe.close();
    const file = path.join(process.cwd(), ".env.local");
    let old = "";
    try {
      old = await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const value =
      "DATABASE_URL=" + JSON.stringify(url.toString()).replace(/\$/g, "\\$");
    const text = /^DATABASE_URL=.*$/m.test(old)
      ? old.replace(/^DATABASE_URL=.*$/m, () => value)
      : old + "\n" + value + "\n";
    await fs.writeFile(file, text, { mode: 0o600 });
    await fs.chmod(file, 0o600);
    process.env.DATABASE_URL = url.toString();
    console.log(
      "Conexión guardada en .env.local (excluido de Git). Migrando datos...",
    );
  }
  if (
    ["setup", "migrate"].includes(command) &&
    !process.env.DATABASE_URL?.trim()
  )
    throw new ConfigurationError(
      "Primero ejecutá npm run db:setup para conectar la base en la nube.",
    );
  const db = await getDatabase();
  if (command === "backup") {
    const rows = await db.read((tx) =>
      tx.list({ namespaces: [...stateNamespaces, ...archiveNamespaces] }),
    );
    const data = rows
      .filter(
        (r) =>
          !r.namespace.startsWith("cache:") &&
          !["system", "lease", "snapshot"].includes(r.namespace),
      )
      .map((r) => ({
        ...r,
        payload: Buffer.from(r.payload).toString("base64"),
      }));
    const dir = path.join(process.cwd(), "data", "backups");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(
      dir,
      `climato-${new Date().toISOString().replace(/[:.]/g, "-")}.json.gz`,
    );
    await fs.writeFile(
      file,
      gzipSync(
        JSON.stringify({
          version: 2,
          createdAt: new Date().toISOString(),
          records: data,
        }),
      ),
      { flag: "wx", mode: 0o600 },
    );
    console.log(`Respaldo creado: ${file}`);
  } else if (command === "restore") {
    const file = process.argv[3];
    if (!file)
      throw new ConfigurationError(
        "Indicá el archivo de respaldo después de --.",
      );
    const bytes = await fs.readFile(file);
    const parsed = JSON.parse(
      (bytes[0] === 0x1f && bytes[1] === 0x8b
        ? gunzipSync(bytes)
        : bytes
      ).toString(),
    );
    const backup =
      Array.isArray(parsed.pivots) && parsed.forecasts
        ? {
            version: 2,
            records: encodeState(parsed).map((r) => ({
              ...r,
              payload: Buffer.from(r.payload).toString("base64"),
            })),
          }
        : parsed;
    if (backup.version !== 2 || !Array.isArray(backup.records))
      throw new ConfigurationError("Formato de respaldo incompatible.");
    const rows: DatabaseRecord[] = backup.records.map((r: any) => {
      if (
        !r ||
        typeof r.namespace !== "string" ||
        typeof r.key !== "string" ||
        ["system", "lease"].includes(r.namespace)
      )
        throw new ConfigurationError("Registro de respaldo inválido.");
      const row = { ...r, payload: Buffer.from(r.payload, "base64") };
      if (
        createHash("sha256").update(gunzipSync(row.payload)).digest("hex") !==
        row.hash
      )
        throw new ConfigurationError("El respaldo tiene un registro dañado.");
      return row;
    });
    await db.transaction(async (tx) => {
      const existing = await tx.list({ metadataOnly: true });
      if (existing.some((r) => !["system", "lease"].includes(r.namespace)))
        throw new ConfigurationError(
          "La restauración requiere una base vacía. No se sobrescribieron datos.",
        );
      await tx.putMany(rows, true);
      await tx.put(makeRecord("system", "revision", new Date().toISOString()));
    });
    console.log(`Restaurados ${rows.length} registros.`);
  } else {
    const { stats, complete } = await db.read(async (tx) => ({
      stats: await tx.stats(),
      complete: !!(await tx.get("system", "migration-v2-complete")),
    }));
    console.log(
      db.kind === "postgresql"
        ? "Base PostgreSQL conectada."
        : "Base local: la nube todavía no está configurada.",
    );
    console.log(
      `Equipos: ${stats.find((r) => r.namespace === "pivot")?.records ?? 0}. Registros: ${stats.reduce((s, r) => s + r.records, 0)}. Migración: ${complete ? "completa" : "pendiente"}.`,
    );
    if (command === "setup")
      console.log("Reiniciá Climato una vez para usar la nueva conexión.");
  }
}
main()
  .catch((e) => {
    // Only our deliberate configuration/validation messages are safe to display.
    const message =
      e instanceof ConfigurationError
        ? e.message
        : "No se pudo completar la operación de base de datos. Revisá la conexión. Los originales se conservan.";
    console.error(message);
    process.exitCode = 1;
  })
  .finally(() =>
    closeDatabase().catch(() => {
      process.exitCode = 1;
    }),
  );
