import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GET as listExecutions,
  POST as createExecution,
} from "@/app/api/projects/[projectId]/executions/route";
import { PATCH as updateExecution } from "@/app/api/projects/[projectId]/executions/[executionId]/route";
import { createLocalProject } from "@/lib/local/project-repository";
import { importLocalProjectFile } from "@/lib/local/project-files-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-executions-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  projectId = (await createLocalProject({ name: "Execution API", prompt: "", model: "" }, dataDir)).id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("project executions API", () => {
  it("persists provider task IDs and resolves local file IDs into AssetRefs", async () => {
    const createResponse = await createExecution(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({
        kind: "video",
        nodeId: "video-result",
        triggerNodeId: "video-request",
        modelId: "provider/video-model",
        input: { prompt: "生成视频", parameters: { duration: 5 } },
      }),
    }), { params: Promise.resolve({ projectId }) });
    expect(createResponse.status).toBe(201);
    const execution = await createResponse.json();
    const nodeRun = execution.nodeRuns[0];
    const file = await importLocalProjectFile({
      projectId,
      bytes: Buffer.from("video"),
      fileName: "result.mp4",
      mimeType: "video/mp4",
    }, dataDir);

    const pollingResponse = await updateExecution(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({
        action: "updateAttempt",
        nodeRunId: nodeRun.id,
        attemptId: nodeRun.currentAttemptId,
        externalTaskId: "provider-task",
        input: { prompt: "生成视频", parameters: { duration: 5 } },
        status: "polling",
      }),
    }), { params: Promise.resolve({ projectId, executionId: execution.id }) });
    expect(pollingResponse.status).toBe(200);

    const completeResponse = await updateExecution(new Request("http://localhost", {
      method: "PATCH",
      body: JSON.stringify({
        action: "updateAttempt",
        nodeRunId: nodeRun.id,
        attemptId: nodeRun.currentAttemptId,
        assetFileIds: [file.id],
        status: "succeeded",
      }),
    }), { params: Promise.resolve({ projectId, executionId: execution.id }) });
    await expect(completeResponse.json()).resolves.toMatchObject({
      status: "succeeded",
      nodeRuns: [{ attempts: [{
        externalTaskId: "provider-task",
        assetRefs: [{ fileId: file.id, kind: "video" }],
      }] }],
    });
  });

  it("lists only active records for recovery", async () => {
    await createExecution(new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ kind: "text", nodeId: "result", triggerNodeId: "request" }),
    }), { params: Promise.resolve({ projectId }) });
    const response = await listExecutions(
      new Request(`http://localhost/api/projects/${projectId}/executions?recoverable=1`),
      { params: Promise.resolve({ projectId }) },
    );
    const records = await response.json();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("running");
  });
});
