import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { once } from "node:events";
const require = createRequire(import.meta.url);
const { syncSource, git, UpdatePaused } = require("../scripts/auto-update.cjs");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(tmpdir(), "climato-auto-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const origin = path.join(root, "remote.git"),
    seed = path.join(root, "seed"),
    local = path.join(root, "local");
  await fs.mkdir(seed);
  await git(root, ["init", "--bare", "--initial-branch=main", origin]);
  await git(seed, ["init", "-b", "main"]);
  await git(seed, ["config", "user.name", "Climato test"]);
  await git(seed, ["config", "user.email", "climato-test@example.invalid"]);
  await fs.writeFile(
    path.join(seed, ".gitignore"),
    "node_modules/\ndata/\n.env\n.dev-updater.lock\n",
  );
  await fs.writeFile(path.join(seed, "app.txt"), "version one");
  await fs.writeFile(
    path.join(seed, "next-env.d.ts"),
    '/// <reference path="./.next/types/routes.d.ts" />\n',
  );
  const publish = async () => {
    await git(seed, ["add", "."]);
    await git(seed, ["commit", "-m", "test update"]);
    await git(seed, ["push", "origin", "main"]);
  };
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "initial"]);
  await git(seed, ["remote", "add", "origin", origin]);
  await git(seed, ["push", "-u", "origin", "main"]);
  await git(root, ["clone", origin, local]);
  return { root, seed, local, publish };
}

test("downloads a new version while preserving private data and generated Next types", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.local, "data"));
  await fs.writeFile(path.join(f.local, "data/state.json"), "private work");
  await fs.writeFile(path.join(f.local, ".env"), "PRIVATE=keep");
  await fs.writeFile(
    path.join(f.local, "next-env.d.ts"),
    '/// <reference path="./.next-dev/types/routes.d.ts" />\r\n',
  );
  await fs.writeFile(path.join(f.seed, "app.txt"), "version two");
  await f.publish();
  let stopped = false;
  const result = await syncSource(f.local, async () => {
    stopped = true;
  });
  assert.equal(stopped, true);
  assert.equal(result.updated, true);
  assert.equal(
    await fs.readFile(path.join(f.local, "app.txt"), "utf8"),
    "version two",
  );
  assert.equal(
    await fs.readFile(path.join(f.local, "data/state.json"), "utf8"),
    "private work",
  );
  assert.equal(
    await fs.readFile(path.join(f.local, ".env"), "utf8"),
    "PRIVATE=keep",
  );
  assert.equal((await syncSource(f.local)).updated, false);
});

test("pauses for local modifications, staged work and untracked collisions", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.local, "app.txt"), "local edits");
  await fs.writeFile(path.join(f.seed, "app.txt"), "remote edits");
  await f.publish();
  await assert.rejects(syncSource(f.local), UpdatePaused);
  assert.equal(
    await fs.readFile(path.join(f.local, "app.txt"), "utf8"),
    "local edits",
  );
  await git(f.local, ["add", "app.txt"]);
  await assert.rejects(syncSource(f.local), UpdatePaused);
  await git(f.local, ["restore", "--staged", "app.txt"]);
  await git(f.local, ["restore", "app.txt"]);
  await fs.writeFile(path.join(f.local, "new.txt"), "untracked work");
  await fs.writeFile(path.join(f.seed, "new.txt"), "remote file");
  await f.publish();
  await assert.rejects(syncSource(f.local), UpdatePaused);
  assert.equal(
    await fs.readFile(path.join(f.local, "new.txt"), "utf8"),
    "untracked work",
  );
});

test("does not merge diverged commits or modify private files delivered by a remote", async (t) => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.seed, ".env"), "remote private config");
  await git(f.seed, ["add", "-f", ".env"]);
  await f.publish();
  await assert.rejects(syncSource(f.local), UpdatePaused);
  await git(f.local, ["config", "user.name", "Climato test"]);
  await git(f.local, ["config", "user.email", "climato-test@example.invalid"]);
  await fs.writeFile(path.join(f.local, "local.txt"), "local commit");
  await git(f.local, ["add", "."]);
  await git(f.local, ["commit", "-m", "local"]);
  await assert.rejects(syncSource(f.local), UpdatePaused);
});

