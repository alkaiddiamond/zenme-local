import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import {
  PROJECT_MEMORY_VERSION,
  type ProjectMemory,
  type ProjectMemoryContextItem,
  type ProjectMemoryKind,
  type ProjectMemorySource,
} from "@/lib/memory/types";
import { isSensitiveWorkspacePath } from "@/lib/workspace/workspace-files";
import { resolveExistingWorkspacePath } from "@/lib/workspace/workspace-inspection";
import { canUseWorkspaceRootCapability, resolveWorkspaceRoot } from "@/lib/workspace/types";

type MemoryIndex = { version: 1; memories: ProjectMemory[] };
const locks = new Map<string, Promise<unknown>>();
const MAX_MEMORIES = 10_000;
const MAX_SOURCES = 100;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;

export class ProjectMemoryError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "not_found" | "invalid_status" | "sensitive_source" | "source_unavailable") {
    super(message);
    this.name = "ProjectMemoryError";
  }
}

export async function listProjectMemories(projectId: string, dataDir = getZenmeDataDir()) {
  const index = await readIndex(projectId, dataDir);
  return index.memories.sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updatedAt.localeCompare(left.updatedAt));
}

export async function createProjectMemory(input: {
  content: string;
  createdBy?: "user" | "agent";
  kind: ProjectMemoryKind;
  projectId: string;
  reason?: string;
  sources: ProjectMemorySource[];
  status?: "candidate" | "confirmed";
  supersedesMemoryId?: string;
  title: string;
}, dataDir = getZenmeDataDir()) {
  validateInput(input);
  const sources = await hydrateSources(input.projectId, normalizeSources(input.sources), dataDir);
  const now = new Date().toISOString();
  const status = input.createdBy === "agent" ? "candidate" : input.status ?? "candidate";
  const memory: ProjectMemory = {
    version: PROJECT_MEMORY_VERSION,
    id: crypto.randomUUID(),
    projectId: input.projectId,
    kind: input.kind,
    title: input.title.trim(),
    content: input.content.trim(),
    status,
    pinned: false,
    sources,
    currentRevision: 1,
    revisions: [{
      revision: 1,
      title: input.title.trim(),
      content: input.content.trim(),
      sources,
      status,
      reason: (input.reason ?? "创建 Memory").slice(0, 2_000),
      createdAt: now,
      createdBy: input.createdBy ?? "user",
    }],
    supersedesMemoryId: input.supersedesMemoryId,
    createdAt: now,
    updatedAt: now,
    confirmedAt: status === "confirmed" ? now : undefined,
  };
  await mutateIndex(input.projectId, dataDir, (index) => {
    if (index.memories.length >= MAX_MEMORIES) throw new ProjectMemoryError("Project Memory 已达到容量上限", "invalid_status");
    index.memories.push(memory);
  });
  return memory;
}

export async function updateProjectMemory(input: {
  action: "confirm" | "reject" | "revise" | "pin" | "unpin";
  content?: string;
  memoryId: string;
  projectId: string;
  reason?: string;
  sources?: ProjectMemorySource[];
  title?: string;
}, dataDir = getZenmeDataDir()) {
  validateProjectAndMemoryId(input.projectId, input.memoryId);
  return mutateIndex(input.projectId, dataDir, async (index) => {
    const memory = requireMemory(index, input.memoryId);
    const now = new Date().toISOString();
    if (input.action === "pin" || input.action === "unpin") {
      memory.pinned = input.action === "pin";
    } else if (input.action === "confirm") {
      if (!memory.sources.length) throw new ProjectMemoryError("没有来源的 Memory 不能确认", "invalid_status");
      memory.sources = await hydrateSources(input.projectId, memory.sources, dataDir);
      memory.status = "confirmed";
      memory.confirmedAt = now;
      delete memory.rejectedAt;
      delete memory.invalidationReason;
    } else if (input.action === "reject") {
      memory.status = "rejected";
      memory.rejectedAt = now;
    } else {
      if (!input.title?.trim() || !input.content?.trim()) throw new ProjectMemoryError("Memory 修订内容无效", "invalid_input");
      memory.title = input.title.trim();
      memory.content = input.content.trim();
      memory.sources = await hydrateSources(
        input.projectId,
        input.sources ? normalizeSources(input.sources) : memory.sources,
        dataDir,
      );
      memory.currentRevision += 1;
      memory.status = "candidate";
      delete memory.confirmedAt;
      delete memory.rejectedAt;
      delete memory.invalidationReason;
      memory.revisions.push({
        revision: memory.currentRevision,
        title: memory.title,
        content: memory.content,
        sources: memory.sources,
        status: "candidate",
        reason: (input.reason ?? "修订 Memory，等待重新确认").slice(0, 2_000),
        createdAt: now,
        createdBy: "user",
      });
    }
    memory.updatedAt = now;
    if (input.action !== "pin" && input.action !== "unpin") appendStatusRevision(memory, input.reason ?? statusReason(input.action), now);
    return memory;
  });
}

