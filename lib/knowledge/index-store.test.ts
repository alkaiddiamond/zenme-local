import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EmbeddingProvider } from "@/lib/knowledge/embeddings";
import { clearProjectKnowledgeIndex, getProjectKnowledgeStatus, ProjectKnowledgeError, rebuildProjectKnowledgeIndex, searchProjectKnowledge, setProjectKnowledgePaused } from "@/lib/knowledge/index-store";
import { createLocalProject, saveLocalCanvasSnapshot } from "@/lib/local/project-repository";
import { addLocalWorkspaceRoot, bindLocalWorkspace } from "@/lib/local/workspace-repository";
import { createProjectMemory } from "@/lib/memory/repository";

let dataDir: string; let workspaceRoot: string; let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-knowledge-data-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-knowledge-workspace-"));
  await fs.mkdir(path.join(workspaceRoot, "src"));
  await fs.writeFile(path.join(workspaceRoot, "src", "gateway.ts"), "export function validateBearer(token: string) { return token.length > 10; }\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "README.md"), "# Local service\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, ".env"), "SECRET=never-index\n", "utf8");
  const project = await createLocalProject({ name: "Knowledge", prompt: "", model: "" }, dataDir); projectId = project.id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
  await saveLocalCanvasSnapshot({ projectId, snapshot: { version: 3, nodes: [
    { id: "task-1", type: "task", position: { x: 0, y: 0 }, data: { kind: "task", title: "Implement login", name: "Implement login", nodeLifecycle: "knowledge" } },
    { id: "file-1", type: "workspaceFile", position: { x: 100, y: 0 }, data: { kind: "workspaceFile", title: "Gateway", workspaceRelativePath: "src/gateway.ts" } },
    { id: "archived-1", type: "task", position: { x: 200, y: 0 }, data: { kind: "task", title: "Ghost archived phrase", name: "Ghost archived phrase", nodeLifecycle: "archived" } },
  ], edges: [{ id: "edge-1", source: "task-1", target: "file-1" }], viewport: { x: 0, y: 0, zoom: 1 }, updatedAt: new Date().toISOString() } }, dataDir);
  await createProjectMemory({ projectId, kind: "decision", title: "Authentication decision", content: "Use the gateway implementation for bearer validation.", status: "confirmed", sources: [
    { kind: "workspaceFile", id: "src/gateway.ts", label: "Gateway implementation", relativePath: "src/gateway.ts" },
  ] }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 });
});

