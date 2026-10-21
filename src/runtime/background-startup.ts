// Instrumentation must finish before Next can accept the first page request.
// Defer optional work and handle both import failures and synchronous errors.
export function startInBackground(
  start: () => Promise<void> | void,
  onError: (error: unknown) => void,
  delayMs = 1000,
) {
  const timer = setTimeout(() => {
    void Promise.resolve().then(start).catch(onError);
  }, delayMs);
  timer.unref();
  return timer;
}
