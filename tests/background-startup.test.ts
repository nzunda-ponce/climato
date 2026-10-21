import { test } from "node:test";
import assert from "node:assert/strict";
import { startInBackground } from "../src/runtime/background-startup";

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