test("the running supervisor receives a commit, restarts its server and keeps the same launcher", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.seed, "scripts"));
  for (const file of ["dev.cjs", "dev-auto-update.cjs", "auto-update.cjs"])
    await fs.copyFile(
      path.join(process.cwd(), "scripts", file),
      path.join(f.seed, "scripts", file),
    );
  await f.publish();
  await syncSource(f.local);
  const module = path.join(f.local, "node_modules/next");
  await fs.mkdir(path.join(module, "dist/bin"), { recursive: true });
  await fs.writeFile(
    path.join(module, "package.json"),
    '{"name":"next","version":"0.0.0"}',
  );
  await fs.writeFile(
    path.join(module, "dist/bin/next.js"),
    `const fs=require('node:fs');fs.mkdirSync('data',{recursive:true});fs.writeFileSync('data/server.json',JSON.stringify({revision:process.env.CLIMATO_DEV_REVISION,pid:process.pid}));setInterval(()=>{},1000);`,
  );
  const npmCli = path.join(f.root, "npm.cjs");
  await fs.writeFile(
    npmCli,
    `require('node:fs').appendFileSync(${JSON.stringify(path.join(f.root, "npm-calls.jsonl"))},JSON.stringify(process.argv.slice(2))+'\\n');`,
  );
  const launcher = spawn(
    process.execPath,
    [path.join(f.local, "scripts/dev.cjs")],
    {
      cwd: f.local,
      env: {
        ...process.env,
        CLIMATO_UPDATE_INTERVAL_MS: "1000",
        npm_execpath: npmCli,
      },
      stdio: "ignore",
    },
  );
  t.after(async () => {
    if (launcher.exitCode === null) {
      const exit = once(launcher, "exit");
      launcher.kill("SIGTERM");
      await exit;
    }
  });
  const waitForRevision = async (revision: string) => {
    for (let i = 0; i < 200; i++) {
      try {
        const status = JSON.parse(
          await fs.readFile(path.join(f.local, "data/server.json"), "utf8"),
        );
        if (status.revision === revision) return status;
      } catch {}
      await sleep(50);
    }
    throw new Error("The automatic update did not reach the server");
  };
  const first = await waitForRevision(
    await git(f.local, ["rev-parse", "HEAD"]),
  );
  await fs.writeFile(path.join(f.seed, "app.txt"), "new automatic version");
  await f.publish();
  const second = await waitForRevision(
    await git(f.seed, ["rev-parse", "HEAD"]),
  );
  assert.notEqual(first.pid, second.pid);
  assert.equal(launcher.exitCode, null);
  const duplicate = spawn(
    process.execPath,
    [path.join(f.local, "scripts/dev.cjs")],
    { cwd: f.local, stdio: "ignore" },
  );
  assert.equal((await once(duplicate, "exit"))[0], 0);
  assert.equal(launcher.exitCode, null);
  await fs.writeFile(
    path.join(f.seed, "package.json"),
    '{"name":"update-test","version":"1.0.0"}',
  );
  await f.publish();
  await waitForRevision(await git(f.seed, ["rev-parse", "HEAD"]));
  const commands = (
    await fs.readFile(path.join(f.root, "npm-calls.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(commands[0][0], "install");
  assert.deepEqual(commands[1], ["run", "db:generate"]);
  await fs.appendFile(
    path.join(f.seed, "scripts/dev-auto-update.cjs"),
    "\n// automatic supervisor update\n",
  );
  await f.publish();
  const final = await waitForRevision(await git(f.seed, ["rev-parse", "HEAD"]));
  assert.equal(launcher.exitCode, null);
  await fs.rename(
    path.join(f.root, "remote.git"),
    path.join(f.root, "offline.git"),
  );
  await sleep(1300);
  assert.equal(launcher.exitCode, null);
  process.kill(final.pid, 0);
});
