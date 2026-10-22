import { test } from "node:test";
import assert from "node:assert/strict";
import {
  probabilityDiagnostics,
  combineDiagnostics,
} from "../src/domain/ml-diagnostics";
import { GET } from "../src/app/api/ml-diagnostics/route";
import { readJsonResponse } from "../src/domain/http-json";

test("HTML error pages and incomplete JSON produce actionable load errors", async () => {
  await assert.rejects(
    readJsonResponse(
      new Response("<!DOCTYPE html><html>Not found</html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    ),
    /HTTP 404/,
  );
  await assert.rejects(
    readJsonResponse(
      new Response('{"broken":', {
        headers: { "Content-Type": "application/json" },
      }),
    ),
    /incompleta/,
  );
  await assert.rejects(
    readJsonResponse(
      Response.json({ error: "Datos incompatibles" }, { status: 409 }),
    ),
    /Datos incompatibles/,
  );
  assert.deepEqual(await readJsonResponse(Response.json({ count: 455 })), {
    count: 455,
  });
});

test("classification includes threshold equality, all four outcomes, and endpoint bins", () => {
  const rows = [
    { probability: 0.7, target: 1 },
    { probability: 1, target: 0 },
    { probability: 0, target: 0 },
    { probability: 0.6, target: 1 },
  ];
  const result = probabilityDiagnostics(rows, 0.7);
  assert.deepEqual([result.tp, result.fp, result.tn, result.fn], [1, 1, 1, 1]);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 0.5);
  assert.equal(result.f1, 0.5);
  assert.equal(
    result.bins.reduce((sum, b) => sum + b.count, 0),
    4,
  );
  const other = probabilityDiagnostics(rows, 0.5);
  assert.equal(other.brier, result.brier);
  assert.deepEqual(other.bins, result.bins);
  assert.notEqual(other.recall, result.recall);
});

test("missing evidence and absent classes stay undefined instead of implying perfect results", () => {
  const empty = probabilityDiagnostics([], 0.7);
  assert.equal(empty.brier, null);
  assert.equal(empty.accuracy, null);
  assert.equal(empty.precision, null);
  const noPositive = probabilityDiagnostics(
    [{ probability: 0.1, target: 0 }],
    0.7,
  );
  assert.equal(noPositive.recall, null);
  assert.equal(noPositive.precision, null);
  assert.equal(noPositive.specificity, 1);
});

test("global metrics pool counts and calibration by cases instead of averaging location percentages", () => {
  const small = [{ probability: 0.9, target: 1 }];
  const large = Array.from({ length: 9 }, () => ({
    probability: 0.8,
    target: 0,
  }));
  const pooled = combineDiagnostics([
    probabilityDiagnostics(small, 0.7),
    probabilityDiagnostics(large, 0.7),
  ]);
  const direct = probabilityDiagnostics([...small, ...large], 0.7);
  assert.equal(pooled.precision, 0.1);
  assert.equal(pooled.f1, direct.f1);
  assert.equal(pooled.count, 10);
  assert.equal(pooled.bins[4].observed, 0.1);
  assert.ok(
    Math.abs(pooled.bins[4].predicted! - direct.bins[4].predicted!) < 1e-12,
  );
  assert.ok(Math.abs(pooled.brier! - direct.brier!) < 1e-12);
  assert.equal(combineDiagnostics([]).precision, null);
  assert.equal(combineDiagnostics([]).bins[0].observed, null);
});

test("diagnostic API rejects malformed inputs before querying storage", async () => {
  for (const query of [
    "",
    "?key=test&threshold=NaN",
    "?key=test&threshold=0.1",
    "?key=test&threshold=1",
    "?scope=all&offset=-1",
    "?scope=all&offset=1.5",
  ]) {
    const response = await GET(
      new Request(`http://localhost/api/ml-diagnostics${query}`),
    );
    assert.equal(response.status, 400);
  }
});
