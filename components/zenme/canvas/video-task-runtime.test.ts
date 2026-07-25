import { describe, expect, it } from "vitest";
import type { CanvasNode } from "@/components/zenme/canvas/types";
import {
  recoverInterruptedVideoTasks,
  VIDEO_TASK_TIMEOUT_MS,
  waitForVideoTaskCompletion,
} from "@/components/zenme/canvas/video-task-runtime";

function videoNode(data: CanvasNode["data"]): CanvasNode {
  return { id: "video-1", position: { x: 0, y: 0 }, type: "video", data };
}

describe("video task runtime", () => {
  it("保留带服务商任务 ID 的任务供恢复轮询", () => {
    const node = videoNode({
      kind: "video",
      providerTaskId: "cgt-123",
      videoGenerationResult: true,
      videoModel: "provider/model",
      videoStatus: "generating",
    });
    const recovered = recoverInterruptedVideoTasks([node]);
    expect(recovered.nodes[0]).toBe(node);
    expect(recovered.resumable).toEqual([node]);
  });

  it("将没有服务商任务 ID 的旧生成节点标记为失败", () => {
    const recovered = recoverInterruptedVideoTasks([videoNode({
      kind: "video",
      videoGenerationResult: true,
      videoModel: "provider/model",
      videoStatus: "generating",
    })]);
    expect(recovered.nodes[0].data).toMatchObject({
      videoStatus: "failed",
      videoError: expect.stringContaining("缺少服务商任务 ID"),
    });
    expect(recovered.resumable).toEqual([]);
  });

  it("轮询直到异步任务成功", async () => {
    const statuses: Array<"running" | "succeeded"> = ["running", "succeeded"];
    let now = 1_000;
    const result = await waitForVideoTaskCompletion({
      getStatus: async () => ({ status: statuses.shift() ?? "succeeded", taskId: "cgt-123" }),
      now: () => now,
      signal: new AbortController().signal,
      sleep: async (duration) => { now += duration; },
      startedAt: new Date(now).toISOString(),
    });
    expect(result.status).toBe("succeeded");
  });

  it("从持久化开始时间计算超时", async () => {
    const now = 1_000 + VIDEO_TASK_TIMEOUT_MS;
    await expect(waitForVideoTaskCompletion({
      getStatus: async () => ({ status: "running", taskId: "cgt-123" }),
      now: () => now,
      signal: new AbortController().signal,
      sleep: async () => undefined,
      startedAt: new Date(1_000).toISOString(),
    })).rejects.toThrow("超过 15 分钟");
  });
});
