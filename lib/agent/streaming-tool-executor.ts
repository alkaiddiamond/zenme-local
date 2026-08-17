export type StreamingToolInterruptBehavior = "cancel" | "block";

export type StreamingToolOutcome<T> =
  | { status: "succeeded"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "cancelled"; reason: unknown };

export type StreamingToolRequest<T> = {
  index: number;
  signature: string;
  concurrencySafe: boolean;
  interruptBehavior: StreamingToolInterruptBehavior;
  run: (signal: AbortSignal) => Promise<T>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

type TrackedTool<T> = StreamingToolRequest<T> & {
  controller: AbortController;
  deferred: Deferred<StreamingToolOutcome<T>>;
  status: "queued" | "executing" | "completed";
};

export class StreamingToolExecutor<T> {
  private readonly entries: TrackedTool<T>[] = [];
  private discarded = false;
  private parentAborted = false;
  private parentAbortReason: unknown;

  constructor(
    private readonly parentSignal?: AbortSignal,
    private readonly maxConcurrency = 10,
  ) {
    if (parentSignal?.aborted) {
      this.parentAborted = true;
      this.parentAbortReason = parentSignal.reason ?? "interrupted";
    } else {
      parentSignal?.addEventListener("abort", this.handleParentAbort, { once: true });
    }
  }

  add(request: StreamingToolRequest<T>) {
    const existing = this.entries.find((entry) => entry.index === request.index);
    if (existing) {
      if (existing.signature !== request.signature) {
        throw new Error(`流式工具索引 ${request.index} 对应了不同调用`);
      }
      return this.publicEntry(existing);
    }
    const deferred = createDeferred<StreamingToolOutcome<T>>();
    const entry: TrackedTool<T> = {
      ...request,
      controller: new AbortController(),
      deferred,
      status: "queued",
    };
    this.entries.push(entry);
    this.entries.sort((left, right) => left.index - right.index);
    if (this.discarded) {
      entry.status = "completed";
      deferred.resolve({ status: "cancelled", reason: "streaming_fallback" });
    } else if (this.parentAborted && entry.interruptBehavior === "cancel") {
      entry.status = "completed";
      deferred.resolve({ status: "cancelled", reason: this.parentAbortReason });
    } else {
      this.processQueue();
    }
    return this.publicEntry(entry);
  }

  get(index: number, signature: string) {
    const entry = this.entries.find((candidate) =>
      candidate.index === index && candidate.signature === signature,
    );
    return entry ? this.publicEntry(entry) : null;
  }

  list() {
    return this.entries.map((entry) => this.publicEntry(entry));
  }

  discardExcept(
    retained: readonly { index: number; signature: string }[],
    reason: unknown = "orphaned_streamed_tool",
  ) {
    const retainedKeys = new Set(retained.map((entry) => entryKey(entry.index, entry.signature)));
    const discarded: TrackedTool<T>[] = [];
    for (const entry of this.entries) {
      if (retainedKeys.has(entryKey(entry.index, entry.signature))) continue;
      discarded.push(entry);
      if (entry.status === "completed") continue;
      if (entry.status === "queued") {
        entry.status = "completed";
        entry.deferred.resolve({ status: "cancelled", reason });
      } else {
        entry.controller.abort(reason);
      }
    }
    this.processQueue();
    return discarded.map((entry) => this.publicEntry(entry));
  }

  cancelInterruptible(reason: unknown = "interrupted") {
    for (const entry of this.entries) {
      if (entry.status === "completed" || entry.interruptBehavior !== "cancel") continue;
      if (entry.status === "queued") {
        entry.status = "completed";
        entry.deferred.resolve({ status: "cancelled", reason });
      } else {
        entry.controller.abort(reason);
      }
    }
    this.processQueue();
  }

  discard(reason: unknown = "streaming_fallback") {
    if (this.discarded) return;
    this.discarded = true;
    for (const entry of this.entries) {
      if (entry.status === "completed") continue;
      if (entry.status === "queued") {
        entry.status = "completed";
        entry.deferred.resolve({ status: "cancelled", reason });
      } else {
        entry.controller.abort(reason);
      }
    }
  }

  dispose() {
    this.parentSignal?.removeEventListener("abort", this.handleParentAbort);
  }

  private readonly handleParentAbort = () => {
    this.parentAborted = true;
    this.parentAbortReason = this.parentSignal?.reason ?? "interrupted";
    this.cancelInterruptible(this.parentAbortReason);
  };

  private publicEntry(entry: TrackedTool<T>) {
    return {
      index: entry.index,
      signature: entry.signature,
      concurrencySafe: entry.concurrencySafe,
      interruptBehavior: entry.interruptBehavior,
      outcome: entry.deferred.promise,
    } as const;
  }

  private processQueue() {
    if (this.discarded) return;
    for (const entry of this.entries) {
      if (entry.status !== "queued") continue;
      const executing = this.entries.filter((candidate) => candidate.status === "executing");
      if (executing.length >= this.maxConcurrency) return;
      const canStart = executing.length === 0 || (
        entry.concurrencySafe && executing.every((candidate) => candidate.concurrencySafe)
      );
      if (!canStart) return;
      this.start(entry);
    }
  }

  private start(entry: TrackedTool<T>) {
    entry.status = "executing";
    void entry.run(entry.controller.signal).then(
      (value) => {
        entry.status = "completed";
        entry.deferred.resolve({ status: "succeeded", value });
      },
      (error) => {
        entry.status = "completed";
        entry.deferred.resolve(entry.controller.signal.aborted
          ? { status: "cancelled", reason: entry.controller.signal.reason ?? error }
          : { status: "failed", error });
      },
    ).finally(() => this.processQueue());
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function entryKey(index: number, signature: string) {
  return `${index}\u0000${signature}`;
}
