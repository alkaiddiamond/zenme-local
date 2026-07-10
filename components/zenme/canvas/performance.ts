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
};

type PerformanceObserverEntryListLike = {
  getEntries: () => PerformanceEntry[];
};

const PERF_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_ZENME_PERF_DEBUG === "1";
const MAX_PERF_METRICS = 100;

type CanvasInteractionSample = {
  detail?: Record<string, unknown>;
  frameCount: number;
  label: string;
  lastTickAt: number;
  maxFrameGap: number;
  startedAt: number;
};

export function measureCanvasPerf<T>(
  label: string,
  callback: () => T,
  detail?: Record<string, unknown>,
) {
  if (!PERF_DEBUG_ENABLED || typeof performance === "undefined") {
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
  if (!PERF_DEBUG_ENABLED) {
    return fallback;
  }

  return callback();
}

export async function measureCanvasPerfAsync<T>(
  label: string,
  callback: () => Promise<T>,
  detail?: Record<string, unknown>,
) {
  if (!PERF_DEBUG_ENABLED || typeof performance === "undefined") {
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
  if (!PERF_DEBUG_ENABLED || typeof performance === "undefined") {
    return null;
  }

  const startedAt = performance.now();
  const sample: CanvasInteractionSample = {
    detail,
    frameCount: 0,
    label,
    lastTickAt: startedAt,
    maxFrameGap: 0,
    startedAt,
  };

  return sample;
}

export function tickCanvasInteractionSample(
  sample: CanvasInteractionSample | null,
) {
  if (!sample || typeof performance === "undefined") {
    return;
  }

  const now = performance.now();
  const frameGap = now - sample.lastTickAt;
  sample.frameCount += 1;
  sample.lastTickAt = now;
  sample.maxFrameGap = Math.max(sample.maxFrameGap, frameGap);
}

export function stopCanvasInteractionSample(
  sample: CanvasInteractionSample | null,
  detail?: Record<string, unknown>,
) {
  if (!sample || typeof performance === "undefined") {
    return;
  }

  const duration = performance.now() - sample.startedAt;
  logCanvasPerf(sample.label, duration, {
    ...sample.detail,
    ...detail,
    averageFrameGap:
      sample.frameCount > 0 ? duration / sample.frameCount : duration,
    frameCount: sample.frameCount,
    maxFrameGap: sample.maxFrameGap,
  });
}

export function observeCanvasLongTasks(
  detail?: Record<string, unknown>,
) {
  if (
    !PERF_DEBUG_ENABLED ||
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
