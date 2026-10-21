import { test } from "node:test";
import assert from "node:assert/strict";
import { weatherJson } from "../src/providers/weather-request";

const url = new URL("https://example.invalid/weather?apikey=secret");
const noWait = async () => {};

test("retries a transient connection failure and consumes the successful response", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    if (++calls === 1)
      throw new TypeError("fetch failed", {
        cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
      });
    return Response.json({ hourly: [1, 2] });
  };
  assert.deepEqual(await weatherJson(url, request, noWait), { hourly: [1, 2] });
  assert.equal(calls, 2);
});

test("retries interrupted JSON bodies and gateway errors", async () => {
  for (const first of [
    new Response("{invalid"),
    new Response("unavailable", { status: 503 }),
  ]) {
    let calls = 0;
    const request: typeof fetch = async () =>
      ++calls === 1 ? first : Response.json({ ok: true });
    assert.deepEqual(await weatherJson(url, request, noWait), { ok: true });
    assert.equal(calls, 2);
  }
});

test("quota, auth and invalid queries fail immediately without leaking response bodies", async () => {
  for (const status of [400, 401, 429]) {
    let calls = 0;
    const request: typeof fetch = async () => {
      calls++;
      return new Response("secret", { status });
    };
    await assert.rejects(weatherJson(url, request, noWait), {
      message: `HTTP ${status}`,
    });
    assert.equal(calls, 1);
  }
});

test("persistent network failures stay failures with safe diagnostics", async () => {
  let calls = 0;
  const request: typeof fetch = async () => {
    calls++;
    throw new TypeError(`fetch failed ${url}`, {
      cause: { code: "ECONNRESET" },
    });
  };
  await assert.rejects(weatherJson(url, request, noWait), {
    message: "Descarga interrumpida (ECONNRESET); reintento agotado.",
  });
  assert.equal(calls, 2);
});
