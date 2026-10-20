import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  openSqlite,
  openPostgres,
  type ApplicationDatabase,
} from "../src/persistence/database";
import {
  makeRecord,
  unpack,
  encodeState,
  decodeState,
  planningNamespaces,
} from "../src/persistence/records";
import { migrateLegacy } from "../src/persistence/migrate";
import { defaultRules } from "../src/domain/types";
import type { State } from "../src/persistence/store";
const fixture = (): State => ({
  pivots: [
    {
      id: "p1",
      name: "Equipo",
      field: "Campo",
      lat: -38.5,
      lon: -58.7,
      status: "PROGRAMADO",
      scheduledDate: "2026-11-01",
      road: "DESCONOCIDO",
    },
  ],
  rules: { ...defaultRules },
  forecasts: {
    p1: {
      fetchedAt: "2026-10-20T12:00Z",
      models: [],
      errors: [],
      source: "test",
    },
  },
  climate: {
    "-38.5,-58.7": {
      features: [{ year: 2020 }],
      years: [2020],
      days: {},
      key: "-38.5,-58.7",
    } as any,
  },
  validationArchive: {
    predictions: [
      {
        key: "-38.5,-58.7",
        date: "2026-11-01",
        lead: 1,
        signature: "criteria",
        probability: 0.8,
      } as any,
    ],
    outcomes: [],
  },
});
async function contract(db: ApplicationDatabase) {
  await db.transaction((tx) => tx.putMany(encodeState(fixture())));
  const restored = await db.read(async (tx) => decodeState(await tx.list()));
  assert.deepEqual(restored.pivots, fixture().pivots);
  assert.deepEqual(restored.climate, fixture().climate);
  const small = await db.read(async (tx) =>
    decodeState(await tx.list({ namespaces: planningNamespaces })),
  );
  assert.equal(small.climate?.["-38.5,-58.7"].features, undefined);
  assert.deepEqual(small.forecasts, {});
  assert.equal(small.validationArchive, undefined);
  const metadata = await db.read((tx) =>
    tx.list({ namespaces: ["forecast"], metadataOnly: true }),
  );
  assert.equal(metadata[0].payload.byteLength, 0);
  assert.equal(metadata[0].validDate, "2026-10-20T12:00Z");
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.put(makeRecord("pivot", "bad", { lost: true }));
      throw new Error("rollback");
    }),
    /rollback/,
  );
  assert.equal(await db.read((tx) => tx.get("pivot", "bad")), undefined);
  const original = await db.read((tx) =>
    tx.list({ namespaces: ["prediction"] }),
  );
  await db.transaction((tx) =>
    tx.put(
      {
        ...original[0],
        payload: makeRecord("prediction", "ignored", { probability: 0 })
          .payload,
      },
      true,
    ),
  );
  assert.equal(
    unpack((await db.read((tx) => tx.list({ namespaces: ["prediction"] })))[0])
      .probability,
    0.8,
  );
  await db.transaction(async (tx) => {
    await tx.put(
      makeRecord("cache:research", "old", { huge: "old" }, { updatedAt: 1 }),
    );
    await tx.put(
      makeRecord("cache:research", "new", { huge: "new" }, { updatedAt: 2 }),
    );
    await tx.put(makeRecord("cache:research", "expired", {}, { expiresAt: 1 }));
    await tx.prune(Date.now(), 1);
  });
  assert.equal(
    (await db.read((tx) => tx.list({ namespaces: ["cache:research"] }))).length,
    0,
  );
  assert.equal(
    (await db.read((tx) => tx.list({ namespaces: ["pivot"] }))).length,
    1,
  );
  const result = await db.read((tx) =>
    tx.list({
      namespaces: ["prediction"],
      locations: ["-38.5,-58.7"],
      start: "2026-11-01",
      end: "2026-11-01",
      lead: 1,
      signature: "criteria",
    }),
  );
  assert.equal(result.length, 1);
  assert.equal((await db.read((tx) => tx.list({ locations: [] }))).length, 0);
}
test("SQLite transactions, record roundtrip, immutable predictions, slim reads, indexed filters and bounded cache", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-db-"));
  const db = await openSqlite(path.join(dir, "test.sqlite"));
  try {
    await contract(db);
  } finally {
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("legacy migration is resumable, idempotent and preserves original files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-migration-")),
    cwd = process.cwd();
  const db = await openSqlite(path.join(dir, "test.sqlite"));
  try {
    await mkdir(path.join(dir, "data", "research"), { recursive: true });
    const raw = JSON.stringify(fixture());
    await writeFile(path.join(dir, "data", "state.json"), raw);
    const cache = path.join(dir, "data", "research", "history-2020.json.gz");
    await writeFile(
      path.join(dir, "data", "research", "z-damaged.json.gz"),
      "damaged",
    );
    await writeFile(cache, gzipSync(JSON.stringify({ rain: [1, 0] })));
    process.chdir(dir);
    let calls = 0;
    await assert.rejects(
      migrateLegacy({
        ...db,
        transaction: async (fn) => {
          if (++calls === 3) throw new Error("Interrupted connection");
          return db.transaction(fn);
        },
      }),
      /Interrupted/,
    );
    assert.equal(
      (await db.read((tx) => tx.list({ namespaces: ["pivot"] }))).length,
      1,
    );
    await writeFile(cache, gzipSync(JSON.stringify({ rain: [1, 0] })));
    await migrateLegacy(db);
    await db.transaction((tx) => tx.remove("pivot", "p1"));
    await migrateLegacy(db);
    assert.equal(
      (await db.read((tx) => tx.list({ namespaces: ["pivot"] }))).length,
      0,
    );
    assert.equal(
      await readFile(path.join(dir, "data", "state.json"), "utf8"),
      raw,
    );
    assert.deepEqual(
      unpack(
        (await db.read((tx) => tx.get("cache:research", "history-2020")))!,
      ),
      { rain: [1, 0] },
    );
  } finally {
    process.chdir(cwd);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("malformed legacy state fails explicitly and never marks a migration complete", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-invalid-")),
    cwd = process.cwd(),
    db = await openSqlite(path.join(dir, "test.sqlite"));
  try {
    await mkdir(path.join(dir, "data"));
    await writeFile(path.join(dir, "data", "state.json"), "{}");
    process.chdir(dir);
    await assert.rejects(migrateLegacy(db), /no es válido/);
    assert.equal(
      await db.read((tx) => tx.get("system", "migration-v2-complete")),
      undefined,
    );
  } finally {
    process.chdir(cwd);
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("two connections serialize writes without losing updates", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-concurrent-")),
    file = path.join(dir, "test.sqlite");
  const a = await openSqlite(file),
    b = await openSqlite(file);
  try {
    await a.transaction((tx) => tx.put(makeRecord("counter", "value", 0)));
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        (i % 2 ? a : b).transaction(async (tx) => {
          const n = unpack<number>((await tx.get("counter", "value"))!);
          await new Promise((r) => setTimeout(r, 2));
          await tx.put(makeRecord("counter", "value", n + 1));
        }),
      ),
    );
    assert.equal(
      unpack((await a.read((tx) => tx.get("counter", "value")))!),
      12,
    );
  } finally {
    await a.close();
    await b.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  "PostgreSQL follows the same persistence contract",
  { skip: !process.env.CLIMATO_TEST_DATABASE_URL },
  async () => {
    const db = await openPostgres(process.env.CLIMATO_TEST_DATABASE_URL);
    try {
      await db.legacyState();
      await contract(db);
    } finally {
      await db.close();
    }
  },
);

test("connecting cloud imports the latest local database instead of stale JSON", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-cloud-migrate-")),
    cwd = process.cwd(),
    old = process.env.CLIMATO_SQLITE_PATH;
  process.env.CLIMATO_SQLITE_PATH = path.join(dir, "local.sqlite");
  const source = await openSqlite(),
    target = await openSqlite(path.join(dir, "cloud.sqlite"));
  try {
    await source.transaction((tx) => tx.putMany(encodeState(fixture())));
    await source.close();
    await mkdir(path.join(dir, "data"));
    await writeFile(
      path.join(dir, "data", "state.json"),
      JSON.stringify({ ...fixture(), pivots: [] }),
    );
    process.chdir(dir);
    await migrateLegacy({ ...target, kind: "postgresql" });
    const state = await target.read(async (tx) => decodeState(await tx.list()));
    assert.equal(state.pivots.length, 1);
    assert.equal(state.pivots[0].status, "PROGRAMADO");
  } finally {
    process.chdir(cwd);
    if (old === undefined) delete process.env.CLIMATO_SQLITE_PATH;
    else process.env.CLIMATO_SQLITE_PATH = old;
    await target.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scoped writes preserve unloaded history, no-op saves keep row timestamps, planning cache refreshes after edits", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "climato-store-")),
    cwd = process.cwd(),
    old = process.env.CLIMATO_SQLITE_PATH,
    oldUrl = process.env.DATABASE_URL;
  const {
    getDatabase,
    closeDatabase,
    mutateState,
    readState,
    acquireSyncLease,
  } = await import("../src/persistence/store");
  await closeDatabase();
  process.chdir(dir);
  process.env.DATABASE_URL = "";
  process.env.CLIMATO_SQLITE_PATH = path.join(dir, "test.sqlite");
  try {
    await mutateState((s) => {
      Object.assign(s, fixture());
    });
    const db = await getDatabase(),
      before = await db.read((tx) => tx.get("climate-feature", "-38.5,-58.7"));
    const first = await readState({ purpose: "planning" });
    first.pivots[0].name = "Do not mutate the cache";
    assert.equal(
      (await readState({ purpose: "planning" })).pivots[0].name,
      "Equipo",
    );
    await mutateState(
      (s) => {
        s.pivots[0].name = "Editado";
      },
      { namespaces: ["settings", "pivot"] },
    );
    assert.equal(
      (await readState({ purpose: "planning" })).pivots[0].name,
      "Editado",
    );
    await mutateState(() => {});
    const after = await db.read((tx) =>
      tx.get("climate-feature", "-38.5,-58.7"),
    );
    assert.equal(after?.hash, before?.hash);
    assert.equal(after?.updatedAt, before?.updatedAt);
    const release = await acquireSyncLease("test");
    assert.ok(release);
    assert.equal(await acquireSyncLease("test"), undefined);
    await release();
    const next = await acquireSyncLease("test");
    assert.ok(next);
    await next();
  } finally {
    await closeDatabase();
    process.chdir(cwd);
    if (old === undefined) delete process.env.CLIMATO_SQLITE_PATH;
    else process.env.CLIMATO_SQLITE_PATH = old;
    if (oldUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = oldUrl;
    await rm(dir, { recursive: true, force: true });
  }
});
