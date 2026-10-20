const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const execute = promisify(execFile);

class UpdatePaused extends Error {}
async function git(root, args) {
  return (
    await execute("git", args, { cwd: root, timeout: 30000, windowsHide: true })
  ).stdout.trim();
}
function canonicalNextEnv(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replaceAll("./.next-dev/types/", "./.next/types/");
}
async function trackedChanges(root) {
  const staged = await git(root, ["diff", "--cached", "--name-only"]);
  if (staged)
    throw new UpdatePaused(
      "Hay cambios preparados para guardar. La actualización automática está pausada.",
    );
  const files = (await git(root, ["diff", "--name-only", "-z"]))
    .split("\0")
    .filter(Boolean);
  let generated = false;
  for (const file of files) {
    if (file === "next-env.d.ts") {
      const original = await git(root, ["show", "HEAD:next-env.d.ts"]);
      const current = await fs.readFile(path.join(root, file), "utf8");
      if (
        canonicalNextEnv(original).trim() === canonicalNextEnv(current).trim()
      ) {
        generated = true;
        continue;
      }
    }
    throw new UpdatePaused(
      "Hay cambios locales. Se conservan y la actualización automática queda pausada hasta que los guardes en Git.",
    );
  }
  return generated;
}
async function syncSource(root, beforeUpdate = async () => {}) {
  const branch = await git(root, ["symbolic-ref", "--short", "HEAD"]);
  const optional = async (key, fallback) => {
    try {
      return await git(root, ["config", "--get", key]);
    } catch (e) {
      if (e.code === 1) return fallback;
      throw e;
    }
  };
  const remote = await optional(`branch.${branch}.remote`, "origin");
  const ref = await optional(`branch.${branch}.merge`, `refs/heads/${branch}`);
  if (
    remote.startsWith("-") ||
    remote === "." ||
    !ref.startsWith("refs/heads/")
  )
    throw new UpdatePaused(
      "La rama no tiene un origen remoto válido para actualizarse automáticamente.",
    );
  await trackedChanges(root);
  await git(root, ["fetch", "--no-tags", remote, ref]);
  if ((await git(root, ["symbolic-ref", "--short", "HEAD"])) !== branch)
    throw new UpdatePaused(
      "La rama cambió durante la descarga; se revisará en el próximo intento.",
    );
  const head = await git(root, ["rev-parse", "HEAD"]);
  const target = await git(root, ["rev-parse", "FETCH_HEAD"]);
  if (head === target) return { updated: false, revision: head, files: [] };
  try {
    await git(root, ["merge-base", "--is-ancestor", head, target]);
  } catch (e) {
    if (e.code === 1)
      throw new UpdatePaused(
        "La rama local y GitHub tienen cambios distintos. No se mezclan automáticamente.",
      );
    throw e;
  }
  const files = (await git(root, ["diff", "--name-only", "-z", head, target]))
    .split("\0")
    .filter(Boolean);
  for (const file of files) {
    if (file === ".env" || file.startsWith("data/"))
      throw new UpdatePaused(
        "Esta actualización incluye datos locales o configuración privada; requiere revisión.",
      );
    try {
      await fs.access(path.join(root, file));
      try {
        await git(root, ["ls-files", "--error-unmatch", "--", file]);
      } catch {
        throw new UpdatePaused(
          `Se conserva el archivo local ${file}; la actualización requiere revisión.`,
        );
      }
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  await beforeUpdate();
  if (
    (await git(root, ["rev-parse", "HEAD"])) !== head ||
    (await git(root, ["symbolic-ref", "--short", "HEAD"])) !== branch
  )
    throw new UpdatePaused(
      "La carpeta cambió durante la actualización. Se conserva y se revisará de nuevo.",
    );
  // Check again after shutting down Next, which may have regenerated this file.
  const generated = await trackedChanges(root);
  if (generated)
    await fs.writeFile(
      path.join(root, "next-env.d.ts"),
      (await git(root, ["show", "HEAD:next-env.d.ts"])) + "\n",
    );
  await git(root, ["merge", "--ff-only", "--no-edit", target]);
  return { updated: true, revision: target, files };
}
module.exports = { syncSource, git, UpdatePaused, canonicalNextEnv };
