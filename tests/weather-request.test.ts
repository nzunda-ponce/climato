import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWeatherClient,
  weatherJson,
} from "../src/providers/weather-request";

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

test("queued downloads wait for the previous JSON body and pace the next request", async () => {
  let time = 0;
  const starts: number[] = [];
  let finishBody!: () => void;
  const bodyReady = new Promise<void>((resolve) => {
    finishBody = resolve;
  });
  const client = createWeatherClient(
    async () => {
      starts.push(time);
      if (starts.length === 1)
        return new Response(
          new ReadableStream({
            async start(controller) {
              await bodyReady;
              controller.enqueue(new TextEncoder().encode('{"ok":true}'));
              controller.close();
            },
          }),
        );
      return Response.json({ ok: true });
    },
    async (ms) => {
      time += ms;
    },
    () => time,
  );
  const first = client(url);
  const second = client(url);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(starts, [0]);
  finishBody();
  await Promise.all([first, second]);
  assert.deepEqual(starts, [0, 2000]);
});

test("a quota response blocks queued requests and permits a later recovery", async () => {
  let time = 0;
  let calls = 0;
  const client = createWeatherClient(
    async () => {
      return ++calls === 1
        ? new Response(null, { status: 429 })
        : Response.json({ ok: true });
    },
    async (ms) => {
      time += ms;
    },
    () => time,
  );
  const results = await Promise.allSettled([
    client(url),
    client(url),
    client(url),
  ]);
  assert.ok(
    results.every(
      (r) => r.status === "rejected" && r.reason.message === "HTTP 429",
    ),
  );
  assert.equal(calls, 1);
  time = 60 * 60000;
  assert.deepEqual(await client(url), { ok: true });
  assert.equal(calls, 2);
});

test("an exhausted transport retry does not poison the next queued download", async () => {
  let calls = 0;
  const client = createWeatherClient(
    async () => {
      if (++calls <= 2) throw new TypeError("fetch failed");
      return Response.json({ ok: true });
    },
    noWait,
    () => 0,
    0,
  );
  const results = await Promise.allSettled([client(url), client(url)]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.equal(calls, 3);
});
