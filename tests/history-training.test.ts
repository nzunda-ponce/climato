import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessHistoryYear,
  mergeHistory,
} from "../src/domain/history-training";
import { defaultRules, Hour } from "../src/domain/types";
function hours(year: number): Hour[] {
  return ["09-30", "10-01"].flatMap((date) =>
    Array.from({ length: 24 }, (_, h) => ({
      time: `${year}-${date}T${String(h).padStart(2, "0")}:00`,
      wind: 5,
      rain: date === "10-01" && h === 1 ? 3 : 0,
      gust: null,
      soil: null,
    })),
  );
}
test("progressive historical labels preserve night-rain rules and the previous-day criterion", () => {
  const h = assessHistoryYear(
    "point",
    -34,
    -61,
    2025,
    hours(2025),
    defaultRules,
  );
  assert.equal(h.days["2025-10-01"], 3);
  assert.equal(h.monthly["10"].fraction, 1);
  const wet = hours(2025).map((h) => ({
    ...h,
    rain: h.time.startsWith("2025-09-30") ? 1 : h.rain,
  }));
  assert.equal(
    assessHistoryYear("point", -34, -61, 2025, wet, defaultRules).days[
      "2025-10-01"
    ],
    0,
  );
});
test("merges seasons without duplicating years and invalidates incompatible labels after a rule change", () => {
  const a = assessHistoryYear(
      "point",
      -34,
      -61,
      2025,
      hours(2025),
      defaultRules,
    ),
    b = assessHistoryYear("point", -34, -61, 2024, hours(2024), defaultRules);
  const merged = mergeHistory(a, b);
  assert.deepEqual(merged.years, [2024, 2025]);
  assert.equal(Object.keys(merged.days).length, 2);
  assert.equal(merged.monthly["10"].days, 2);
  assert.deepEqual(mergeHistory(merged, b).years, [2024, 2025]);
  const changed = assessHistoryYear("point", -34, -61, 2024, hours(2024), {
    ...defaultRules,
    wind: 4,
  });
  const replaced = mergeHistory(merged, changed);
  assert.deepEqual(replaced.years, [2024]);
  assert.equal(replaced.days["2024-10-01"], 0);
  assert.equal(replaced.days["2025-10-01"], undefined);
});