export async function deleteProjectMemory(projectId: string, memoryId: string, dataDir = getZenmeDataDir()) {
  validateProjectAndMemoryId(projectId, memoryId);
  return mutateIndex(projectId, dataDir, (index) => {
    const position = index.memories.findIndex((memory) => memory.id === memoryId);
    if (position < 0) throw new ProjectMemoryError("Project Memory 不存在", "not_found");
    return index.memories.splice(position, 1)[0];
  });
}

export async function validateProjectMemories(projectId: string, dataDir = getZenmeDataDir()) {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  return mutateIndex(projectId, dataDir, async (index) => {
    const now = new Date().toISOString();
    for (const memory of index.memories) {
      if (memory.status === "rejected") continue;
      let invalidation = "";
      for (const source of memory.sources.filter((item) => item.kind === "workspaceFile" && item.relativePath)) {
        if (isSensitiveWorkspacePath(source.relativePath!)) { invalidation = "来源现在被标记为敏感文件"; break; }
        if (!binding || binding.status !== "resolved") { invalidation = "Workspace 当前不可用"; break; }
        const root = resolveWorkspaceRoot(binding, source.rootId ?? binding.id);
        if (!root || !canUseWorkspaceRootCapability(root, "read")) { invalidation = "来源所在的 Workspace 根目录当前不可读"; break; }
        try {
          const filePath = await resolveExistingWorkspacePath(root.realPath, source.relativePath!);
          const stat = await fs.stat(filePath);
          if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) { invalidation = `来源文件无法验证：${source.relativePath}`; break; }
          const currentHash = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
          if (source.contentHash && source.contentHash !== currentHash) { invalidation = `来源文件已变化：${source.relativePath}`; break; }
        } catch { invalidation = `来源文件不存在：${source.relativePath}`; break; }
      }
      if (invalidation) {
        memory.status = memory.status === "confirmed" ? "needsReview" : "stale";
        memory.invalidationReason = invalidation;
        memory.updatedAt = now;
      }
      memory.lastValidatedAt = now;
    }
    return index.memories;
  });
}

export async function getConfirmedMemoryContext(projectId: string, dataDir = getZenmeDataDir()): Promise<ProjectMemoryContextItem[]> {
  await validateProjectMemories(projectId, dataDir);
  return (await listProjectMemories(projectId, dataDir)).filter((memory) => memory.status === "confirmed").map((memory) => ({
    id: memory.id,
    kind: memory.kind,
    title: memory.title,
    content: memory.content,
    revision: memory.currentRevision,
    status: "confirmed",
    sources: memory.sources,
  }));
}

export async function getRelevantConfirmedMemoryContext(input: {
  projectId: string;
  query: string;
  limit?: number;
  budgetCharacters?: number;
}, dataDir = getZenmeDataDir()) {
  const memories = await getConfirmedMemoryContext(input.projectId, dataDir);
  const queryTerms = tokenizeMemoryQuery(input.query);
  const limit = Math.min(20, Math.max(1, input.limit ?? 5));
  const budgetCharacters = Math.min(100_000, Math.max(1_000, input.budgetCharacters ?? 20_000));
  let consumedCharacters = 0;
  return memories
    .map((memory, index) => ({
      memory,
      index,
      score: scoreMemory(memory, queryTerms),
    }))
    .filter((item) => item.score > 0 || queryTerms.length === 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .filter(({ memory }) => {
      const size = memory.title.length + memory.content.length + JSON.stringify(memory.sources).length;
      if (consumedCharacters + size > budgetCharacters) return false;
      consumedCharacters += size;
      return true;
    })
    .map(({ memory }) => memory);
}

function tokenizeMemoryQuery(value: string) {
  return [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [])].slice(0, 100);
}

function scoreMemory(memory: ProjectMemoryContextItem, queryTerms: string[]) {
  const title = memory.title.toLocaleLowerCase();
  const content = memory.content.toLocaleLowerCase();
  return queryTerms.reduce((score, term) =>
    score + (title.includes(term) ? 5 : 0) + (content.includes(term) ? 1 : 0), 0);
}

function appendStatusRevision(memory: ProjectMemory, reason: string, now: string) {
  const latest = memory.revisions.at(-1);
  if (latest && latest.revision === memory.currentRevision && latest.status === memory.status) return;
  memory.revisions.push({
    revision: memory.currentRevision,
    title: memory.title,
    content: memory.content,
    sources: memory.sources,
    status: memory.status,
    reason: reason.slice(0, 2_000),
    createdAt: now,
    createdBy: "user",
  });
}

function statusReason(action: "confirm" | "reject" | "revise") {
  return action === "confirm" ? "用户确认 Memory" : action === "reject" ? "用户拒绝 Memory" : "用户修订 Memory";
}

