import { describe, expect, it } from "vitest";

import { StreamingToolExecutor } from "@/lib/agent/streaming-tool-executor";

describe("StreamingToolExecutor", () => {
  it("starts consecutive concurrency-safe tools together", async () => {
    const executor = new StreamingToolExecutor<string>();
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = executor.add({
      index: 0, signature: "read:a", concurrencySafe: true, interruptBehavior: "cancel",
      run: async () => { started.push(0); await gate; return "a"; },
    });
    const second = executor.add({
      index: 1, signature: "read:b", concurrencySafe: true, interruptBehavior: "cancel",
      run: async () => { started.push(1); await gate; return "b"; },
    });
    await waitUntil(() => started.length === 2);
    expect(started).toEqual([0, 1]);
    release();
    await expect(Promise.all([first.outcome, second.outcome])).resolves.toEqual([
      { status: "succeeded", value: "a" },
      { status: "succeeded", value: "b" },
    ]);
  });

  it("gives a mutating tool exclusive access and keeps later reads behind it", async () => {
    const executor = new StreamingToolExecutor<string>();
    const started: number[] = [];
    let releaseRead!: () => void;
    let releaseWrite!: () => void;
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const first = executor.add({
      index: 0, signature: "read", concurrencySafe: true, interruptBehavior: "cancel",
      run: async () => { started.push(0); await readGate; return "read"; },
    });
    const second = executor.add({
      index: 1, signature: "write", concurrencySafe: false, interruptBehavior: "block",
      run: async () => { started.push(1); await writeGate; return "write"; },
    });
    const third = executor.add({
      index: 2, signature: "read:after", concurrencySafe: true, interruptBehavior: "cancel",
      run: async () => { started.push(2); return "after"; },
    });
    expect(started).toEqual([0]);
    releaseRead();
    await waitUntil(() => started.includes(1));
    expect(started).toEqual([0, 1]);
    releaseWrite();
    await waitUntil(() => started.includes(2));
    expect(started).toEqual([0, 1, 2]);
    await expect(Promise.all([first.outcome, second.outcome, third.outcome])).resolves.toEqual([
      { status: "succeeded", value: "read" },
      { status: "succeeded", value: "write" },
      { status: "succeeded", value: "after" },
    ]);
  });

  it("cancels interruptible work but lets blocking work settle", async () => {
    const executor = new StreamingToolExecutor<string>();
    let releaseBlock!: () => void;
    const blockGate = new Promise<void>((resolve) => { releaseBlock = resolve; });
    const blocking = executor.add({
      index: 0, signature: "write", concurrencySafe: false, interruptBehavior: "block",
      run: async () => { await blockGate; return "done"; },
    });
    const queuedRead = executor.add({
      index: 1, signature: "read", concurrencySafe: true, interruptBehavior: "cancel",
      run: async () => "unexpected",
    });
    executor.cancelInterruptible("steered");
    await expect(queuedRead.outcome).resolves.toEqual({ status: "cancelled", reason: "steered" });
    releaseBlock();
    await expect(blocking.outcome).resolves.toEqual({ status: "succeeded", value: "done" });
  });

  it("deduplicates identical streamed calls and rejects index collisions", () => {
    const executor = new StreamingToolExecutor<string>();
    const request = {
      index: 0, signature: "same", concurrencySafe: true, interruptBehavior: "cancel" as const,
      run: async () => "ok",
    };
    expect(executor.add(request).outcome).toBe(executor.add(request).outcome);
    expect(() => executor.add({ ...request, signature: "different" })).toThrow("不同调用");
  });

  it("does not start interruptible work added after its parent was already aborted", async () => {
    const parent = new AbortController();
    parent.abort("steered");
    const executor = new StreamingToolExecutor<string>(parent.signal);
    let started = false;
    const entry = executor.add({
      index: 0,
      signature: "late-read",
      concurrencySafe: true,
      interruptBehavior: "cancel",
      run: async () => { started = true; return "unexpected"; },
    });
    await expect(entry.outcome).resolves.toEqual({ status: "cancelled", reason: "steered" });
    expect(started).toBe(false);
  });

  it("closes queued and running entries when a streaming attempt is discarded", async () => {
    const executor = new StreamingToolExecutor<string>();
    const running = executor.add({
      index: 0,
      signature: "running",
      concurrencySafe: false,
      interruptBehavior: "block",
      run: async (signal) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });
    const queued = executor.add({
      index: 1,
      signature: "queued",
      concurrencySafe: true,
      interruptBehavior: "cancel",
      run: async () => "unexpected",
    });
    expect(executor.list()).toHaveLength(2);
    executor.discard("fallback");
    await expect(running.outcome).resolves.toEqual({ status: "cancelled", reason: "fallback" });
    await expect(queued.outcome).resolves.toEqual({ status: "cancelled", reason: "fallback" });
  });

  it("discards calls omitted by the final provider response while retaining matched calls", async () => {
    const executor = new StreamingToolExecutor<string>();
    const matched = executor.add({
      index: 0,
      signature: "matched",
      concurrencySafe: true,
      interruptBehavior: "cancel",
      run: async () => "kept",
    });
    const orphaned = executor.add({
      index: 1,
      signature: "orphaned",
      concurrencySafe: true,
      interruptBehavior: "cancel",
      run: async (signal) => new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    });

    const discarded = executor.discardExcept([{ index: 0, signature: "matched" }], "provider_omitted");

    expect(discarded).toHaveLength(1);
    await expect(matched.outcome).resolves.toEqual({ status: "succeeded", value: "kept" });
    await expect(orphaned.outcome).resolves.toEqual({ status: "cancelled", reason: "provider_omitted" });
  });
});

async function waitUntil(predicate: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not reached");
}
