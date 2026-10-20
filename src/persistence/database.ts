import { promises as fs } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

export interface DatabaseRecord {
  namespace: string;
  key: string;
  payload: Uint8Array;
  hash: string;
  updatedAt: number;
  expiresAt: number | null;
  location?: string | null;
  validDate?: string | null;
  lead?: number | null;
  signature?: string | null;
}
export interface RecordQuery {
  metadataOnly?: boolean;
  namespaces?: string[];
  keys?: string[];
  locations?: string[];
  start?: string;
  end?: string;
  lead?: number;
  signature?: string;
}
export interface RecordStats {
  namespace: string;
  records: number;
  bytes: number;
}
export interface DatabaseTransaction {
  stats(): Promise<RecordStats[]>;
  list(query?: RecordQuery): Promise<DatabaseRecord[]>;
  get(namespace: string, key: string): Promise<DatabaseRecord | undefined>;
  put(row: DatabaseRecord, onlyIfAbsent?: boolean): Promise<void>;
  putMany(rows: DatabaseRecord[], onlyIfAbsent?: boolean): Promise<void>;
  remove(namespace: string, key: string): Promise<void>;
  prune(now: number, cacheBytes: number): Promise<void>;
}
export interface ApplicationDatabase {
  kind: "sqlite" | "postgresql";
  read<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  transaction<T>(fn: (tx: DatabaseTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  legacyState(): Promise<unknown | undefined>;
}
export function sqlitePath() {
  if (process.env.CLIMATO_SQLITE_PATH)
    return path.resolve(process.env.CLIMATO_SQLITE_PATH);
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    return path.join(process.env.LOCALAPPDATA, "Climato", "climato.sqlite");
  return path.join(process.cwd(), "data", "climato.sqlite");
}
const schema = `CREATE TABLE IF NOT EXISTS "ClimatoRecord" (
  "namespace" TEXT NOT NULL,"key" TEXT NOT NULL,"payload" BYTEA NOT NULL,"hash" TEXT NOT NULL,
  "updatedAt" BIGINT NOT NULL,"expiresAt" BIGINT,"location" TEXT,"validDate" TEXT,"lead" INTEGER,"signature" TEXT,
  PRIMARY KEY ("namespace","key")
)`;
const indexes = [
  'CREATE INDEX IF NOT EXISTS "ClimatoRecord_expiry" ON "ClimatoRecord" ("expiresAt")',
  'CREATE INDEX IF NOT EXISTS "ClimatoRecord_validation" ON "ClimatoRecord" ("namespace","location","lead","validDate")',
  'CREATE INDEX IF NOT EXISTS "ClimatoRecord_cache" ON "ClimatoRecord" ("namespace","updatedAt")',
];
function conditions(query: RecordQuery, postgres: boolean) {
  const values: (string | number)[] = [],
    parts: string[] = [];
  const param = (v: string | number) => {
    values.push(v);
    return postgres ? `$${values.length}` : "?";
  };
  for (const [property, column] of [
    ["namespaces", "namespace"],
    ["keys", "key"],
    ["locations", "location"],
  ] as const) {
    const array = query[property];
    if (array)
      parts.push(
        array.length ? `"${column}" IN (${array.map(param).join(",")})` : "1=0",
      );
  }
  if (query.start) parts.push(`"validDate" >= ${param(query.start)}`);
  if (query.end) parts.push(`"validDate" <= ${param(query.end)}`);
  if (query.lead !== undefined) parts.push(`"lead" = ${param(query.lead)}`);
  if (query.signature !== undefined)
    parts.push(`"signature" = ${param(query.signature)}`);
  return { where: parts.length ? " WHERE " + parts.join(" AND ") : "", values };
}
const record = (r: any): DatabaseRecord => ({
  ...r,
  payload: new Uint8Array(r.payload),
  updatedAt: Number(r.updatedAt),
  expiresAt: r.expiresAt === null ? null : Number(r.expiresAt),
});
export async function openSqlite(
  filename = sqlitePath(),
): Promise<ApplicationDatabase> {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA busy_timeout=0;",
  );
  db.exec(schema);
  indexes.forEach((sql) => db.exec(sql));
  let queue = Promise.resolve();
  const tx: DatabaseTransaction = {
    async stats() {
      return db
        .prepare(
          'SELECT "namespace",count(*) AS records,sum(length("payload")) AS bytes FROM "ClimatoRecord" GROUP BY "namespace"',
        )
        .all()
        .map((r) => ({
          namespace: String(r.namespace),
          records: Number(r.records),
          bytes: Number(r.bytes),
        }));
    },
    async list(query = {}) {
      const { where, values } = conditions(query, false);
      return db
        .prepare(
          (query.metadataOnly
            ? 'SELECT "namespace","key","hash","updatedAt","expiresAt","location","validDate","lead","signature" FROM "ClimatoRecord"'
            : 'SELECT * FROM "ClimatoRecord"') + where,
        )
        .all(...values)
        .map(record);
    },
    async get(ns, key) {
      const r = db
        .prepare(
          'SELECT * FROM "ClimatoRecord" WHERE "namespace"=? AND "key"=?',
        )
        .get(ns, key);
      return r ? record(r) : undefined;
    },
    async put(r, onlyIfAbsent = false) {
      db.prepare(
        `INSERT INTO "ClimatoRecord" ("namespace","key","payload","hash","updatedAt","expiresAt","location","validDate","lead","signature") VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT ("namespace","key") ${onlyIfAbsent ? "DO NOTHING" : 'DO UPDATE SET "payload"=excluded."payload","hash"=excluded."hash","updatedAt"=excluded."updatedAt","expiresAt"=excluded."expiresAt","location"=excluded."location","validDate"=excluded."validDate","lead"=excluded."lead","signature"=excluded."signature"'}`,
      ).run(
        r.namespace,
        r.key,
        r.payload,
        r.hash,
        r.updatedAt,
        r.expiresAt,
        r.location ?? null,
        r.validDate ?? null,
        r.lead ?? null,
        r.signature ?? null,
      );
    },
    async putMany(rows, onlyIfAbsent = false) {
      for (const row of rows) await tx.put(row, onlyIfAbsent);
    },
    async remove(ns, key) {
      db.prepare(
        'DELETE FROM "ClimatoRecord" WHERE "namespace"=? AND "key"=?',
      ).run(ns, key);
    },
    async prune(now, maxBytes) {
      db.prepare(
        'DELETE FROM "ClimatoRecord" WHERE "expiresAt" IS NOT NULL AND "expiresAt" < ?',
      ).run(now);
      const rows = db
        .prepare(
          'SELECT "namespace","key",length("payload") AS bytes FROM "ClimatoRecord" WHERE "namespace" LIKE \'cache:%\' ORDER BY "updatedAt" ASC',
        )
        .all() as { namespace: string; key: string; bytes: number }[];
      let total = rows.reduce((s, r) => s + r.bytes, 0);
      for (const r of rows) {
        if (total <= maxBytes) break;
        await tx.remove(r.namespace, r.key);
        total -= r.bytes;
      }
    },
  };
  async function locked<T>(
    fn: (tx: DatabaseTransaction) => Promise<T>,
    write: boolean,
  ) {
    const work = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
          break;
        } catch (e) {
          if (!String(e).includes("locked") || attempt >= 80) throw e;
          await new Promise((r) => setTimeout(r, 50));
        }
      }
      try {
        const result = await fn(tx);
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    });
    queue = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  return {
    kind: "sqlite",
    read: (fn) => locked(fn, false),
    transaction: (fn) => locked(fn, true),
    async legacyState() {
      return undefined;
    },
    async close() {
      await queue;
      db.close();
    },
  };
}
export async function openPostgres(
  url = process.env.DATABASE_URL,
  options: { initialize?: boolean; readOnly?: boolean } = {},
): Promise<ApplicationDatabase> {
  if (!url) throw new Error("Falta configurar DATABASE_URL.");
  type PgClient = {
    $queryRawUnsafe<T = unknown>(sql: string, ...values: any[]): Promise<T>;
    $executeRawUnsafe(sql: string, ...values: any[]): Promise<number>;
  };
  type PgDatabase = PgClient & {
    $transaction<T>(
      fn: (p: PgClient) => Promise<T>,
      options?: { timeout?: number; maxWait?: number; isolationLevel?: string },
    ): Promise<T>;
    $disconnect(): Promise<void>;
  };
  const db = new PrismaClient({ datasourceUrl: url }) as unknown as PgDatabase;
  try {
    if (options.initialize !== false)
      await db.$transaction(
        async (p) => {
          await p.$executeRawUnsafe("SELECT pg_advisory_xact_lock(193772001)");
          await p.$executeRawUnsafe(schema);
          for (const sql of indexes) await p.$executeRawUnsafe(sql);
        },
        { timeout: 30000, maxWait: 10000 },
      );
  } catch (e) {
    await db.$disconnect();
    throw e;
  }
  function transaction(p: PgClient): DatabaseTransaction {
    const query = p.$queryRawUnsafe.bind(p),
      execute = p.$executeRawUnsafe.bind(p);
    const tx: DatabaseTransaction = {
      async stats() {
        return (
          await query<any[]>(
            'SELECT "namespace",count(*) AS records,sum(octet_length("payload")) AS bytes FROM "ClimatoRecord" GROUP BY "namespace"',
          )
        ).map((r) => ({
          namespace: r.namespace,
          records: Number(r.records),
          bytes: Number(r.bytes),
        }));
      },
      async list(options = {}) {
        const { where, values } = conditions(options, true);
        return (
          await query<any[]>(
            (options.metadataOnly
              ? 'SELECT "namespace","key","hash","updatedAt","expiresAt","location","validDate","lead","signature" FROM "ClimatoRecord"'
              : 'SELECT * FROM "ClimatoRecord"') + where,
            ...values,
          )
        ).map(record);
      },
      async get(ns, key) {
        const rows = await query<any[]>(
          'SELECT * FROM "ClimatoRecord" WHERE "namespace"=$1 AND "key"=$2',
          ns,
          key,
        );
        return rows[0] ? record(rows[0]) : undefined;
      },
      async put(r, onlyIfAbsent = false) {
        await execute(
          `INSERT INTO "ClimatoRecord" ("namespace","key","payload","hash","updatedAt","expiresAt","location","validDate","lead","signature") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT ("namespace","key") ${onlyIfAbsent ? "DO NOTHING" : 'DO UPDATE SET "payload"=excluded."payload","hash"=excluded."hash","updatedAt"=excluded."updatedAt","expiresAt"=excluded."expiresAt","location"=excluded."location","validDate"=excluded."validDate","lead"=excluded."lead","signature"=excluded."signature"'}`,
          r.namespace,
          r.key,
          Buffer.from(r.payload),
          r.hash,
          r.updatedAt,
          r.expiresAt,
          r.location ?? null,
          r.validDate ?? null,
          r.lead ?? null,
          r.signature ?? null,
        );
      },
      async putMany(rows, onlyIfAbsent = false) {
        for (let offset = 0; offset < rows.length;) {
          let end = offset,
            bytes = 0;
          while (
            end < rows.length &&
            end - offset < 200 &&
            (end === offset ||
              bytes + rows[end].payload.byteLength < 2 * 1024 * 1024)
          )
            bytes += rows[end++].payload.byteLength;
          const batch = rows.slice(offset, end),
            values: any[] = [];
          offset = end;
          const tuples = batch.map((r) => {
            const start = values.length;
            values.push(
              r.namespace,
              r.key,
              Buffer.from(r.payload),
              r.hash,
              r.updatedAt,
              r.expiresAt,
              r.location ?? null,
              r.validDate ?? null,
              r.lead ?? null,
              r.signature ?? null,
            );
            return (
              "(" +
              Array.from({ length: 10 }, (_, i) => "$" + (start + i + 1)).join(
                ",",
              ) +
              ")"
            );
          });
          if (!batch.length) continue;
          await execute(
            'INSERT INTO "ClimatoRecord" ("namespace","key","payload","hash","updatedAt","expiresAt","location","validDate","lead","signature") VALUES ' +
              tuples.join(",") +
              ' ON CONFLICT ("namespace","key") ' +
              (onlyIfAbsent
                ? "DO NOTHING"
                : 'DO UPDATE SET "payload"=excluded."payload","hash"=excluded."hash","updatedAt"=excluded."updatedAt","expiresAt"=excluded."expiresAt","location"=excluded."location","validDate"=excluded."validDate","lead"=excluded."lead","signature"=excluded."signature"'),
            ...values,
          );
        }
      },
      async remove(ns, key) {
        await execute(
          'DELETE FROM "ClimatoRecord" WHERE "namespace"=$1 AND "key"=$2',
          ns,
          key,
        );
      },
      async prune(now, maxBytes) {
        await execute(
          'DELETE FROM "ClimatoRecord" WHERE "expiresAt" IS NOT NULL AND "expiresAt" < $1',
          now,
        );
        const rows = await query<
          { namespace: string; key: string; bytes: bigint }[]
        >(
          'SELECT "namespace","key",octet_length("payload") AS bytes FROM "ClimatoRecord" WHERE "namespace" LIKE \'cache:%\' ORDER BY "updatedAt" ASC',
        );
        let total = rows.reduce((s, r) => s + Number(r.bytes), 0);
        for (const r of rows) {
          if (total <= maxBytes) break;
          await tx.remove(r.namespace, r.key);
          total -= Number(r.bytes);
        }
      },
    };
    return tx;
  }
  return {
    kind: "postgresql",
    read: (fn) =>
      db.$transaction(
        async (p) => {
          if (options.readOnly)
            await p.$executeRawUnsafe("SET TRANSACTION READ ONLY");
          return fn(transaction(p));
        },
        {
          isolationLevel: "RepeatableRead",
          timeout: 30000,
          maxWait: 10000,
        },
      ),
    transaction: (fn) =>
      db.$transaction(
        async (p) => {
          await p.$executeRawUnsafe("SELECT pg_advisory_xact_lock(193772002)");
          return fn(transaction(p));
        },
        { timeout: 60000, maxWait: 30000 },
      ),
    async legacyState() {
      const exists = await db.$queryRawUnsafe<any[]>(
        "SELECT to_regclass('public.\"AppState\"')::text AS name",
      );
      if (!exists[0]?.name) return undefined;
      const rows = await db.$queryRawUnsafe<any[]>(
        'SELECT payload FROM "AppState" WHERE id=$1',
        "campaign",
      );
      return rows[0]?.payload;
    },
    async close() {
      await db.$disconnect();
    },
  };
}
