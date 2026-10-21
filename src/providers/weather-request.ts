// Retry only transient transport/server failures. A provider quota or invalid
// request must remain visible and must not generate another request.
export async function weatherJson<T>(
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
