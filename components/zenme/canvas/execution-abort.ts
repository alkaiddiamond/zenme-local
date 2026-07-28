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
