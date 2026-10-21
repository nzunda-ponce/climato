// Retry only transient transport/server failures. A provider quota or invalid
// request must remain visible and must not generate another request.
async function readWeatherJson<T>(
  url: URL,
  request: typeof fetch = fetch,
  pause = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await request(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) {
        if ([502, 503, 504].includes(response.status) && attempt === 0) {
          await response.body?.cancel();
          await pause(1000);
          continue;
        }
        // Do not include response bodies or URLs: they may contain credentials.
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      const transient =
        error instanceof Error &&
        (error instanceof TypeError ||
          error.name === "TimeoutError" ||
          error.name === "AbortError" ||
          error instanceof SyntaxError);
      if (transient && attempt === 0) {
        await pause(1000);
        continue;
      }
      const cause = error instanceof Error ? error.cause : undefined;
      const code =
        cause && typeof cause === "object" && "code" in cause
          ? cause.code
          : undefined;
      if (transient)
        throw new Error(
          `Descarga interrumpida${typeof code === "string" && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ""}; reintento agotado.`,
        );
      throw error;
    }
  }
  throw new Error("No se pudo completar la descarga.");
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Keep a single download (including its body and retry) in flight. Open-Meteo
// counts multi-location/model queries as multiple calls, so parallel batches
// can exhaust its quota even when the HTTP request count looks small.
export function createWeatherClient(
  request: typeof fetch = fetch,
  pause = wait,
  now = Date.now,
  intervalMs = 2000,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let nextAt = 0;
  let blockedUntil = 0;
  return function json<T>(url: URL): Promise<T> {
    const result = tail.then(async () => {
      if (now() < blockedUntil) throw new Error("HTTP 429");
      const delay = nextAt - now();
      if (delay > 0) await pause(delay);
      try {
        return await readWeatherJson<T>(url, request, pause);
      } catch (error) {
        if (error instanceof Error && error.message === "HTTP 429")
          blockedUntil = now() + 60 * 60000;
        throw error;
      } finally {
        nextAt = now() + intervalMs;
      }
    });
    tail = result.catch(() => {});
    return result;
  };
}

const sharedClient = createWeatherClient();
export function weatherJson<T>(
  url: URL,
  request?: typeof fetch,
  pause = wait,
): Promise<T> {
  return request
    ? readWeatherJson<T>(url, request, pause)
    : sharedClient<T>(url);
}
