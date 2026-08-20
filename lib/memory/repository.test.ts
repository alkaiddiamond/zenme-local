import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalProject } from "@/lib/local/project-repository";
import { addLocalWorkspaceRoot, bindLocalWorkspace } from "@/lib/local/workspace-repository";
import {
  createProjectMemory,
  deleteProjectMemory,
  getConfirmedMemoryContext,
  listProjectMemories,
  ProjectMemoryError,
  updateProjectMemory,
  validateProjectMemories,
} from "@/lib/memory/repository";

let dataDir: string;
let workspaceRoot: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-memory-data-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-memory-workspace-"));
  await fs.mkdir(path.join(workspaceRoot, "src"));
  await fs.writeFile(path.join(workspaceRoot, "src", "config.ts"), "export const port = 3000;\n", "utf8");
  const project = await createLocalProject({ name: "Memory", prompt: "", model: "" }, dataDir);
  projectId = project.id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
});

describe("project memory repository", () => {
  it("keeps same-path sources isolated by stable Workspace root identity", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-memory-additional-"));
    try {
      await fs.mkdir(path.join(additionalRoot, "src"));
      await fs.writeFile(path.join(additionalRoot, "src", "config.ts"), "export const port = 9000;\n", "utf8");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;
      const memory = await createProjectMemory({
        projectId,
        kind: "file",
        title: "Additional config",
        content: "The additional service uses port 9000.",
        status: "confirmed",
        sources: [{ kind: "workspaceFile", id: "src/config.ts", label: "Additional config", rootId, relativePath: "src/config.ts" }],
      }, dataDir);
      expect(memory.sources[0]).toMatchObject({ rootId, relativePath: "src/config.ts" });

      await fs.writeFile(path.join(workspaceRoot, "src", "config.ts"), "export const port = 4000;\n", "utf8");
      await validateProjectMemories(projectId, dataDir);
      await expect(listProjectMemories(projectId, dataDir)).resolves.toEqual([
        expect.objectContaining({ id: memory.id, status: "confirmed" }),
      ]);

      await fs.writeFile(path.join(additionalRoot, "src", "config.ts"), "export const port = 9100;\n", "utf8");
      await validateProjectMemories(projectId, dataDir);
      await expect(listProjectMemories(projectId, dataDir)).resolves.toEqual([
        expect.objectContaining({ id: memory.id, status: "needsReview" }),
      ]);
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 15_000);

  it("keeps agent inferences as candidates until a user confirms their traced source", async () => {
    const candidate = await createProjectMemory({
      projectId,
      kind: "decision",
      title: "Use port 3000",
      content: "The development server uses port 3000.",
      createdBy: "agent",
      status: "confirmed",
      sources: [{ kind: "workspaceFile", id: "src/config.ts", label: "src/config.ts", relativePath: "src/config.ts" }],
    }, dataDir);

    expect(candidate.status).toBe("candidate");
    expect(candidate.sources[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await getConfirmedMemoryContext(projectId, dataDir)).toEqual([]);

    const confirmed = await updateProjectMemory({ action: "confirm", projectId, memoryId: candidate.id }, dataDir);
    expect(confirmed.status).toBe("confirmed");
    await expect(getConfirmedMemoryContext(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: candidate.id, revision: 1, status: "confirmed", sources: [expect.objectContaining({ relativePath: "src/config.ts" })] }),
    ]);
  });

  it("invalidates confirmed file memory after its source changes and excludes it from context", async () => {
    const memory = await createProjectMemory({
      projectId,
      kind: "file",
      title: "Config port",
      content: "Port is 3000.",
      status: "confirmed",
      sources: [{ kind: "workspaceFile", id: "src/config.ts", label: "Config", relativePath: "src/config.ts" }],
    }, dataDir);
    await fs.writeFile(path.join(workspaceRoot, "src", "config.ts"), "export const port = 4000;\n", "utf8");

    await validateProjectMemories(projectId, dataDir);
    const [invalidated] = await listProjectMemories(projectId, dataDir);
    expect(invalidated).toMatchObject({ id: memory.id, status: "needsReview" });
    expect(invalidated.invalidationReason).toContain("已变化");
    await expect(getConfirmedMemoryContext(projectId, dataDir)).resolves.toEqual([]);
  });

  it("tracks revisions and deleting memory leaves its source file untouched", async () => {
    const memory = await createProjectMemory({
      projectId,
      kind: "todo",
      title: "Add tests",
      content: "Add API tests.",
      sources: [{ kind: "task", id: "task-1", label: "Task 1", version: "1" }],
    }, dataDir);
    const revised = await updateProjectMemory({
      action: "revise",
      projectId,
      memoryId: memory.id,
      title: "Add regression tests",
      content: "Add API and repository tests.",
      reason: "Scope clarified",
    }, dataDir);
    expect(revised.currentRevision).toBe(2);
    expect(revised.revisions).toHaveLength(2);
    const pinned = await updateProjectMemory({ action: "pin", projectId, memoryId: memory.id }, dataDir);
    expect(pinned.pinned).toBe(true);
    expect(pinned.revisions).toHaveLength(2);

    await deleteProjectMemory(projectId, memory.id, dataDir);
    await expect(listProjectMemories(projectId, dataDir)).resolves.toEqual([]);
    await expect(fs.readFile(path.join(workspaceRoot, "src", "config.ts"), "utf8")).resolves.toContain("3000");
  });

  it("rejects sensitive and escaping file sources", async () => {
    await expect(createProjectMemory({
      projectId, kind: "file", title: "Secret", content: "Secret", sources: [
        { kind: "workspaceFile", id: ".env", label: ".env", relativePath: ".env" },
      ],
    }, dataDir)).rejects.toMatchObject<ProjectMemoryError>({ code: "sensitive_source" });
    await expect(createProjectMemory({
      projectId, kind: "file", title: "Escape", content: "Escape", sources: [
        { kind: "workspaceFile", id: "outside", label: "outside", relativePath: "../outside.txt" },
      ],
    }, dataDir)).rejects.toMatchObject<ProjectMemoryError>({ code: "invalid_input" });
  });

  it("preserves unknown Memory index and record fields during updates", async () => {
    const memory = await createProjectMemory({
      projectId,
      kind: "todo",
      title: "Forward compatibility",
      content: "Keep unknown fields.",
      sources: [{ kind: "task", id: "task-future", label: "Future task" }],
    }, dataDir);
    const indexPath = path.join(dataDir, "projects", projectId, "memory", "index.json");
    const stored = JSON.parse(await fs.readFile(indexPath, "utf8")) as Record<string, unknown> & { memories: Array<Record<string, unknown>> };
    stored.futureIndexField = 42;
    stored.memories[0].futureMemoryField = "preserve-me";
    await fs.writeFile(indexPath, JSON.stringify(stored), "utf8");

    await updateProjectMemory({ action: "pin", projectId, memoryId: memory.id }, dataDir);
    const rewritten = JSON.parse(await fs.readFile(indexPath, "utf8")) as Record<string, unknown> & { memories: Array<Record<string, unknown>> };
    expect(rewritten.futureIndexField).toBe(42);
    expect(rewritten.memories[0].futureMemoryField).toBe("preserve-me");
  });
});
