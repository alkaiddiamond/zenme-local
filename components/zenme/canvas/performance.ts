type IdleCallbackHandle = number;

type IdleCallbackOptions = {
  timeout?: number;
};

type WindowWithIdleCallback = Window & {
  cancelIdleCallback?: (handle: IdleCallbackHandle) => void;
  requestIdleCallback?: (
    callback: () => void,
    options?: IdleCallbackOptions,
  ) => IdleCallbackHandle;
};

export type CanvasPerfMetric = {
  detail?: Record<string, unknown>;
  duration: number;
  label: string;
  timestamp: number;
};

export type CanvasPerfSummaryItem = {
  averageDuration: number;
  count: number;
  label: string;
  lastDetail?: Record<string, unknown>;
  lastDuration: number;
  maxDuration: number;
  totalDuration: number;
};

type WindowWithCanvasPerf = Window & {
  __ZENME_CANVAS_PERF__?: CanvasPerfMetric[];
  __ZENME_CANVAS_PERF_SUMMARY__?: () => CanvasPerfSummaryItem[];
  __ZENME_CANVAS_RUNTIME_COMMIT_COUNT__?: number;
};

type PerformanceObserverEntryListLike = {
  getEntries: () => PerformanceEntry[];
};

const PERF_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_ZENME_PERF_DEBUG === "1";
const MAX_PERF_METRICS = 100;
let runtimePerfHref = "";
let runtimePerfEnabled = false;

function isCanvasPerfDebugEnabled() {
  if (PERF_DEBUG_ENABLED) return true;
  if (typeof window === "undefined") return false;
  if (runtimePerfHref !== window.location.href) {
    runtimePerfHref = window.location.href;
    runtimePerfEnabled = new URLSearchParams(window.location.search).has(
      "zenmePerfRuntime",
    );
  }
  return runtimePerfEnabled;
}

export function recordCanvasClientCommit() {
  if (
    typeof window === "undefined" ||
    !new URLSearchParams(window.location.search).has("zenmePerfRuntime")
  ) {
    return;
  }

  const perfWindow = window as WindowWithCanvasPerf;
  perfWindow.__ZENME_CANVAS_RUNTIME_COMMIT_COUNT__ =
    (perfWindow.__ZENME_CANVAS_RUNTIME_COMMIT_COUNT__ ?? 0) + 1;
}

type CanvasInteractionSample = {
  detail?: Record<string, unknown>;
  eventCount: number;
  frameDurations: number[];
  frameCount: number;
  frameHandle: number | null;
  label: string;
  lastFrameAt: number;
  maxFrameGap: number;
  startedAt: number;
};

export type CanvasFrameSummary = {
  averageFrameGap: number;
  droppedFrameCount: number;
  longFrameCount: number;
  maxFrameGap: number;
  p50FrameGap: number;
  p95FrameGap: number;
  p99FrameGap: number;
};

const CANVAS_FRAME_BUDGET_MS = 1000 / 60;
const MAX_INTERACTION_FRAME_SAMPLES = 20_000;

export function measureCanvasPerf<T>(
  label: string,
  callback: () => T,
  detail?: Record<string, unknown>,
) {
  if (!isCanvasPerfDebugEnabled() || typeof performance === "undefined") {
    return callback();
  }

  const startedAt = performance.now();
  const result = callback();
  const duration = performance.now() - startedAt;
  logCanvasPerf(label, duration, detail);
  return result;
}

export function inspectCanvasPerf<T>(
  callback: () => T,
  fallback: T,
) {
  if (!isCanvasPerfDebugEnabled()) {
    return fallback;
  }

  return callback();
}

export async function measureCanvasPerfAsync<T>(
  label: string,
  callback: () => Promise<T>,
  detail?: Record<string, unknown>,
) {
  if (!isCanvasPerfDebugEnabled() || typeof performance === "undefined") {
    return callback();
  }

  const startedAt = performance.now();
  const result = await callback();
  const duration = performance.now() - startedAt;
  logCanvasPerf(label, duration, detail);
  return result;
}

export function scheduleCanvasIdleTask(
  callback: () => void,
  timeout = 1200,
) {
  const idleWindow = window as WindowWithIdleCallback;

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, 0);
  return () => window.clearTimeout(handle);
}

export function startCanvasInteractionSample(
  label: string,
  detail?: Record<string, unknown>,
) {
  if (!isCanvasPerfDebugEnabled() || typeof performance === "undefined") {
    return null;
  }

  const startedAt = performance.now();
  const sample: CanvasInteractionSample = {
    detail,
    eventCount: 0,
    frameDurations: [],
    frameCount: 0,
    frameHandle: null,
    label,
    lastFrameAt: startedAt,
    maxFrameGap: 0,
    startedAt,
  };

  if (typeof window !== "undefined") {
    const captureFrame = (now: number) => {
      const frameGap = now - sample.lastFrameAt;
      sample.frameCount += 1;
      sample.lastFrameAt = now;
      sample.maxFrameGap = Math.max(sample.maxFrameGap, frameGap);
      if (sample.frameDurations.length < MAX_INTERACTION_FRAME_SAMPLES) {
        sample.frameDurations.push(frameGap);
      }
      sample.frameHandle = window.requestAnimationFrame(captureFrame);
    };
    sample.frameHandle = window.requestAnimationFrame(captureFrame);
  }

  return sample;
}

