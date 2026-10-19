import { readFile } from "node:fs/promises";
import { parsePivots } from "../src/domain/import";
import { mutateState, readState } from "../src/persistence/store";
async function main() {
  const pivots = parsePivots(
    await readFile("data/source-map.kml"),
    "source-map.kml",
  );
  let added = 0;
  await mutateState((state) => {
    for (const p of pivots)
      if (!state.pivots.some((x) => x.id === p.id)) {
        state.pivots.push(p);
        added++;
      }
  });
  console.log(
    JSON.stringify({
      imported: added,
      total: (await readState()).pivots.length,
    }),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
