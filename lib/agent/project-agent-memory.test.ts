import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AGENT_MEMORY_ENTRYPOINT,
  loadProjectAgentMemoryPrompt,
  readProjectAgentMemoryFile,
  writeProjectAgentMemoryFile,
} from "@/lib/agent/project-agent-memory";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace, getLocalWorkspaceBinding, setLocalWorkspacePermissions } from "@/lib/local/workspace-repository";

describe("project agent memory", () => {
  let dataDir: string;
  let workspaceRoot: string;
  let projectId: string;
  let rootId: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-memory-data-"));
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-memory-workspace-"));
    projectId = (await createLocalProject({ name: "Memory", prompt: "", model: "" }, dataDir)).id;
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await setLocalWorkspacePermissions({ projectId, permissions: { write: true } }, dataDir);
    rootId = (await getLocalWorkspaceBinding(projectId, dataDir))!.id;
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it.each(["user", "project", "local"] as const)("persists and reloads %s scoped memory", async (scope) => {
    await writeProjectAgentMemoryFile({ projectId, agentType: "reviewer", scope, rootId, virtualPath: AGENT_MEMORY_ENTRYPOINT, content: "Prefer narrow regression tests.", dataDir });
    await expect(readProjectAgentMemoryFile({ projectId, agentType: "reviewer", scope, rootId, virtualPath: AGENT_MEMORY_ENTRYPOINT, dataDir }))
      .resolves.toBe("Prefer narrow regression tests.");
    await expect(loadProjectAgentMemoryPrompt({ projectId, agentType: "reviewer", scope, rootId, dataDir }))
      .resolves.toContain("Prefer narrow regression tests.");
  });

  it("rejects traversal outside the virtual memory root", async () => {
    await expect(writeProjectAgentMemoryFile({ projectId, agentType: "reviewer", scope: "local", rootId, virtualPath: "@agent-memory/../escape.md", content: "no", dataDir }))
      .rejects.toThrow("虚拟路径无效");
  });
});