export function tickCanvasInteractionSample(
  sample: CanvasInteractionSample | null,
) {
  if (!sample || typeof performance === "undefined") {
    return;
  }
  sample.eventCount += 1;
}

export function stopCanvasInteractionSample(
  sample: CanvasInteractionSample | null,
  detail?: Record<string, unknown>,
) {
  if (!sample || typeof performance === "undefined") {
    return;
  }

  if (sample.frameHandle !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(sample.frameHandle);
    sample.frameHandle = null;
  }

  const duration = performance.now() - sample.startedAt;
  const frameSummary = summarizeCanvasFrameDurations(sample.frameDurations);
  logCanvasPerf(sample.label, duration, {
    ...sample.detail,
    ...detail,
    ...frameSummary,
    eventCount: sample.eventCount,
    frameCount: sample.frameCount,
  });
}

export function summarizeCanvasFrameDurations(
  frameDurations: number[],
): CanvasFrameSummary {
  const sortedDurations = frameDurations
    .filter((duration) => Number.isFinite(duration) && duration >= 0)
    .sort((first, second) => first - second);
  if (sortedDurations.length === 0) {
    return {
      averageFrameGap: 0,
      droppedFrameCount: 0,
      longFrameCount: 0,
      maxFrameGap: 0,
      p50FrameGap: 0,
      p95FrameGap: 0,
      p99FrameGap: 0,
    };
  }

  const total = sortedDurations.reduce((sum, duration) => sum + duration, 0);
  return {
    averageFrameGap: total / sortedDurations.length,
    droppedFrameCount: sortedDurations.filter(
      (duration) => duration > CANVAS_FRAME_BUDGET_MS,
    ).length,
    longFrameCount: sortedDurations.filter((duration) => duration > 50).length,
    maxFrameGap: sortedDurations.at(-1) ?? 0,
    p50FrameGap: percentile(sortedDurations, 0.5),
    p95FrameGap: percentile(sortedDurations, 0.95),
    p99FrameGap: percentile(sortedDurations, 0.99),
  };
}

function percentile(sortedValues: number[], percentileValue: number) {
  const index = Math.max(
    0,
    Math.min(
      sortedValues.length - 1,
      Math.ceil(sortedValues.length * percentileValue) - 1,
    ),
  );
  return sortedValues[index] ?? 0;
}

export function observeCanvasLongTasks(
  detail?: Record<string, unknown>,
) {
  if (
    !isCanvasPerfDebugEnabled() ||
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    return () => {};
  }

  const observer = new PerformanceObserver(
    (list: PerformanceObserverEntryListLike) => {
      for (const entry of list.getEntries()) {
        logCanvasPerf("long task", entry.duration, {
          ...detail,
          name: entry.name,
          startTime: entry.startTime,
        });
      }
    },
  );

  try {
    observer.observe({ buffered: true, type: "longtask" });
  } catch {
    return () => {};
  }

  return () => observer.disconnect();
}

function logCanvasPerf(
  label: string,
  duration: number,
  detail?: Record<string, unknown>,
) {
  recordCanvasPerfMetric({
    detail,
    duration,
    label,
    timestamp: Date.now(),
  });
  console.debug("[zenme:perf]", label, `${duration.toFixed(1)}ms`, detail ?? "");
}

function recordCanvasPerfMetric(metric: CanvasPerfMetric) {
  if (typeof window === "undefined") {
    return;
  }

  const perfWindow = window as WindowWithCanvasPerf;
  const metrics = perfWindow.__ZENME_CANVAS_PERF__ ?? [];
  metrics.push(metric);
  perfWindow.__ZENME_CANVAS_PERF__ = metrics.slice(-MAX_PERF_METRICS);
  if (!perfWindow.__ZENME_CANVAS_PERF_SUMMARY__) {
    perfWindow.__ZENME_CANVAS_PERF_SUMMARY__ = summarizeCanvasPerfMetrics;
  }
}

function summarizeCanvasPerfMetrics() {
  if (typeof window === "undefined") {
    return [];
  }

  const perfWindow = window as WindowWithCanvasPerf;
  const metrics = perfWindow.__ZENME_CANVAS_PERF__ ?? [];
  const summaryByLabel = new Map<string, CanvasPerfSummaryItem>();

  for (const metric of metrics) {
    const current = summaryByLabel.get(metric.label);
    if (!current) {
      summaryByLabel.set(metric.label, {
        averageDuration: metric.duration,
        count: 1,
        label: metric.label,
        lastDetail: metric.detail,
        lastDuration: metric.duration,
        maxDuration: metric.duration,
        totalDuration: metric.duration,
      });
      continue;
    }

    current.count += 1;
    current.lastDetail = metric.detail;
    current.lastDuration = metric.duration;
    current.maxDuration = Math.max(current.maxDuration, metric.duration);
    current.totalDuration += metric.duration;
    current.averageDuration = current.totalDuration / current.count;
  }

  return Array.from(summaryByLabel.values()).sort(
    (first, second) => second.maxDuration - first.maxDuration,
  );
}
