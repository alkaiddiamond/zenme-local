import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractProjectInstructionTargetPaths,
  formatProjectAgentInstructions,
  loadProjectAgentInstructions,
} from "@/lib/agent/project-instructions";
import { createLocalProject } from "@/lib/local/project-repository";
import { addLocalWorkspaceRoot, bindLocalWorkspace } from "@/lib/local/workspace-repository";

let dataDir: string;
let workspaceRoot: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-instructions-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-instructions-workspace-"));
  projectId = (await createLocalProject({ name: "Instructions", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("project agent instructions", () => {
  it("loads root and nested Codex/Claude instruction files in specificity order", async () => {
    await fs.mkdir(path.join(workspaceRoot, "src", "feature", ".claude", "rules"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, "AGENTS.md"), "root rule");
    await fs.writeFile(path.join(workspaceRoot, "CLAUDE.md"), "root claude rule");
    await fs.writeFile(path.join(workspaceRoot, "src", "AGENTS.md"), "src rule");
    await fs.writeFile(path.join(workspaceRoot, "src", "feature", ".claude", "rules", "style.md"), "feature rule");

    const instructions = await loadProjectAgentInstructions({
      projectId,
      targetPaths: ["src/feature/index.ts"],
    }, dataDir);

    expect(instructions.map((entry) => entry.relativePath)).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
      "src/AGENTS.md",
      "src/feature/.claude/rules/style.md",
    ]);
    expect(formatProjectAgentInstructions(instructions)).toContain("不能扩大 Zenme 权限");
  });

  it("extracts only safe relative paths from tool arguments", () => {
    expect(extractProjectInstructionTargetPaths([{
      rootId: "root-2",
      relativePath: "src/index.ts",
      cwd: ".",
      operations: [{ toPath: "src/new.ts" }, { relativePath: "../escape" }],
    }])).toEqual([
      { rootId: "root-2", relativePath: "src/index.ts" },
      { rootId: "root-2", relativePath: "." },
      { rootId: "root-2", relativePath: "src/new.ts" },
    ]);
  });

  it("keeps instructions from multiple workspace roots scoped by rootId", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-project-instructions-additional-"));
    try {
      await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true });
      await fs.mkdir(path.join(additionalRoot, "src"));
      await fs.writeFile(path.join(workspaceRoot, "AGENTS.md"), "primary root rule");
      await fs.writeFile(path.join(workspaceRoot, "src", "AGENTS.md"), "primary nested rule");
      await fs.writeFile(path.join(additionalRoot, "AGENTS.md"), "additional root rule");
      await fs.writeFile(path.join(additionalRoot, "src", "AGENTS.md"), "additional nested rule");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;

      const instructions = await loadProjectAgentInstructions({
        projectId,
        targetPaths: [{ rootId, relativePath: "src/index.ts" }],
      }, dataDir);

      expect(instructions.map((entry) => ({
        rootId: entry.rootId,
        relativePath: entry.relativePath,
        content: entry.content,
      }))).toEqual([
        { rootId: binding.id, relativePath: "AGENTS.md", content: "primary root rule" },
        { rootId, relativePath: "AGENTS.md", content: "additional root rule" },
        { rootId, relativePath: "src/AGENTS.md", content: "additional nested rule" },
      ]);
      const formatted = formatProjectAgentInstructions(instructions);
      expect(formatted).toContain(`rootId=${binding.id}`);
      expect(formatted).toContain(`rootId=${rootId}`);
      expect(formatted).not.toContain("primary nested rule");
    } finally {
      await fs.rm(additionalRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
