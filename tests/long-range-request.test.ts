import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../src/providers/long-range";

const url = new URL(
  "https://seasonal-api.open-meteo.com/v1/seasonal?apikey=secret",
);

test("seasonal downloads recover from the connection failures reported by the worker", async () => {
  let calls = 0;
  const waits: number[] = [];
  const payload = {
    hourly: { time: ["2026-10-22T00:00"], precipitation: [0] },
  };
  const result = await fetchJson(
    url,
    async () => {
      if (++calls <= 2)
        throw new TypeError("fetch failed", {
          cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
        });
      return Response.json(payload);
    },
    async (ms) => {
      waits.push(ms);
    },
  );
  assert.deepEqual(result, payload);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 5000]);
});

test("seasonal downloads stop immediately on quota instead of retrying four times", async () => {
  let calls = 0;
  await assert.rejects(
    fetchJson(
      url,
      async () => {
        calls++;
        return new Response("secret provider response", { status: 429 });
      },
      async () => {
        assert.fail("A quota response must not be retried");
      },
    ),
    { message: "HTTP 429" },
  );
  assert.equal(calls, 1);
});