function normalizeSources(sources: ProjectMemorySource[]) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_SOURCES) throw new ProjectMemoryError("Memory 必须包含 1–100 个来源", "invalid_input");
  return sources.map((source) => {
    if (!source || typeof source.id !== "string" || typeof source.label !== "string" || !["workspaceFile", "changeSet", "task", "decision", "execution", "canvasNode", "gitCommit"].includes(source.kind)) {
      throw new ProjectMemoryError("Memory 来源无效", "invalid_input");
    }
    const relativePath = source.relativePath ? normalizeRelativePath(source.relativePath) : undefined;
    const rootId = typeof source.rootId === "string" && source.rootId.trim() ? source.rootId.trim().slice(0, 1_000) : undefined;
    if (source.kind === "workspaceFile" && !relativePath) throw new ProjectMemoryError("Workspace 文件来源必须使用安全相对路径", "invalid_input");
    if (relativePath && isSensitiveWorkspacePath(relativePath)) throw new ProjectMemoryError("敏感文件不能作为 Memory 来源", "sensitive_source");
    return {
      ...source,
      id: source.id.trim().slice(0, 1_000),
      label: source.label.trim().slice(0, 1_000),
      rootId,
      relativePath,
      contentHash: typeof source.contentHash === "string" ? source.contentHash.slice(0, 256) : source.contentHash,
      version: typeof source.version === "string" ? source.version.slice(0, 1_000) : source.version,
    };
  });
}

async function hydrateSources(projectId: string, sources: ProjectMemorySource[], dataDir: string) {
  const fileSources = sources.filter((source) => source.kind === "workspaceFile");
  if (!fileSources.length) return sources;
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  if (!binding || binding.status !== "resolved") {
    throw new ProjectMemoryError("Workspace 当前不可用，无法验证 Memory 来源", "source_unavailable");
  }
  return Promise.all(sources.map(async (source) => {
    if (source.kind !== "workspaceFile" || !source.relativePath) return source;
    const root = resolveWorkspaceRoot(binding, source.rootId ?? binding.id);
    if (!root || !canUseWorkspaceRootCapability(root, "read")) {
      throw new ProjectMemoryError("Memory 来源所在的 Workspace 根目录不可读", "source_unavailable");
    }
    try {
      const filePath = await resolveExistingWorkspacePath(root.realPath, source.relativePath);
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) {
        throw new ProjectMemoryError("Memory 来源必须是 4 MiB 以内的普通文件", "source_unavailable");
      }
      const contentHash = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
      return { ...source, rootId: root.id, contentHash, version: `${stat.size}:${stat.mtimeMs}` };
    } catch (error) {
      if (error instanceof ProjectMemoryError) throw error;
      throw new ProjectMemoryError("Workspace 文件来源不存在或不可读取", "source_unavailable");
    }
  }));
}

function normalizeRelativePath(value: string) {
  if (typeof value !== "string" || value.includes("\0") || path.isAbsolute(value)) return "";
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.split("/").some((part) => !part || part === ".." || part === ".")) return "";
  return normalized;
}

function validateInput(input: { content: string; kind: ProjectMemoryKind; projectId: string; title: string }) {
  assertSafePathSegment(input.projectId, "projectId");
  if (!["file", "architecture", "decision", "todo"].includes(input.kind) || !input.title?.trim() || !input.content?.trim() || input.title.length > 1_000 || input.content.length > 200_000) {
    throw new ProjectMemoryError("Project Memory 内容无效", "invalid_input");
  }
}

function validateProjectAndMemoryId(projectId: string, memoryId: string) {
  assertSafePathSegment(projectId, "projectId");
  assertSafePathSegment(memoryId, "memoryId");
}

function requireMemory(index: MemoryIndex, memoryId: string) {
  const memory = index.memories.find((item) => item.id === memoryId);
  if (!memory) throw new ProjectMemoryError("Project Memory 不存在", "not_found");
  return memory;
}

async function readIndex(projectId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  return readJsonFile<MemoryIndex>(indexPath(projectId, dataDir), { defaultValue: { version: 1, memories: [] }, normalize: normalizeIndex });
}

function mutateIndex<T>(projectId: string, dataDir: string, update: (index: MemoryIndex) => T | Promise<T>) {
  const filePath = indexPath(projectId, dataDir);
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const index = await readIndex(projectId, dataDir);
    const result = await update(index);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeJsonFile(filePath, index);
    return result;
  });
  locks.set(filePath, next);
  return next.finally(() => { if (locks.get(filePath) === next) locks.delete(filePath); }) as Promise<T>;
}

function indexPath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "memory", "index.json");
}

function normalizeIndex(value: unknown): MemoryIndex {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { version: 1, memories: [] };
  const index = value as Partial<MemoryIndex>;
  return {
    ...index,
    version: 1,
    memories: Array.isArray(index.memories)
      ? index.memories.filter(isMemory).map((memory) => ({ ...memory, pinned: Boolean(memory.pinned) }))
      : [],
  } as MemoryIndex;
}

function isMemory(value: unknown): value is ProjectMemory {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const memory = value as Partial<ProjectMemory>;
  return memory.version === PROJECT_MEMORY_VERSION && typeof memory.id === "string" && typeof memory.projectId === "string" && typeof memory.title === "string" && typeof memory.content === "string" && Array.isArray(memory.sources) && Array.isArray(memory.revisions);
}
