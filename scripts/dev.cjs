const { fork } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const lock = path.join(__dirname, "..", ".dev-updater.lock");
let child,
  stopping = false;
function acquire() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      fs.closeSync(fd);
      process.on("exit", () => {
        try {
          if (JSON.parse(fs.readFileSync(lock, "utf8")).pid === process.pid)
            fs.unlinkSync(lock);
        } catch {}
      });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stale = false;
      try {
        const pid = JSON.parse(fs.readFileSync(lock, "utf8")).pid;
        if (!Number.isInteger(pid) || pid <= 0) throw new Error("invalid lock");
        try {
          process.kill(pid, 0);
        } catch (e) {
          if (e.code === "ESRCH") stale = true;
        }
      } catch {
        stale = Date.now() - fs.statSync(lock).mtimeMs > 10000;
      }
      if (stale) {
        fs.unlinkSync(lock);
        continue;
      }
      console.log(
        "[Climato] Ya hay una ventana de actualización abierta. Usá esa ventana y abrí http://127.0.0.1:3000.",
      );
      return false;
    }
  }
  return false;
}
function launch() {
  child = fork(
    path.join(__dirname, "dev-auto-update.cjs"),
    process.argv.slice(2),
    { stdio: ["inherit", "inherit", "inherit", "ipc"] },
  );
  child.on("exit", (code) => {
    if (stopping) process.exit(0);
    if (code === 75) launch();
    else process.exit(code ?? 1);
  });
}
function stop() {
  if (stopping) return;
  stopping = true;
  if (child?.connected) child.send({ type: "stop" });
  else process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (acquire()) launch();
