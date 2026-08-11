export const TEXT_GENERATION_TIMEOUT_MINUTES = 5;
export const TEXT_GENERATION_TIMEOUT_MS =
  TEXT_GENERATION_TIMEOUT_MINUTES * 60 * 1000;

export function createTimedExecutionController(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Execution timed out", "TimeoutError"));
  }, timeoutMs);
  return {
    controller,
    dispose: () => clearTimeout(timer),
  };
}

export function isExecutionTimeout(signal: AbortSignal) {
  return signal.aborted &&
    signal.reason instanceof DOMException &&
    signal.reason.name === "TimeoutError";
}
