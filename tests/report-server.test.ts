import { test } from "node:test";
import assert from "node:assert/strict";
import { isReportServer, reportRequestAllowed } from "../src/runtime/role";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getDatabase,
  closeDatabase,
  mutateState,
} from "../src/persistence/store";
import {
  publishPlanningReport,
  readPublishedPlanningReport,
} from "../src/persistence/published-report";
import { localDate } from "../src/domain/types";
test("hosted report mode is read-only by default and allows only intended API reads", () => {
  const role = process.env.CLIMATO_ROLE,
    vercel = process.env.VERCEL;
  try {
    process.env.VERCEL = "1";
    delete process.env.CLIMATO_ROLE;
    assert.equal(isReportServer(), true);
    process.env.CLIMATO_ROLE = "worker";
    assert.equal(isReportServer(), false);
    process.env.CLIMATO_ROLE = "web";
    assert.equal(isReportServer(), true);
    for (const route of [
      "/api/planning",
      "/api/validation",
      "/api/storage",
      "/api/auto-sync",
    ])
      assert.equal(reportRequestAllowed(route, "GET"), true);
    for (const route of [
      "/api/auto-sync",
      "/api/import",
      "/api/campaign",
      "/api/weather",
      "/api/research",
      "/api/long-range",
      "/api/observations",
    ])
      assert.equal(reportRequestAllowed(route, "POST"), false);
    assert.equal(reportRequestAllowed("/api/weather", "GET"), false);
    assert.equal(reportRequestAllowed("/api/export", "GET"), false);
  } finally {
    if (role === undefined) delete process.env.CLIMATO_ROLE;
    else process.env.CLIMATO_ROLE = role;
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  }
});
test("readers keep the last complete publication, detect pending edits and flag stale results", async () => {
  const cwd = process.cwd(),
    dir = await mkdtemp(path.join(tmpdir(), "climato-publication-")),
    original = {
      url: process.env.DATABASE_URL,
      role: process.env.CLIMATO_ROLE,
      file: process.env.CLIMATO_SQLITE_PATH,
    };
  await closeDatabase();
  process.chdir(dir);
  process.env.DATABASE_URL = "";
  process.env.CLIMATO_ROLE = "local";
  process.env.CLIMATO_SQLITE_PATH = path.join(dir, "test.sqlite");
  try {
    assert.equal(await readPublishedPlanningReport(), null);
    await mutateState((s) => {
      s.pivots = [
        {
          id: "test",
          name: "Equipo 1",
          field: "Campo",
          region: "Centro",
          lat: -38.5,
          lon: -58.7,
          status: "PENDIENTE",
          road: "DESCONOCIDO",
        },
      ];
    });
    assert.equal(await publishPlanningReport(true), true);
    const first = await readPublishedPlanningReport();
    assert.equal(first?.publication?.pendingChanges, false);
    assert.equal(first?.today, localDate());
    first!.zones[0].pending = 999;
    assert.equal((await readPublishedPlanningReport())!.zones[0].pending, 1);
    await mutateState(
      (s) => {
        s.pivots[0].name = "Editado";
      },
      { namespaces: ["pivot"] },
    );
    assert.equal(
      (await readPublishedPlanningReport())!.publication!.pendingChanges,
      true,
    );
    assert.equal(
      (await readPublishedPlanningReport())!.zones[0].equipment[0].name,
      "Equipo 1",
    );
    await publishPlanningReport(true);
    assert.equal(
      (await readPublishedPlanningReport())!.zones[0].equipment[0].name,
      "Editado",
    );
    const publicationDb = await getDatabase();
    const originalTransaction = publicationDb.transaction.bind(publicationDb);
    // An importer writes after the consistent read but before publication.
    publicationDb.transaction = async (fn) => {
      publicationDb.transaction = originalTransaction;
      await mutateState(
        (s) => {
          s.pivots[0].name = "Importación concurrente";
        },
        { namespaces: ["pivot"] },
      );
      return originalTransaction(fn);
    };
    try {
      assert.equal(await publishPlanningReport(true), true);
    } finally {
      publicationDb.transaction = originalTransaction;
    }
    const concurrent = await readPublishedPlanningReport();
    assert.equal(concurrent!.zones[0].equipment[0].name, "Editado");
    assert.equal(concurrent!.publication!.pendingChanges, true);
    await publishPlanningReport(true);
    assert.equal(
      (await readPublishedPlanningReport())!.publication!.pendingChanges,
      false,
    );
    // A faster publisher must not be overwritten by an older snapshot.
    publicationDb.transaction = async (fn) => {
      publicationDb.transaction = originalTransaction;
      await mutateState(
        (s) => {
          s.pivots[0].name = "Publicación más reciente";
        },
        { namespaces: ["pivot"] },
      );
      await publishPlanningReport(true);
      return originalTransaction(fn);
    };
    try {
      assert.equal(await publishPlanningReport(true), true);
    } finally {
      publicationDb.transaction = originalTransaction;
    }
    assert.equal(
      (await readPublishedPlanningReport())!.zones[0].equipment[0].name,
      "Publicación más reciente",
    );
    assert.equal(
      (await readPublishedPlanningReport(new Date(Date.now() + 14 * 3600000)))!
        .publication!.stale,
      true,
    );
    const { createDataRunner } = await import("../src/jobs/data-runner");
    const { makeRecord, unpack } = await import("../src/persistence/records");
    const limited = createDataRunner("quota-test", async () => [
      {
        label: "Descarga",
        run: async () => {
          throw new Error("HTTP 429");
        },
      },
    ]);
    await limited.start();
    const dbForGate = await getDatabase();
    const paused = unpack<number>(
      (await dbForGate.read((tx) =>
        tx.get("system", "provider-paused-until"),
      ))!,
    );
    let planned = false;
    const blocked = createDataRunner("other-lane", async () => {
      planned = true;
      return [];
    });
    await blocked.start();
    assert.equal(planned, false);
    assert.equal(
      unpack(
        (await dbForGate.read((tx) =>
          tx.get("system", "provider-paused-until"),
        ))!,
      ),
      paused,
    );
    assert.ok(blocked.status.retryAt >= paused);
    const db = await getDatabase(),
      revision = await db.read((tx) => tx.get("system", "revision"));
    await readPublishedPlanningReport();
    assert.equal(
      (await db.read((tx) => tx.get("system", "revision")))?.hash,
      revision?.hash,
    );
  } finally {
    await closeDatabase();
    process.chdir(cwd);
    for (const [key, v] of Object.entries({
      DATABASE_URL: original.url,
      CLIMATO_ROLE: original.role,
      CLIMATO_SQLITE_PATH: original.file,
    })) {
      if (v === undefined) delete process.env[key];
      else process.env[key] = v;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
test("shared web without cloud connection fails instead of creating an empty local installation", async () => {
  const role = process.env.CLIMATO_ROLE,
    url = process.env.DATABASE_URL;
  await closeDatabase();
  process.env.CLIMATO_ROLE = "web";
  process.env.DATABASE_URL = "";
  try {
    await assert.rejects(getDatabase(), /requiere DATABASE_URL/);
  } finally {
    await closeDatabase();
    if (role === undefined) delete process.env.CLIMATO_ROLE;
    else process.env.CLIMATO_ROLE = role;
    if (url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = url;
  }
});
