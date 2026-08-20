import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { type EmbeddingProvider, assertEmbeddingProviderAuthorized, cosineSimilarity, localHashEmbeddingProvider, resolveConfiguredEmbeddingProvider } from "@/lib/knowledge/embeddings";
import { PROJECT_KNOWLEDGE_VERSION, type KnowledgeChunk, type KnowledgeEdge, type KnowledgeEntity, type KnowledgeSearchResponse, type KnowledgeSearchResult, type ProjectKnowledgeIndex } from "@/lib/knowledge/types";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { listLocalExecutions } from "@/lib/local/execution-repository";
import { getLocalCanvasSnapshot } from "@/lib/local/project-repository";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { listProjectMemories, validateProjectMemories } from "@/lib/memory/repository";
import { listWorkspaceChangeSets } from "@/lib/workspace/change-sets";
import { isSensitiveWorkspacePath, listWorkspaceFiles, MAX_WORKSPACE_TEXT_BYTES } from "@/lib/workspace/workspace-files";
import {
  canUseWorkspaceRootCapability,
  listWorkspaceRoots,
  resolveWorkspaceRoot,
  type WorkspaceBinding,
} from "@/lib/workspace/types";
import { resolveExistingWorkspacePath } from "@/lib/workspace/workspace-inspection";
import { isCjkKnowledgeFeature, knowledgeTextFeatures } from "@/lib/knowledge/text-features";

const locks = new Map<string, Promise<unknown>>();
const MAX_INDEX_FILES = 10_000;
const MAX_INDEX_BYTES = 100 * 1024 * 1024;
const MAX_CHUNKS = 50_000;
const CHUNK_SIZE = 1_600;
const CHUNK_OVERLAP = 200;

export class ProjectKnowledgeError extends Error {
  constructor(message: string, readonly code: "workspace_unavailable" | "index_missing" | "index_paused" | "index_stale" | "invalid_input" | "cloud_authorization_required") { super(message); this.name = "ProjectKnowledgeError"; }
}

export async function getProjectKnowledgeStatus(projectId: string, dataDir = getZenmeDataDir()) {
  const index = await readIndex(projectId, dataDir);
  const diskBytes = await directorySize(derivedDir(projectId, dataDir));
  return index ? { ...summary(index), diskBytes } : { version: PROJECT_KNOWLEDGE_VERSION, projectId, status: "missing" as const, diskBytes: 0, entities: 0, edges: 0, chunks: 0, ignoredSensitiveFiles: 0, updatedAt: null, embeddingProvider: null };
}

