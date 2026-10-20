import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { replaceFile } from "../src/persistence/replace-file";

test("replacement survives a temporary Windows lock and preserves the old data until success", async (t) => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "climato-replace-"));
  const source = path.join(dir, "state.tmp");
  const destination = path.join(dir, "state.json");
  await fs.writeFile(source, "new");
  await fs.writeFile(destination, "old");
  const rename = fs.rename.bind(fs);
  let calls = 0;
  const mocked = t.mock.method(
    fs,
    "rename",
    async (from: string, to: string) => {
      calls++;
      if (calls <= 2) {
        assert.equal(await fs.readFile(destination, "utf8"), "old");
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      }
      await rename(from, to);
    },
  );
  try {
    await replaceFile(source, destination);
    assert.equal(calls, 3);
    assert.equal(await fs.readFile(destination, "utf8"), "new");
  } finally {
    mocked.mock.restore();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("non-lock errors fail immediately", async (t) => {
  const error = Object.assign(new Error("missing"), { code: "ENOENT" });
  const mocked = t.mock.method(fs, "rename", async () => {
    throw error;
  });
  try {
    await assert.rejects(
      replaceFile("missing", "destination"),
      (e) => e === error,
    );
    assert.equal(mocked.mock.callCount(), 1);
  } finally {
    mocked.mock.restore();
  }
});

test("a persistent lock stops retrying and keeps the original file", async (t) => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "climato-lock-"));
  const source = path.join(dir, "state.tmp");
  const destination = path.join(dir, "state.json");
  await fs.writeFile(source, "new");
  await fs.writeFile(destination, "old");
  const error = Object.assign(new Error("still locked"), { code: "EPERM" });
  const mocked = t.mock.method(fs, "rename", async () => {
    throw error;
  });
  try {
    await assert.rejects(replaceFile(source, destination), (e) => e === error);
    assert.equal(mocked.mock.callCount(), 8);
    assert.equal(await fs.readFile(destination, "utf8"), "old");
    assert.equal(await fs.readFile(source, "utf8"), "new");
  } finally {
    mocked.mock.restore();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
