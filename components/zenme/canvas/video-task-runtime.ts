import type { CanvasNode } from "@/components/zenme/canvas/types";
import type { VideoTaskStatus } from "@/lib/zenme-api";

export const VIDEO_TASK_POLL_INTERVAL_MS = 5_000;
export const VIDEO_TASK_TIMEOUT_MS = 15 * 60 * 1_000;

type VideoTaskStatusResult = {
  error?: string;
  status: VideoTaskStatus;
  taskId: string;
};

export function recoverInterruptedVideoTasks(nodes: CanvasNode[]) {
  const resumable: CanvasNode[] = [];
  const recoveredNodes = nodes.map((node) => {
    if (
      node.data.kind !== "video" ||
      node.data.videoStatus !== "generating" ||
      !node.data.videoGenerationResult
    ) {
      return node;
    }
    if (node.data.providerTaskId && node.data.videoModel) {
      resumable.push(node);
      return node;
    }
    return {
      ...node,
      data: {
        ...node.data,
        videoError: "任务因页面刷新或应用重启而中断，且缺少服务商任务 ID，请重新提交",
        videoStatus: "failed" as const,
      },
    };
  });
  return { nodes: recoveredNodes, resumable };
}

export async function waitForVideoTaskCompletion(input: {
  getStatus: () => Promise<VideoTaskStatusResult>;
  signal: AbortSignal;
  startedAt: string;
  now?: () => number;
  sleep?: (durationMs: number, signal: AbortSignal) => Promise<void>;
}) {
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? abortableDelay;
  const startedAt = Date.parse(input.startedAt);
  const deadline = (Number.isFinite(startedAt) ? startedAt : now()) + VIDEO_TASK_TIMEOUT_MS;

  while (now() < deadline) {
    if (input.signal.aborted) throw createAbortError();
    const task = await input.getStatus();
    if (task.status === "succeeded") return task;
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(task.error || "视频任务未完成");
    }
    await sleep(Math.min(VIDEO_TASK_POLL_INTERVAL_MS, Math.max(0, deadline - now())), input.signal);
  }
  throw new Error("视频任务执行超过 15 分钟，请重新提交");
}

function abortableDelay(durationMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(createAbortError());
    };
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, durationMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError() {
  return new DOMException("视频任务轮询已停止", "AbortError");
}
