import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: spawnMock,
}));

import {
  approveAgentCommand,
  getAgentBackgroundTask,
  proposeAgentCommand,
  runApprovedAgentCommand,
} from "@/lib/agent/command-runtime";
import { createAgentExecution, getAgentExecution, updateAgentCommandRequest } from "@/lib/agent/execution-store";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace, setLocalWorkspacePermissions } from "@/lib/local/workspace-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  spawnMock.mockReset();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  })));
});

describe("agent command spawn failures", () => {
  it("persists a terminal failure when Windows process creation throws synchronously", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-command-spawn-data-"));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-command-spawn-workspace-"));
    temporaryDirectories.push(dataDir, workspace);
    const projectId = (await createLocalProject({ name: "Spawn failure", prompt: "", model: "" }, dataDir)).id;
    await bindLocalWorkspace({ projectId, rootPath: workspace }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: true } }, dataDir);
    const executionId = (await createAgentExecution({
      projectId,
      instruction: "Run command",
      resultNodeId: "result",
      triggerNodeId: "trigger",
    }, dataDir)).detail.id;
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "node",
      args: ["--version"],
      reason: "Check Node",
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    spawnMock.mockImplementation(() => {
      throw Object.assign(new Error("process creation denied"), { code: "EPERM" });
    });

    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .rejects.toMatchObject({ code: "invalid_command", message: expect.stringContaining("process creation denied") });
    const persisted = (await getAgentExecution(projectId, executionId, dataDir))?.commandRequests
      .find((candidate) => candidate.id === command.id);
    expect(persisted).toMatchObject({
      status: "failed",
      error: "process creation denied",
      completedAt: expect.any(String),
    });

    await updateAgentCommandRequest(projectId, executionId, command.id, (current) => {
      current.status = "running";
      current.completedAt = undefined;
      current.updatedAt = new Date(Date.now() - 10_000).toISOString();
    }, dataDir);
    await expect(getAgentBackgroundTask(projectId, command.id, dataDir)).resolves.toMatchObject({
      status: "stopped",
      error: expect.stringContaining("进程句柄已不可用"),
    });
  });
});
