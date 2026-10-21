import { test } from "node:test";
import assert from "node:assert/strict";
import { startInBackground } from "../src/runtime/background-startup";
import { register } from "../src/instrumentation";

test("diagnostic startup does not import or schedule meteorological jobs", (t) => {
  const names = [
    "NEXT_RUNTIME",
    "NEXT_PHASE",
    "CLIMATO_ROLE",
    "CLIMATO_DISABLE_AUTO_SYNC",
    "DATABASE_URL",
  ] as const;
  const previous = names.map((name) => [name, process.env[name]] as const);
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.NEXT_PHASE = "phase-development-server";
  process.env.CLIMATO_ROLE = "local";
  process.env.CLIMATO_DISABLE_AUTO_SYNC = "1";
  delete process.env.DATABASE_URL;
  const shared = globalThis as { climatoSchedulerStartupScheduled?: boolean };
  const scheduled = shared.climatoSchedulerStartupScheduled;
  register();
  assert.equal(shared.climatoSchedulerStartupScheduled, scheduled);
});

test("a stalled background import does not hold up server startup", async () => {
  let started = false;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const errors: unknown[] = [];
  const timer = startInBackground(
    () => {
      started = true;
      return pending;
    },
    (error) => errors.push(error),
    0,
  );
  assert.equal(started, false);
  assert.equal(timer.hasRef(), false);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(started, true);
  release();
  await pending;
  assert.deepEqual(errors, []);
});

test("background import rejections and synchronous failures are handled", async () => {
  for (const asyncFailure of [false, true]) {
    const failure = new Error("background unavailable");
    let report!: (value: unknown) => void;
    const received = new Promise((resolve) => {
      report = resolve;
    });
    const timer = startInBackground(
      () => {
        if (asyncFailure) return Promise.reject(failure);
        throw failure;
      },
      report,
      0,
    );
    // Keep the test alive while the production timer remains unreferenced.
    timer.ref();
    assert.equal(await received, failure);
  }
});
