const { spawn, execFile } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { syncSource, git, UpdatePaused } = require("./auto-update.cjs");
const root = path.resolve(__dirname, "..");
let server,
  preparation,
  timer,
  busy = false,
  stopping = false,
  lastMessage = "",
  needsInstall = false,
  needsGenerate = false,
  needsReload = false;
const log = (message) => {
  if (message !== lastMessage) {
    console.log(`[Climato] ${message}`);
    lastMessage = message;
  }
};
async function stopServer() {
  const child = server;
  server = undefined;
  await stopChild(child);
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  if (process.platform === "win32") {
    await new Promise((resolve) =>
      execFile(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
        resolve,
      ),
    );
  } else child.kill("SIGTERM");
  let timeout;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
    }),
  ]);
  clearTimeout(timeout);
}
async function npm(args) {
  if (stopping) throw new Error("Servidor detenido");
  const cli = process.env.npm_execpath;
  if (!cli || !fs.existsSync(cli))
    throw new Error(
      "Iniciá este servicio con npm run dev para poder preparar las dependencias automáticamente.",
    );
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  preparation = child;
  let code;
  try {
    [code] = await once(child, "exit");
  } finally {
    preparation = undefined;
  }
  if (code !== 0)
    throw new Error(
      "No se pudieron preparar las dependencias. Se reintentará automáticamente.",
    );
}
async function startServer() {
  if (stopping || server) return;
  const revision = await git(root, ["rev-parse", "HEAD"]);
  const args = process.argv.slice(2);
  const port = args.some(
    (a) => a === "-p" || a === "--port" || a.startsWith("--port="),
  )
    ? []
    : ["--port", "3000"];
  server = spawn(
    process.execPath,
    [
      require.resolve("next/dist/bin/next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      ...port,
      ...args,
    ],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, CLIMATO_DEV_REVISION: revision },
    },
  );
  const child = server;
  child.on("error", (e) => {
    server = undefined;
    log(`No se pudo iniciar el servidor: ${e.message}`);
  });
  child.on("exit", () => {
    if (server === child) {
      server = undefined;
      if (!stopping)
        log("El servidor se detuvo. Se intentará iniciar de nuevo.");
    }
  });
}
async function prepare() {
  if (
    needsInstall ||
    !fs.existsSync(path.join(root, "node_modules/next/package.json"))
  ) {
    log("Preparando dependencias de la nueva versión…");
    await npm([
      fs.existsSync(path.join(root, "package-lock.json")) ? "ci" : "install",
      "--no-audit",
      "--no-fund",
    ]);
    needsInstall = false;
    needsGenerate = true;
  }
  if (needsGenerate) {
    await npm(["run", "db:generate"]);
    needsGenerate = false;
  }
}
async function tick() {
  if (busy || stopping) return;
  busy = true;
  try {
    await prepare();
    if (needsReload) {
      stopping = true;
      clearInterval(timer);
      await stopServer();
      process.exit(75);
    }
    await startServer();
    const result = await syncSource(root, stopServer);
    if (result.updated) {
      log(
        `Versión ${result.revision.slice(0, 7)} recibida. Actualizando el servidor…`,
      );
      needsInstall = result.files.some((f) =>
        ["package.json", "package-lock.json"].includes(f),
      );
      needsGenerate = result.files.includes("prisma/schema.prisma");
      needsReload = result.files.some((f) =>
        [
          "scripts/dev.cjs",
          "scripts/dev-auto-update.cjs",
          "scripts/auto-update.cjs",
        ].includes(f),
      );
      await prepare();
      if (needsReload) {
        stopping = true;
        clearInterval(timer);
        await stopServer();
        process.exit(75);
      }
      await startServer();
      log("Actualización aplicada. El navegador se renovará automáticamente.");
    } else {
      await startServer();
      if (!lastMessage)
        log(
          "Actualización automática activa. Podés dejar esta ventana abierta.",
        );
    }
  } catch (e) {
    log(
      e instanceof UpdatePaused
        ? e.message
        : "No se pudo completar la actualización. Se reintentará automáticamente.",
    );
    if (!needsInstall && !needsGenerate)
      await startServer().catch((error) => log(error.message));
  } finally {
    busy = false;
  }
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await Promise.all([stopServer(), stopChild(preparation)]);
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
process.on("message", (message) => {
  if (message?.type === "stop") void stop();
});
timer = setInterval(
  () => void tick(),
  Math.max(1000, Number(process.env.CLIMATO_UPDATE_INTERVAL_MS) || 15000),
);
void tick();
