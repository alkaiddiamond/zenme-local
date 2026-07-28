import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAssetRef } from "@/lib/execution/types";
import {
  createLocalExecution,
  getLocalExecution,
  listRecoverableLocalExecutions,
  retryLocalNodeRun,
  stopLocalExecution,
  updateLocalExecutionAttempt,
} from "@/lib/local/execution-repository";

let dataDir: string;
const projectId = "project-1";

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-executions-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local execution repository", () => {
  it("persists Execution, NodeRun, Attempt, externalTaskId and AssetRef", async () => {
    const created = await createLocalExecution({
      executionId: "execution-1",
      nodeRunId: "node-run-1",
      attemptId: "attempt-1",
      projectId,
      triggerNodeId: "video-request",
      nodeId: "video-result",
      kind: "video",
      providerId: "volcengine",
      modelId: "seedance",
      input: { prompt: "生成视频", parameters: { duration: 5 } },
      startedAt: "2026-07-26T00:00:00.000Z",
    }, dataDir);
    const asset = createAssetRef({
      fileId: "file-1",
      fileName: "result.mp4",
      kind: "video",
      mimeType: "video/mp4",
      projectId,
      sizeBytes: 1024,
      createdAt: "2026-07-26T00:01:00.000Z",
    });

    await updateLocalExecutionAttempt({
      projectId,
      executionId: created.id,
      nodeRunId: created.nodeRuns[0].id,
      attemptId: created.nodeRuns[0].currentAttemptId,
      externalTaskId: "provider-task-123",
      status: "polling",
      updatedAt: "2026-07-26T00:00:05.000Z",
    }, dataDir);
    await updateLocalExecutionAttempt({
      projectId,
      executionId: created.id,
      nodeRunId: created.nodeRuns[0].id,
      attemptId: created.nodeRuns[0].currentAttemptId,
      assetRefs: [asset],
      status: "succeeded",
      updatedAt: "2026-07-26T00:01:00.000Z",
    }, dataDir);

    await expect(getLocalExecution({ projectId, executionId: created.id }, dataDir)).resolves.toMatchObject({
      status: "succeeded",
      nodeRuns: [{
        status: "succeeded",
        attempts: [{
          externalTaskId: "provider-task-123",
          input: { prompt: "生成视频", parameters: { duration: 5 } },
          assetRefs: [{ fileId: "file-1", kind: "video" }],
        }],
      }],
    });
    await expect(listRecoverableLocalExecutions(projectId, dataDir)).resolves.toEqual([]);
  });

  it("creates a new Attempt on retry without erasing prior evidence", async () => {
    const execution = await createLocalExecution({
      projectId,
      triggerNodeId: "image-request",
      nodeId: "image-result",
      kind: "image",
      input: { prompt: "生成图片" },
    }, dataDir);
    const nodeRun = execution.nodeRuns[0];
    await updateLocalExecutionAttempt({
      projectId,
      executionId: execution.id,
      nodeRunId: nodeRun.id,
      attemptId: nodeRun.currentAttemptId,
      status: "failed",
      error: { code: "provider_failed", message: "上游失败", retryable: true, stage: "submit" },
    }, dataDir);

    const retried = await retryLocalNodeRun({
      projectId,
      executionId: execution.id,
      nodeRunId: nodeRun.id,
      providerId: "openai-compatible",
      modelId: "image-model",
    }, dataDir);

    expect(retried.attempt.sequence).toBe(2);
    expect(retried.attempt.input).toEqual({ prompt: "生成图片" });
    expect(retried.execution.nodeRuns[0].attempts).toHaveLength(2);
    expect(retried.execution.nodeRuns[0].attempts[0].error?.code).toBe("provider_failed");
    expect(retried.execution.status).toBe("running");
  });

  it("stops every active NodeRun and Attempt atomically", async () => {
    const execution = await createLocalExecution({
      projectId,
      triggerNodeId: "text-request",
      nodeId: "text-result",
      kind: "text",
    }, dataDir);

    const stopped = await stopLocalExecution({ projectId, executionId: execution.id }, dataDir);
    expect(stopped.status).toBe("stopped");
    expect(stopped.nodeRuns[0].status).toBe("stopped");
    expect(stopped.nodeRuns[0].attempts[0].status).toBe("stopped");

    const lateResult = await updateLocalExecutionAttempt({
      projectId,
      executionId: execution.id,
      nodeRunId: execution.nodeRuns[0].id,
      attemptId: execution.nodeRuns[0].currentAttemptId,
      status: "succeeded",
    }, dataDir);
    expect(lateResult.status).toBe("stopped");
    expect(lateResult.nodeRuns[0].attempts[0].status).toBe("stopped");
  });

  it("migrates the legacy taskId store to externalTaskId and rewrites it", async () => {
    const storePath = path.join(dataDir, "projects", projectId, "executions", "index.json");
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    await fs.writeFile(storePath, JSON.stringify({
      version: 0,
      runs: [{
        id: "legacy-execution",
        projectId,
        nodeId: "legacy-video",
        kind: "video",
        status: "polling",
        taskId: "legacy-provider-task",
        modelId: "legacy-model",
        createdAt: "2026-07-25T00:00:00.000Z",
        updatedAt: "2026-07-25T00:01:00.000Z",
      }],
    }), "utf8");

    const recovered = await listRecoverableLocalExecutions(projectId, dataDir);
    expect(recovered[0]).toMatchObject({
      id: "legacy-execution",
      nodeRuns: [{ attempts: [{ externalTaskId: "legacy-provider-task" }] }],
    });
    const persisted = JSON.parse(await fs.readFile(storePath, "utf8"));
    expect(persisted.version).toBe(1);
    expect(JSON.stringify(persisted)).not.toContain('"taskId"');
  });
});