export async function rebuildProjectKnowledgeIndex(input: { cloudAuthorized?: boolean; force?: boolean; projectId: string; provider?: EmbeddingProvider }, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  const filePath = indexPath(input.projectId, dataDir);
  return withLock(filePath, async () => {
    const previous = await readIndex(input.projectId, dataDir);
    if (previous?.status === "paused" && !input.force) throw new ProjectKnowledgeError("知识索引已暂停", "index_paused");
    const provider = input.provider ?? localHashEmbeddingProvider;
    try { assertEmbeddingProviderAuthorized(provider, Boolean(input.cloudAuthorized)); }
    catch { throw new ProjectKnowledgeError("云端 Embedding 尚未取得用户授权", "cloud_authorization_required"); }
    const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
    if (!binding || !listWorkspaceRoots(binding).some((root) => canUseWorkspaceRootCapability(root, "read"))) throw new ProjectKnowledgeError("Workspace 未绑定或不可读", "workspace_unavailable");
    const workspaceIdentityHash = workspaceRootsIdentityHash(binding);
    const built = await collectKnowledge(input.projectId, binding, dataDir);
    const previousChunks = new Map((previous?.embeddingProvider.id === provider.descriptor.id ? previous.chunks : []).map((chunk) => [chunk.contentHash, chunk.vector]));
    let reusedChunks = 0;
    const chunkDrafts = built.entities.flatMap((entity) => chunkEntity(entity)).slice(0, MAX_CHUNKS);
    const missing = chunkDrafts.filter((chunk) => !previousChunks.has(chunk.contentHash));
    const vectors = await provider.embed(missing.map((chunk) => chunk.text));
    if (vectors.length !== missing.length || vectors.some((vector) => !validEmbeddingVector(vector))) {
      throw new ProjectKnowledgeError("Embedding 服务返回无效向量", "invalid_input");
    }
    let vectorIndex = 0;
    const chunks: KnowledgeChunk[] = chunkDrafts.map((chunk) => {
      const reused = previousChunks.get(chunk.contentHash);
      if (reused) reusedChunks += 1;
      return { ...chunk, vector: reused ?? vectors[vectorIndex++] ?? [] };
    });
    const now = new Date().toISOString();
    const embeddingProvider = {
      ...provider.descriptor,
      dimension: provider.descriptor.dimension || previous?.embeddingProvider.dimension || vectors[0]?.length || 0,
      ...(provider.descriptor.kind === "cloud"
        ? { authorizedAt: previous?.embeddingProvider.id === provider.descriptor.id
          ? previous.embeddingProvider.authorizedAt ?? now
          : now }
        : {}),
    };
    const index: ProjectKnowledgeIndex = {
      version: PROJECT_KNOWLEDGE_VERSION, projectId: input.projectId, status: "ready", workspaceIdentityHash,
      embeddingProvider, entities: built.entities, edges: dedupeEdges(built.edges), chunks,
      ignoredSensitiveFiles: built.ignoredSensitiveFiles, reusedChunks, indexedAt: previous?.indexedAt ?? now, updatedAt: now,
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeJsonFile(filePath, index);
    return { ...summary(index), diskBytes: await directorySize(derivedDir(input.projectId, dataDir)) };
  });
}

export async function setProjectKnowledgePaused(projectId: string, paused: boolean, dataDir = getZenmeDataDir()) {
  const filePath = indexPath(projectId, dataDir);
  return withLock(filePath, async () => {
    const index = await requireIndex(projectId, dataDir);
    index.status = paused ? "paused" : "ready";
    index.updatedAt = new Date().toISOString();
    await writeJsonFile(filePath, index);
    return summary(index);
  });
}

export async function clearProjectKnowledgeIndex(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  const target = derivedDir(projectId, dataDir);
  await fs.rm(target, { force: true, recursive: true });
  return { ok: true as const };
}

export async function searchProjectKnowledge(input: { budgetCharacters?: number; cloudAuthorized?: boolean; limit?: number; projectId: string; provider?: EmbeddingProvider; query: string }, dataDir = getZenmeDataDir()): Promise<KnowledgeSearchResponse> {
  if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 10_000) throw new ProjectKnowledgeError("检索词无效", "invalid_input");
  const index = await requireIndex(input.projectId, dataDir);
  if (index.status === "paused") throw new ProjectKnowledgeError("知识索引已暂停", "index_paused");
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding || !listWorkspaceRoots(binding).some((root) => canUseWorkspaceRootCapability(root, "read"))) throw new ProjectKnowledgeError("Workspace 未绑定或不可读", "workspace_unavailable");
  const identity = workspaceRootsIdentityHash(binding);
  if (identity !== index.workspaceIdentityHash) throw new ProjectKnowledgeError("Workspace 已重新关联，请重建知识索引", "index_stale");
  await validateProjectMemories(input.projectId, dataDir);
  const validMemoryIds = new Set((await listProjectMemories(input.projectId, dataDir)).filter((memory) => memory.status === "confirmed").map((memory) => memory.id));
  const provider = input.provider ?? await resolveConfiguredEmbeddingProvider(index.embeddingProvider.id, dataDir);
  if (!provider) throw new ProjectKnowledgeError("Embedding 配置已移除，请重建知识索引", "index_stale");
  if (provider.descriptor.id !== index.embeddingProvider.id) throw new ProjectKnowledgeError("Embedding 实现已变化，请重建知识索引", "index_stale");
  const cloudAuthorized = input.provider ? Boolean(input.cloudAuthorized) : Boolean(index.embeddingProvider.authorizedAt);
  try { assertEmbeddingProviderAuthorized(provider, cloudAuthorized); }
  catch { throw new ProjectKnowledgeError("云端 Embedding 尚未取得用户授权", "cloud_authorization_required"); }
  const [queryVector] = await provider.embed([input.query]);
  if (!validEmbeddingVector(queryVector) || (index.embeddingProvider.dimension > 0 && queryVector.length !== index.embeddingProvider.dimension)) {
    throw new ProjectKnowledgeError("Embedding 向量维度已变化，请重建知识索引", "index_stale");
  }
  const tokens = tokenize(input.query);
  const bestChunk = new Map<string, { chunk: KnowledgeChunk; rank: number; vectorScore: number }>();
  for (const chunk of index.chunks) {
    const vectorScore = cosineSimilarity(queryVector, chunk.vector);
    const lexicalScore = keywordScore(tokens, chunk.text);
    const rank = lexicalScore > 0
      ? 1 + lexicalScore * 0.7 + Math.max(0, vectorScore) * 0.3
      : Math.max(0, vectorScore);
    const current = bestChunk.get(chunk.entityId);
    if (!current || rank > current.rank) bestChunk.set(chunk.entityId, { chunk, rank, vectorScore });
  }
  const raw = new Map<string, KnowledgeSearchResult>();
  for (const entity of index.entities) {
    if (entity.metadata.lifecycle === "archived") continue;
    if ((entity.kind === "memory" || entity.kind === "decision") && !validMemoryIds.has(entity.sourceId)) continue;
    const keyword = keywordScore(tokens, `${entity.title}\n${entity.text}`);
    const pathScore = entity.relativePath ? keywordScore(tokens, entity.relativePath) : 0;
    const vectorMatch = bestChunk.get(entity.id);
    const vector = Math.max(0, vectorMatch?.vectorScore ?? 0);
    const score = keyword * 0.4 + pathScore * 0.15 + vector * 0.35;
    if (score <= 0) continue;
    raw.set(entity.id, { entity, score, scores: { keyword, path: pathScore, vector, graph: 0 }, evidence: [
      ...(keyword ? [`关键词匹配 ${(keyword * 100).toFixed(0)}%`] : []),
      ...(pathScore ? [`路径匹配 ${(pathScore * 100).toFixed(0)}%`] : []),
      ...(vector ? [`本地向量相似度 ${(vector * 100).toFixed(0)}%`] : []),
    ], matchedChunk: vectorMatch ? { id: vectorMatch.chunk.id, text: vectorMatch.chunk.text, contentHash: vectorMatch.chunk.contentHash } : undefined });
  }
  const seedIds = [...raw.values()].sort((a, b) => b.score - a.score).slice(0, 12).map((result) => result.entity.id);
  for (const edge of index.edges) {
    const seed = seedIds.includes(edge.from) ? edge.from : seedIds.includes(edge.to) ? edge.to : null;
    if (!seed) continue;
    const neighborId = edge.from === seed ? edge.to : edge.from;
    const entity = index.entities.find((item) => item.id === neighborId);
    if (!entity || entity.metadata.lifecycle === "archived") continue;
    const result = raw.get(neighborId) ?? { entity, score: 0, scores: { keyword: 0, path: 0, vector: 0, graph: 0 }, evidence: [] };
    result.scores.graph = Math.max(result.scores.graph, 1);
    result.score += 0.1;
    result.evidence.push(`图关系：${edge.reason}`);
    raw.set(neighborId, result);
  }
  const limit = clamp(input.limit ?? 20, 1, 100);
  const budgetCharacters = clamp(input.budgetCharacters ?? 80_000, 1_000, 500_000);
  const sorted = [...raw.values()].sort((a, b) => b.score - a.score);
  const results: KnowledgeSearchResult[] = [];
  let consumedCharacters = 0;
  for (const result of sorted) {
    const verified = await verifyEntity(result.entity, binding);
    if (!verified) continue;
    const size = result.entity.title.length + (result.matchedChunk?.text.length ?? Math.min(result.entity.text.length, 1_600));
    if (results.length >= limit || consumedCharacters + size > budgetCharacters) break;
    consumedCharacters += size; results.push(result);
  }
  return { query: input.query, indexUpdatedAt: index.updatedAt, embeddingProvider: index.embeddingProvider, results, consumedCharacters, budgetCharacters };
}

