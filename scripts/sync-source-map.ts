import { writeFile, copyFile } from "node:fs/promises";
import { parsePivots } from "../src/domain/import";
import { syncPivots } from "../src/domain/sync-pivots";
import { mutateState } from "../src/persistence/store";
async function main() {
  const url = new URL("https://www.google.com/maps/d/kml");
  url.searchParams.set("mid", "1XjGPX2pxGOVbN53k-B6TIUnDzWAA_P4");
  url.searchParams.set("forcekml", "1");
  const r = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Mapa: HTTP ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const incoming = parsePivots(bytes, "source-map.kml");
  await copyFile(
    "data/state.json",
    `data/state-before-sync-${Date.now()}.json`,
  );
  await mutateState((s) => {
    const result = syncPivots(s.pivots, incoming);
    s.pivots = result.pivots;
    for (const id of result.changedIds) delete s.forecasts[id];
    console.log(
      JSON.stringify({
        added: result.added,
        updated: result.changedIds.length,
        total: s.pivots.length,
        north: s.pivots.filter((p) => p.lat > 0).length,
      }),
    );
  });
  await writeFile("data/source-map.kml", bytes);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
