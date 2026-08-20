import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getExecution, PATCH as patchExecution } from "@/app/api/projects/[projectId]/agent-executions/[executionId]/route";
import { createAgentExecution } from "@/lib/agent/execution-store";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

let dataDir: string;
let projectId: string;
let workspaceRoot: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-api-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-api-root-"));
  process.env.ZENME_DATA_DIR = dataDir;
  projectId = (await createLocalProject({ name: "Agent API", prompt: "", model: "" }, dataDir)).id;
  await fs.writeFile(path.join(workspaceRoot, "README.md"), "# Workspace\n", "utf8");
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
});

describe("Agent execution compatibility API", () => {
  it("reads an internally created execution but refuses retired tool execution", async () => {
    const created = await createAgentExecution({
      instruction: "读取项目说明",
      projectId,
      resultNodeId: "agent-node-1",
      selectedNodeIds: ["source-node-1"],
      triggerNodeId: "source-node-1",
    }, dataDir);

    const toolResponse = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "tool", name: "read_file", arguments: { relativePath: "README.md" } }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(toolResponse.status).toBe(400);

    const getResponse = await getExecution(new Request("http://localhost/agent"), {
      params: Promise.resolve({ projectId, executionId: created.detail.id }),
    });
    await expect(getResponse.json()).resolves.toMatchObject({
      context: { selectedNodeIds: ["source-node-1"] },
      stage: "planning",
      toolCalls: [],
    });
  });

  it("keeps stop as the only mutation for historical executions", async () => {
    const created = await createAgentExecution({
      instruction: "停止旧任务",
      projectId,
      resultNodeId: "agent-node-stop",
      triggerNodeId: "source-node-stop",
    }, dataDir);
    const response = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "stop" }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "stopped" });
  });

  it("rejects retired standalone execution mutations", async () => {
    const created = await createAgentExecution({
      instruction: "检查",
      projectId,
      resultNodeId: "agent-node-2",
      triggerNodeId: "source-node-2",
    }, dataDir);
    const response = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "complete", resultSummary: "retired" }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(response.status).toBe(400);
  });

  it("rejects starting the retired standalone runtime without a model", async () => {
    const created = await createAgentExecution({
      instruction: "检查",
      projectId,
      resultNodeId: "agent-node-3",
      triggerNodeId: "source-node-3",
    }, dataDir);
    const response = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "run", model: "" }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(response.status).toBe(400);
  });
});
