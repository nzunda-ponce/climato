import { readState, mutateState, saveSnapshot } from "../src/persistence/store";
import { OpenMeteoProvider } from "../src/providers/weather";
async function main() {
  const state = await readState();
  const pivots = state.pivots.filter(
    (p) =>
      !state.forecasts[p.id] ||
      Date.now() - Date.parse(state.forecasts[p.id].fetchedAt) > 3600000,
  );
  const provider = new OpenMeteoProvider();
  let failures = 0;
  for (let i = 0; i < pivots.length; i += 15) {
    const batch = pivots.slice(i, i + 15);
    const forecasts = await provider.forecastMany(batch);
    for (let j = 0; j < batch.length; j++) {
      if (!forecasts[j].models.length) {
        failures++;
        continue;
      }
      await saveSnapshot(batch[j].id, forecasts[j]);
    }
    await mutateState((s) => {
      batch.forEach((p, j) => {
        if (forecasts[j].models.length) s.forecasts[p.id] = forecasts[j];
      });
    });
    console.log(
      JSON.stringify({
        processed: Math.min(i + 15, pivots.length),
        total: pivots.length,
        models: forecasts[0]?.models.length,
        errors: forecasts[0]?.errors,
        failures,
      }),
    );
  }
  if (failures) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
