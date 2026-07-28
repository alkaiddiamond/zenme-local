import type { CanvasNode } from "@/components/zenme/canvas/types";
import type { Execution, ExecutionAttempt, NodeRun } from "@/lib/execution/types";
import { isActiveExecutionStatus } from "@/lib/execution/types";

export type RecoverableVideoExecution = {
  attempt: ExecutionAttempt;
  execution: Execution;
  nodeRun: NodeRun;
};

export function reconcileCanvasExecutions(input: {
  executions: Execution[];
  nodes: CanvasNode[];
  projectId: string;
}) {
  const recordByNodeId = new Map<string, RecoverableVideoExecution>();
  for (const execution of input.executions) {
    for (const nodeRun of execution.nodeRuns) {
      const attempt = nodeRun.attempts.find(
        (candidate) => candidate.id === nodeRun.currentAttemptId,
      );
      if (attempt) recordByNodeId.set(nodeRun.nodeId, { execution, nodeRun, attempt });
    }
  }

  const recoverableVideos: RecoverableVideoExecution[] = [];
  const interruptedAttempts: RecoverableVideoExecution[] = [];
  let changed = false;
  const nodes = input.nodes.map((node) => {
    const record = recordByNodeId.get(node.id);
    if (!record) return node;
    const identity = {
      executionId: record.execution.id,
      nodeRunId: record.nodeRun.id,
      attemptId: record.attempt.id,
      externalTaskId: record.attempt.externalTaskId,
    };
    const errorMessage = record.attempt.error?.message ?? terminalStatusMessage(record.attempt.status);

    if (node.data.kind === "agent") {
      if (record.attempt.status === "succeeded" && record.attempt.outputText !== undefined) {
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            ...identity,
            aiError: undefined,
            aiResponse: record.attempt.outputText,
            aiStatus: "done" as const,
            plainText: record.attempt.outputText,
          },
        };
      }
      if (isActiveExecutionStatus(record.attempt.status)) {
        interruptedAttempts.push(record);
        changed = true;
        return failInterruptedNode(node, identity, "文本请求因应用重启而中断，请重试");
      }
      if (errorMessage) {
        changed = true;
        return failInterruptedNode(node, identity, errorMessage);
      }
    }

    const asset = record.attempt.assetRefs[0];
    if (node.data.kind === "imageGeneration" && node.data.imageGenerationResult) {
      if (record.attempt.status === "succeeded" && asset) {
        changed = true;
        return {
          ...node,
          type: "image",
          data: {
            ...node.data,
            ...identity,
            assetRefs: record.attempt.assetRefs,
            fileId: asset.fileId,
            kind: "image" as const,
            imageError: undefined,
            imageGenerated: true,
            imageStatus: "done" as const,
            originalUrl: projectFileUrl(input.projectId, asset.fileId),
            previewUrl: projectFileUrl(input.projectId, asset.fileId),
            uploadStatus: "uploaded" as const,
          },
        };
      }
      if (isActiveExecutionStatus(record.attempt.status) || errorMessage) {
        if (isActiveExecutionStatus(record.attempt.status)) interruptedAttempts.push(record);
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            ...identity,
            imageError: errorMessage || "图片请求因应用重启而中断，请重试",
            imageStatus: "failed" as const,
          },
        };
      }
    }

    if (node.data.kind === "video" && node.data.videoGenerationResult) {
      if (record.attempt.status === "succeeded" && asset) {
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            ...identity,
            assetRefs: record.attempt.assetRefs,
            fileId: asset.fileId,
            originalUrl: projectFileUrl(input.projectId, asset.fileId),
            videoError: undefined,
            videoStatus: "done" as const,
          },
        };
      }
      if (isActiveExecutionStatus(record.attempt.status) && record.attempt.externalTaskId) {
        recoverableVideos.push(record);
        changed = changed || node.data.externalTaskId !== record.attempt.externalTaskId;
        return { ...node, data: { ...node.data, ...identity } };
      }
      if (isActiveExecutionStatus(record.attempt.status) || errorMessage) {
        if (isActiveExecutionStatus(record.attempt.status)) interruptedAttempts.push(record);
        changed = true;
        return {
          ...node,
          data: {
            ...node.data,
            ...identity,
            videoError: errorMessage || "视频任务缺少服务商任务 ID，请重试",
            videoStatus: "failed" as const,
          },
        };
      }
    }

    return node;
  });

  return { changed, interruptedAttempts, nodes, recoverableVideos };
}

function failInterruptedNode(
  node: CanvasNode,
  identity: Pick<CanvasNode["data"], "attemptId" | "executionId" | "externalTaskId" | "nodeRunId">,
  message: string,
): CanvasNode {
  return {
    ...node,
    data: {
      ...node.data,
      ...identity,
      aiError: message,
      aiStatus: "failed",
    },
  };
}

function terminalStatusMessage(status: ExecutionAttempt["status"]) {
  if (status === "stopped") return "任务已停止";
  if (status === "timedOut") return "任务执行超时，请重试";
  if (status === "failed") return "任务执行失败，请重试";
  return "";
}

function projectFileUrl(projectId: string, fileId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`;
}
