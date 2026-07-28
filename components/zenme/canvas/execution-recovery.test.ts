import { describe, expect, it } from "vitest";

import { reconcileCanvasExecutions } from "@/components/zenme/canvas/execution-recovery";
import type { CanvasNode } from "@/components/zenme/canvas/types";
import type { Execution, ExecutionStatus } from "@/lib/execution/types";

function execution(input: {
  asset?: boolean;
  externalTaskId?: string;
  kind: "text" | "image" | "video";
  nodeId: string;
  outputText?: string;
  status: ExecutionStatus;
}): Execution {
  return {
    id: `execution-${input.nodeId}`,
    projectId: "project-1",
    triggerNodeId: "request",
    status: input.status,
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:01.000Z",
    nodeRuns: [{
      id: `run-${input.nodeId}`,
      executionId: `execution-${input.nodeId}`,
      nodeId: input.nodeId,
      kind: input.kind,
      status: input.status,
      currentAttemptId: `attempt-${input.nodeId}`,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:01.000Z",
      attempts: [{
        id: `attempt-${input.nodeId}`,
        sequence: 1,
        status: input.status,
        externalTaskId: input.externalTaskId,
        outputText: input.outputText,
        assetRefs: input.asset ? [{
          id: "asset-1",
          fileId: "file-1",
          projectId: "project-1",
          kind: input.kind === "video" ? "video" : "image",
          fileName: input.kind === "video" ? "result.mp4" : "result.png",
          mimeType: input.kind === "video" ? "video/mp4" : "image/png",
          sizeBytes: 100,
          createdAt: "2026-07-26T00:00:01.000Z",
        }] : [],
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:01.000Z",
      }],
    }],
  };
}

function node(id: string, data: CanvasNode["data"]): CanvasNode {
  return { id, type: data.kind, position: { x: 0, y: 0 }, data };
}

describe("canvas execution recovery", () => {
  it("restores completed text and local media results from execution evidence", () => {
    const result = reconcileCanvasExecutions({
      projectId: "project-1",
      executions: [
        execution({ kind: "text", nodeId: "text", status: "succeeded", outputText: "恢复的回复" }),
        execution({ kind: "image", nodeId: "image", status: "succeeded", asset: true }),
      ],
      nodes: [
        node("text", { kind: "agent", title: "AI 回复", aiStatus: "generating" }),
        node("image", { kind: "imageGeneration", title: "图片生成", imageGenerationResult: true, imageStatus: "editing" }),
      ],
    });
    expect(result.nodes[0].data).toMatchObject({ aiStatus: "done", aiResponse: "恢复的回复" });
    expect(result.nodes[1]).toMatchObject({
      type: "image",
      data: { kind: "image", imageStatus: "done", fileId: "file-1" },
    });
  });

  it("resumes only async video attempts with an external task ID", () => {
    const result = reconcileCanvasExecutions({
      projectId: "project-1",
      executions: [execution({
        kind: "video",
        nodeId: "video",
        status: "polling",
        externalTaskId: "provider-task",
      })],
      nodes: [node("video", {
        kind: "video",
        title: "视频生成",
        videoGenerationResult: true,
        videoStatus: "generating",
      })],
    });
    expect(result.recoverableVideos).toHaveLength(1);
    expect(result.nodes[0].data.externalTaskId).toBe("provider-task");
  });

  it("marks synchronous requests interrupted after restart", () => {
    const result = reconcileCanvasExecutions({
      projectId: "project-1",
      executions: [execution({ kind: "text", nodeId: "text", status: "running" })],
      nodes: [node("text", { kind: "agent", title: "AI 回复", aiStatus: "generating" })],
    });
    expect(result.nodes[0].data).toMatchObject({ aiStatus: "failed" });
    expect(result.nodes[0].data.aiError).toContain("应用重启");
  });
});
