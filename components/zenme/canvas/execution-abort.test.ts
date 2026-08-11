import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createTimedExecutionController,
  isExecutionTimeout,
  TEXT_GENERATION_TIMEOUT_MINUTES,
  TEXT_GENERATION_TIMEOUT_MS,
} from "./execution-abort";

afterEach(() => vi.useRealTimers());

describe("execution abort", () => {
  it("allows text generation to run for five minutes", () => {
    expect(TEXT_GENERATION_TIMEOUT_MINUTES).toBe(5);
    expect(TEXT_GENERATION_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it("aborts an attempt with a diagnosable timeout reason", () => {
    vi.useFakeTimers();
    const task = createTimedExecutionController(1_000);

    vi.advanceTimersByTime(1_000);

    expect(task.controller.signal.aborted).toBe(true);
    expect(isExecutionTimeout(task.controller.signal)).toBe(true);
    task.dispose();
  });

  it("does not classify a user stop as a timeout", () => {
    const task = createTimedExecutionController(1_000);
    task.controller.abort(new DOMException("Stopped", "AbortError"));

    expect(isExecutionTimeout(task.controller.signal)).toBe(false);
    task.dispose();
  });
});
