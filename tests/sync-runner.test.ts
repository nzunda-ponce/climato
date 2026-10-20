import { test } from "node:test";
import assert from "node:assert/strict";
import { createSyncRunner } from "../src/providers/sync-runner";

test("multiple tabs share one import and completed steps survive a failed source", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let plans = 0;
  const saved: string[] = [];
  const runner = createSyncRunner(async () => {
    plans++;
    return [
      {
        label: "equipos",
        run: async () => {
          await gate;
          saved.push("equipos");
        },
      },
      {
        label: "clima",
        run: async () => {
          throw new Error("HTTP 429");
        },
      },
      {
        label: "mapa",
        run: async () => {
          saved.push("mapa");
        },
      },
    ];
  });
  const first = runner.start();
  assert.equal(runner.start(), first);
  assert.equal(runner.status.running, true);
  release();
  await first;
  assert.equal(plans, 1);
  assert.deepEqual(saved, ["equipos", "mapa"]);
  assert.equal(runner.status.completed, 3);
  assert.equal(runner.status.total, 3);
  assert.deepEqual(runner.status.errors, ["clima: HTTP 429"]);
  assert.equal(runner.status.running, false);
});

test("failed imports wait five minutes then replan from persisted progress", async () => {
  let now = 1000;
  let hasEquipment = false;
  let attempts = 0;
  const runner = createSyncRunner(
    async () => {
      const tasks = [];
      if (!hasEquipment)
        tasks.push({
          label: "equipos",
          run: async () => {
            hasEquipment = true;
          },
        });
      tasks.push({
        label: "clima",
        run: async () => {
          if (++attempts === 1) throw new Error("offline");
        },
      });
      return tasks;
    },
    () => now,
  );
  await runner.start();
  assert.equal(runner.status.retryAt, now + 300000);
  await runner.start();
  assert.equal(attempts, 1);
  now += 300000;
  await runner.start();
  assert.equal(attempts, 2);
  assert.equal(runner.status.total, 1);
  assert.deepEqual(runner.status.errors, []);
  assert.equal(runner.status.retryAt, now + 3600000);
});

test("map import failure is visible and does not leave the job stuck", async () => {
  const runner = createSyncRunner(async () => {
    throw new Error("Mapa privado");
  });
  await runner.start();
  assert.equal(runner.status.running, false);
  assert.deepEqual(runner.status.errors, ["Mapa privado"]);
  assert.match(runner.status.message, /Reintentaremos/);
});
