import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as createExecution } from "@/app/api/projects/[projectId]/agent-executions/route";
import { GET as getExecution, PATCH as patchExecution } from "@/app/api/projects/[projectId]/agent-executions/[executionId]/route";
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

describe("Agent execution API", () => {
  it("creates a durable execution and invokes a bounded read tool", async () => {
    const createdResponse = await createExecution(new Request("http://localhost/agent", {
      method: "POST",
      body: JSON.stringify({
        instruction: "读取项目说明",
        resultNodeId: "agent-node-1",
        triggerNodeId: "source-node-1",
        selectedNodeIds: ["source-node-1"],
      }),
    }), { params: Promise.resolve({ projectId }) });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { detail: { id: string } };

    const toolResponse = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "tool", name: "read_file", arguments: { relativePath: "README.md" } }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(toolResponse.status).toBe(200);
    await expect(toolResponse.json()).resolves.toMatchObject({ content: "# Workspace\n", relativePath: "README.md" });

    const getResponse = await getExecution(new Request("http://localhost/agent"), {
      params: Promise.resolve({ projectId, executionId: created.detail.id }),
    });
    await expect(getResponse.json()).resolves.toMatchObject({
      context: { selectedNodeIds: ["source-node-1"] },
      stage: "reading",
      toolCalls: [{ name: "read_file", status: "succeeded" }],
    });
  });

  it("rejects direct terminal stage writes", async () => {
    const createdResponse = await createExecution(new Request("http://localhost/agent", {
      method: "POST",
      body: JSON.stringify({ instruction: "检查", resultNodeId: "agent-node-2", triggerNodeId: "source-node-2" }),
    }), { params: Promise.resolve({ projectId }) });
    const created = await createdResponse.json() as { detail: { id: string } };
    const response = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "stage", stage: "completed" }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(response.status).toBe(400);
  });

  it("rejects starting the unified runtime without a model", async () => {
    const createdResponse = await createExecution(new Request("http://localhost/agent", {
      method: "POST",
      body: JSON.stringify({ instruction: "检查", resultNodeId: "agent-node-3", triggerNodeId: "source-node-3" }),
    }), { params: Promise.resolve({ projectId }) });
    const created = await createdResponse.json() as { detail: { id: string } };
    const response = await patchExecution(new Request("http://localhost/agent", {
      method: "PATCH",
      body: JSON.stringify({ action: "run", model: "" }),
    }), { params: Promise.resolve({ projectId, executionId: created.detail.id }) });
    expect(response.status).toBe(400);
  });
});