async function collectKnowledge(projectId: string, binding: WorkspaceBinding, dataDir: string) {
  const entities: KnowledgeEntity[] = []; const edges: KnowledgeEdge[] = [];
  let ignoredSensitiveFiles = 0; let indexedBytes = 0;
  let indexedFiles = 0;
  const roots = listWorkspaceRoots(binding).filter((root) => canUseWorkspaceRootCapability(root, "read"));
  for (const root of roots) {
    const entries = await listWorkspaceFiles(projectId, dataDir, root.id);
    for (const entry of entries.filter((item) => item.kind === "file")) {
      if (indexedFiles >= MAX_INDEX_FILES || indexedBytes >= MAX_INDEX_BYTES) break;
      indexedFiles += 1;
      if (entry.sensitive || isSensitiveWorkspacePath(entry.relativePath)) { ignoredSensitiveFiles += 1; continue; }
      try {
        const filePath = await resolveExistingWorkspacePath(root.realPath, entry.relativePath);
        const stat = await fs.stat(filePath);
        if (!stat.isFile() || stat.size > MAX_WORKSPACE_TEXT_BYTES || indexedBytes + stat.size > MAX_INDEX_BYTES) continue;
        const buffer = await fs.readFile(filePath); if (buffer.includes(0)) continue;
        const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); indexedBytes += buffer.length;
        const fileId = workspaceFileEntityId(binding, root.id, entry.relativePath);
        const fileEntity = entity(fileId, "file", entry.relativePath, text, entry.relativePath, entry.relativePath, { size: stat.size, modifiedAtMs: stat.mtimeMs, rootDisplayName: root.displayName }, root.id);
        entities.push(fileEntity);
        for (const symbol of extractSymbols(entry.relativePath, text)) {
          const symbolId = workspaceSymbolEntityId(binding, root.id, entry.relativePath, symbol.line, symbol.name);
          entities.push(entity(symbolId, "symbol", symbol.name, symbol.text, symbolId, entry.relativePath, { line: symbol.line, symbolKind: symbol.kind, fileContentHash: fileEntity.contentHash, rootDisplayName: root.displayName }, root.id));
          edges.push(edge(fileId, symbolId, "contains", `${root.displayName}/${entry.relativePath} 定义 ${symbol.kind} ${symbol.name}`));
        }
      } catch { /* transient or non UTF-8 files stay outside the derived index */ }
    }
    if (indexedFiles >= MAX_INDEX_FILES || indexedBytes >= MAX_INDEX_BYTES) break;
  }
  const snapshot = await getLocalCanvasSnapshot(projectId, dataDir);
  const nodes = Array.isArray(snapshot?.snapshot.nodes) ? snapshot.snapshot.nodes : [];
  for (const value of nodes) {
    if (!isObject(value) || typeof value.id !== "string" || !isObject(value.data)) continue;
    const data = value.data; const kind = data.kind === "task" ? "task" : "canvasNode";
    const title = string(data.title) || string(data.name) || `${kind} ${value.id}`;
    const text = canvasText(data);
    entities.push(entity(`${kind}:${value.id}`, kind, title, text, value.id, undefined, { lifecycle: string(data.nodeLifecycle) || "working", canvasKind: string(data.kind) }));
    if (typeof data.workspaceRelativePath === "string") {
      const rootId = typeof data.workspaceRootId === "string" ? data.workspaceRootId : binding.id;
      edges.push(edge(`${kind}:${value.id}`, workspaceFileEntityId(binding, rootId, data.workspaceRelativePath), "references", `画布节点引用 ${data.workspaceRelativePath}`));
    }
  }
  const canvasEdges = Array.isArray(snapshot?.snapshot.edges) ? snapshot.snapshot.edges : [];
  for (const value of canvasEdges) {
    if (!isObject(value) || typeof value.source !== "string" || typeof value.target !== "string") continue;
    const from = findCanvasEntityId(entities, value.source); const to = findCanvasEntityId(entities, value.target);
    if (from && to) edges.push(edge(from, to, "canvasRelation", "显式 Canvas 连线"));
  }
  for (const execution of await listLocalExecutions(projectId, dataDir)) {
    const attempts = execution.nodeRuns.flatMap((run) => run.attempts);
    const text = attempts.map((attempt) => [attempt.input?.prompt, attempt.outputText, attempt.error?.message].filter(Boolean).join("\n")).join("\n");
    const executionId = `execution:${execution.id}`;
    entities.push(entity(executionId, "execution", `Execution ${execution.id}`, text, execution.id, undefined, { status: execution.status }));
    const trigger = findCanvasEntityId(entities, execution.triggerNodeId); if (trigger) edges.push(edge(trigger, executionId, "triggered", "Canvas 节点触发 Execution"));
    for (const run of execution.nodeRuns) { const target = findCanvasEntityId(entities, run.nodeId); if (target) edges.push(edge(executionId, target, "produced", "Execution 产出画布节点")); }
  }
  for (const changeSet of await listWorkspaceChangeSets(projectId, dataDir)) {
    const id = `changeSet:${changeSet.id}`;
    const changeRootId = changeSet.rootId ?? binding.id;
    entities.push(entity(id, "changeSet", changeSet.title, [changeSet.description, ...changeSet.operations.map((operation) => `${operation.kind} ${operation.relativePath}${operation.targetRelativePath ? ` -> ${operation.targetRelativePath}` : ""}`)].filter(Boolean).join("\n"), changeSet.id, undefined, { status: changeSet.status, rootId: changeRootId }));
    if (changeSet.sourceExecutionId) edges.push(edge(`execution:${changeSet.sourceExecutionId}`, id, "produced", "Execution 提出 ChangeSet"));
    for (const operation of changeSet.operations) edges.push(edge(id, workspaceFileEntityId(binding, changeRootId, operation.targetRelativePath ?? operation.relativePath), "changes", `ChangeSet ${operation.kind} 文件`));
  }
  await validateProjectMemories(projectId, dataDir);
  for (const memory of await listProjectMemories(projectId, dataDir)) {
    const kind = memory.kind === "decision" ? "decision" : "memory"; const id = `${kind}:${memory.id}`;
    entities.push(entity(id, kind, memory.title, memory.content, memory.id, undefined, { status: memory.status, revision: memory.currentRevision, stale: memory.status === "stale" || memory.status === "needsReview" }));
    for (const source of memory.sources) {
      const target = source.kind === "workspaceFile" && source.relativePath ? workspaceFileEntityId(binding, source.rootId ?? binding.id, source.relativePath) : source.kind === "canvasNode" ? findCanvasEntityId(entities, source.id) : `${source.kind}:${source.id}`;
      if (target) edges.push(edge(id, target, "derivedFrom", `Memory 来源：${source.label}`));
    }
    if (memory.supersedesMemoryId) edges.push(edge(id, `memory:${memory.supersedesMemoryId}`, "supersedes", "Memory 修订替代旧记忆"));
  }
  return { entities, edges, ignoredSensitiveFiles };
}