describe("project knowledge index", () => {
  it("indexes same-path files from multiple roots without merging their identity", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-knowledge-additional-"));
    try {
      await fs.mkdir(path.join(additionalRoot, "src"));
      await fs.writeFile(path.join(additionalRoot, "src", "gateway.ts"), "export const satelliteNeedle = 'additional-root';\n", "utf8");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;
      await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
      const response = await searchProjectKnowledge({ projectId, query: "satelliteNeedle additional-root", limit: 20 }, dataDir);
      const additionalFile = response.results.find((result) => result.entity.kind === "file" && result.entity.rootId === rootId && result.entity.relativePath === "src/gateway.ts");
      expect(additionalFile?.entity.id).toBe(`file:${rootId}:src/gateway.ts`);
      expect(response.results.some((result) => result.entity.id === "file:src/gateway.ts")).toBe(true);
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 15_000);

  it("builds a local graph/vector index, excludes secrets and improves recall through graph relations", async () => {
    const status = await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    expect(status).toMatchObject({ status: "ready", ignoredSensitiveFiles: 1 });
    expect(status.entities).toBeGreaterThan(4);
    expect(status.edges).toBeGreaterThan(2);
    const response = await searchProjectKnowledge({ projectId, query: "authentication decision", limit: 20 }, dataDir);
    const resultIds = new Set(response.results.map((result) => result.entity.id));
    const decision = response.results.find((result) => result.entity.kind === "decision");
    expect(decision?.evidence.some((item) => item.includes("关键词"))).toBe(true);
    expect(resultIds.has("file:src/gateway.ts")).toBe(true);
    expect(response.results.find((result) => result.entity.id === "file:src/gateway.ts")?.evidence.some((item) => item.includes("图关系"))).toBe(true);
    const baselineRelevant = 1; const hybridRelevant = Number(Boolean(decision)) + Number(resultIds.has("file:src/gateway.ts"));
    expect(hybridRelevant / 2).toBeGreaterThan(baselineRelevant / 2);
    expect(JSON.stringify(response)).not.toContain("never-index");
    const archived = await searchProjectKnowledge({ projectId, query: "Ghost archived phrase" }, dataDir);
    expect(archived.results.some((result) => result.entity.sourceId === "archived-1")).toBe(false);
  }, 15_000);

  it("recalls Chinese partial concepts with the local subword index", async () => {
    await fs.writeFile(path.join(workspaceRoot, "README.md"), "本项目实现用户身份认证流程与访问权限检查。\n", "utf8");
    await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    const response = await searchProjectKnowledge({ projectId, query: "身份认证", limit: 20 }, dataDir);
    const readme = response.results.find((result) => result.entity.id === "file:README.md");
    expect(readme).toBeDefined();
    expect(readme?.scores.keyword).toBeGreaterThan(0);
    expect(readme?.scores.vector).toBeGreaterThan(0);
  });

  it("reuses unchanged vectors and removes ghost file/symbol results across modify, rename and rebuild", async () => {
    await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    const incremental = await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    expect(incremental.reusedChunks).toBeGreaterThan(0);
    await fs.writeFile(path.join(workspaceRoot, "src", "gateway.ts"), "export function newValidator() { return true; }\n", "utf8");
    const beforeRebuild = await searchProjectKnowledge({ projectId, query: "gateway bearer" }, dataDir);
    expect(beforeRebuild.results.some((result) => result.entity.id === "file:src/gateway.ts")).toBe(false);
    await rebuildProjectKnowledgeIndex({ projectId, force: true }, dataDir);
    await fs.rename(path.join(workspaceRoot, "src", "gateway.ts"), path.join(workspaceRoot, "src", "auth-gateway.ts"));
    const afterRename = await searchProjectKnowledge({ projectId, query: "newValidator gateway" }, dataDir);
    expect(afterRename.results.some((result) => result.entity.relativePath === "src/gateway.ts")).toBe(false);
    await rebuildProjectKnowledgeIndex({ projectId, force: true }, dataDir);
    const afterRebuild = await searchProjectKnowledge({ projectId, query: "newValidator auth-gateway" }, dataDir);
    expect(afterRebuild.results.some((result) => result.entity.id === "file:src/auth-gateway.ts")).toBe(true);
  }, 15_000);

  it("rejects an index after the project is relinked to a different workspace identity", async () => {
    await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-knowledge-other-"));
    try {
      await fs.writeFile(path.join(otherRoot, "other.ts"), "export const other = true;\n", "utf8");
      await bindLocalWorkspace({ projectId, rootPath: otherRoot }, dataDir);
      await expect(searchProjectKnowledge({ projectId, query: "authentication" }, dataDir)).rejects.toMatchObject<ProjectKnowledgeError>({ code: "index_stale" });
    } finally { await fs.rm(otherRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 50 }); }
  });

  it("pauses, clears and rebuilds only derived data", async () => {
    await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    await setProjectKnowledgePaused(projectId, true, dataDir);
    await expect(searchProjectKnowledge({ projectId, query: "gateway" }, dataDir)).rejects.toMatchObject<ProjectKnowledgeError>({ code: "index_paused" });
    await clearProjectKnowledgeIndex(projectId, dataDir);
    await expect(getProjectKnowledgeStatus(projectId, dataDir)).resolves.toMatchObject({ status: "missing", diskBytes: 0 });
    await expect(fs.readFile(path.join(workspaceRoot, "src", "gateway.ts"), "utf8")).resolves.toContain("validateBearer");
    await rebuildProjectKnowledgeIndex({ projectId, force: true }, dataDir);
    await expect(getProjectKnowledgeStatus(projectId, dataDir)).resolves.toMatchObject({ status: "ready" });
  });

  it("requires explicit authorization before any cloud embedding content is sent", async () => {
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [1, 0]));
    const provider: EmbeddingProvider = { descriptor: { id: "test-cloud", kind: "cloud", dimension: 2, disclosure: "Would send indexed chunks" }, embed };
    await expect(rebuildProjectKnowledgeIndex({ projectId, provider }, dataDir)).rejects.toMatchObject<ProjectKnowledgeError>({ code: "cloud_authorization_required" });
    expect(embed).not.toHaveBeenCalled();
    await rebuildProjectKnowledgeIndex({ projectId, provider, cloudAuthorized: true }, dataDir);
    expect(embed).toHaveBeenCalled();
    embed.mockClear();
    await expect(searchProjectKnowledge({ projectId, query: "authentication", provider }, dataDir)).rejects.toMatchObject<ProjectKnowledgeError>({ code: "cloud_authorization_required" });
    expect(embed).not.toHaveBeenCalled();
    await searchProjectKnowledge({ projectId, query: "authentication", provider, cloudAuthorized: true }, dataDir);
    expect(embed).toHaveBeenCalledWith(["authentication"]);
  });
});