function entity(id: string, kind: KnowledgeEntity["kind"], title: string, text: string, sourceId: string, relativePath: string | undefined, metadata: KnowledgeEntity["metadata"], rootId?: string): KnowledgeEntity { return { id, kind, title: title.slice(0, 1_000), text: text.slice(0, 500_000), contentHash: hash(`${title}\0${text}`), sourceId, ...(rootId ? { rootId } : {}), relativePath, stale: metadata.stale === true, metadata }; }
function edge(from: string, to: string, kind: KnowledgeEdge["kind"], reason: string): KnowledgeEdge { return { id: hash(`${from}\0${to}\0${kind}`), from, to, kind, reason }; }
function dedupeEdges(edges: KnowledgeEdge[]) { return [...new Map(edges.map((item) => [item.id, item])).values()]; }
function chunkEntity(value: KnowledgeEntity): Omit<KnowledgeChunk, "vector">[] { const text = `${value.title}\n${value.text}`; const chunks = []; for (let start = 0, count = 0; start < text.length && count < 500; start += CHUNK_SIZE - CHUNK_OVERLAP, count += 1) { const chunkText = text.slice(start, start + CHUNK_SIZE); const contentHash = hash(`${value.id}\0${start}\0${chunkText}`); chunks.push({ id: `chunk:${contentHash}`, entityId: value.id, text: chunkText, contentHash, startOffset: start, endOffset: start + chunkText.length }); } return chunks; }
function extractSymbols(relativePath: string, text: string) { const results: Array<{ kind: string; line: number; name: string; text: string }> = []; const patterns = [/\b(?:export\s+)?(?:async\s+)?(function|class|interface|type|enum)\s+([\w$]+)/, /\b(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=/, /^\s*(def|class)\s+([\w_]+)/]; text.split(/\r?\n/).forEach((line, index) => { for (const pattern of patterns) { const match = line.match(pattern); if (!match) continue; const name = match[2] ?? match[1]; const kind = match[2] ? match[1] : "variable"; results.push({ kind, line: index + 1, name, text: `${relativePath}:${index + 1}\n${line.trim()}` }); break; } }); return results.slice(0, 5_000); }
function canvasText(data: Record<string, unknown>) { return [data.title, data.name, data.plainText, data.codeContent, data.aiPrompt, data.aiResponse, data.textGenerationPrompt, data.agentInstruction, data.globalGoal, data.comment].filter((value): value is string => typeof value === "string").join("\n").slice(0, 500_000); }
function findCanvasEntityId(entities: KnowledgeEntity[], sourceId: string) { return entities.find((item) => (item.kind === "canvasNode" || item.kind === "task") && item.sourceId === sourceId)?.id; }
function tokenize(value: string) { return knowledgeTextFeatures(value, 1_000); }
function keywordScore(tokens: string[], text: string) {
  if (!tokens.length) return 0;
  const haystack = new Set(knowledgeTextFeatures(text));
  const groups = [
    tokens.filter((token) => !isCjkKnowledgeFeature(token)),
    tokens.filter(isCjkKnowledgeFeature),
  ].filter((group) => group.length > 0);
  const scores = groups.map((group) => group.filter((token) => haystack.has(token)).length / group.length);
  if (scores.length === 1) return scores[0];
  const strongestEvidence = Math.max(...scores);
  const supportingEvidence = Math.min(...scores);
  return strongestEvidence * 0.75 + supportingEvidence * 0.25;
}
async function verifyEntity(entityValue: KnowledgeEntity, binding: WorkspaceBinding) { if (!entityValue.relativePath) return !entityValue.stale; try { const root = resolveWorkspaceRoot(binding, entityValue.rootId ?? binding.id); if (!root || !canUseWorkspaceRootCapability(root, "read")) return false; const filePath = await resolveExistingWorkspacePath(root.realPath, entityValue.relativePath); const buffer = await fs.readFile(filePath); const fileHash = hash(`${entityValue.relativePath}\0${new TextDecoder("utf-8", { fatal: true }).decode(buffer)}`); return entityValue.kind === "file" ? fileHash === entityValue.contentHash : entityValue.metadata.fileContentHash === fileHash; } catch { return false; } }
function workspaceRootsIdentityHash(binding: WorkspaceBinding) { return hash(JSON.stringify(listWorkspaceRoots(binding).map((root) => ({ id: root.id, identity: root.identity, realPath: root.realPath, status: root.status, read: root.permissions.read })))); }
function workspaceFileEntityId(binding: WorkspaceBinding, rootId: string, relativePath: string) { return rootId === binding.id ? `file:${relativePath}` : `file:${rootId}:${relativePath}`; }
function workspaceSymbolEntityId(binding: WorkspaceBinding, rootId: string, relativePath: string, line: number, name: string) { return rootId === binding.id ? `symbol:${relativePath}:${line}:${name}` : `symbol:${rootId}:${relativePath}:${line}:${name}`; }
function hash(value: string | Buffer) { return crypto.createHash("sha256").update(value).digest("hex"); }
function string(value: unknown) { return typeof value === "string" ? value : ""; }
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, Math.floor(value))); }
function validEmbeddingVector(value: unknown): value is number[] { return Array.isArray(value) && value.length > 0 && value.length <= 16_384 && value.every((item) => typeof item === "number" && Number.isFinite(item)); }
function summary(index: ProjectKnowledgeIndex) { return { version: index.version, projectId: index.projectId, status: index.status, entities: index.entities.length, edges: index.edges.length, chunks: index.chunks.length, ignoredSensitiveFiles: index.ignoredSensitiveFiles, reusedChunks: index.reusedChunks, updatedAt: index.updatedAt, embeddingProvider: index.embeddingProvider }; }
function indexPath(projectId: string, dataDir: string) { return resolveInside(getProjectDir(projectId, dataDir), "derived", "knowledge", "index.json"); }
function derivedDir(projectId: string, dataDir: string) { return resolveInside(getProjectDir(projectId, dataDir), "derived", "knowledge"); }
async function readIndex(projectId: string, dataDir: string) { assertSafePathSegment(projectId, "projectId"); return readJsonFile<ProjectKnowledgeIndex | null>(indexPath(projectId, dataDir), { defaultValue: null, normalize: normalizeIndex }); }
async function requireIndex(projectId: string, dataDir: string) { const index = await readIndex(projectId, dataDir); if (!index) throw new ProjectKnowledgeError("知识索引尚未构建", "index_missing"); return index; }
function normalizeIndex(value: unknown): ProjectKnowledgeIndex | null { if (!isObject(value) || value.version !== PROJECT_KNOWLEDGE_VERSION || typeof value.projectId !== "string" || !Array.isArray(value.entities) || !Array.isArray(value.edges) || !Array.isArray(value.chunks) || !isObject(value.embeddingProvider)) return null; return value as unknown as ProjectKnowledgeIndex; }
async function directorySize(directory: string) { let total = 0; try { for (const entry of await fs.readdir(directory, { withFileTypes: true })) { const target = path.join(directory, entry.name); total += entry.isDirectory() ? await directorySize(target) : entry.isFile() ? (await fs.stat(target)).size : 0; } } catch { return 0; } return total; }
function withLock<T>(key: string, operation: () => Promise<T>) { const previous = locks.get(key) ?? Promise.resolve(); const next = previous.catch(() => undefined).then(operation); locks.set(key, next); return next.finally(() => { if (locks.get(key) === next) locks.delete(key); }) as Promise<T>; }
