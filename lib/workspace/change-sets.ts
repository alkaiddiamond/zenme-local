import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import type {
  ChangeSetOperation,
  WorkspaceChangeSet,
} from "@/lib/workspace/change-set-types";
import { MAX_WORKSPACE_TEXT_BYTES, isSensitiveWorkspacePath } from "@/lib/workspace/workspace-files";
import {
  canUseWorkspaceRootCapability,
  resolveWorkspaceRoot,
  type WorkspaceBinding,
  type WorkspaceResolvedRoot,
} from "@/lib/workspace/types";
import { resolveExistingWorkspacePath } from "@/lib/workspace/workspace-inspection";
import { appendContinuousProjectEvent } from "@/lib/global-agent/continuous-store";

type ChangeSetStore = { version: 1; changeSets: WorkspaceChangeSet[] };

export class ChangeSetError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_unavailable"
      | "invalid_change_set"
      | "change_set_not_found"
      | "invalid_status"
      | "write_not_allowed"
      | "delete_not_allowed"
      | "version_conflict"
      | "apply_failed",
  ) {
    super(message);
    this.name = "ChangeSetError";
  }
}

export async function listWorkspaceChangeSets(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(projectId, "projectId");
  await requireResolvedBinding(projectId, dataDir);
  await recoverWorkspaceChangeSetTransactions(projectId, dataDir);
  const store = await readStore(projectId, dataDir);
  return [...store.changeSets].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createWorkspaceChangeSet(
  input: {
    description?: string;
    operations: Array<{
      fileDocumentId?: string;
      kind: ChangeSetOperation["kind"];
      proposedContent?: string | null;
      relativePath: string;
      targetRelativePath?: string;
    }>;
    projectId: string;
    rootId?: string;
    source?: WorkspaceChangeSet["source"];
    sourceAgentId?: string;
    sourceExecutionId?: string;
    sourceTaskId?: string;
    title: string;
  },
  dataDir = getZenmeDataDir(),
) {
  const binding = await requireResolvedBinding(input.projectId, dataDir);
  const root = requireResolvedRoot(binding, input.rootId);
  if (!input.title.trim() || input.operations.length === 0 || input.operations.length > 100) {
    throw new ChangeSetError("ChangeSet 内容无效", "invalid_change_set");
  }
  const source = input.source ?? "user";
  const operations: ChangeSetOperation[] = [];
  const occupiedPaths = new Set<string>();
  for (const proposal of input.operations) {
    const relativePath = normalizeRelativePath(proposal.relativePath);
    const targetRelativePath = proposal.targetRelativePath
      ? normalizeRelativePath(proposal.targetRelativePath)
      : undefined;
    if (
      !relativePath ||
      (proposal.kind === "rename" && !targetRelativePath) ||
      (proposal.kind !== "rename" && targetRelativePath) ||
      occupiedPaths.has(relativePath) ||
      (targetRelativePath && occupiedPaths.has(targetRelativePath)) ||
      (source === "agent" && (isSensitiveWorkspacePath(relativePath) || (targetRelativePath && isSensitiveWorkspacePath(targetRelativePath))))
    ) {
      throw new ChangeSetError("ChangeSet 路径或操作无效", "invalid_change_set");
    }
    occupiedPaths.add(relativePath);
    if (targetRelativePath) occupiedPaths.add(targetRelativePath);
    const before = proposal.kind === "create"
      ? null
      : await readTextState(root.realPath, relativePath);
    if (proposal.kind === "create") {
      await assertPathDoesNotExist(root.realPath, relativePath);
    }
    if (proposal.kind === "rename") {
      await assertPathDoesNotExist(root.realPath, targetRelativePath!);
    }
    const proposedContent = proposal.kind === "modify" || proposal.kind === "create"
      ? validateProposedContent(proposal.proposedContent)
      : null;
    operations.push({
      id: crypto.randomUUID(),
      kind: proposal.kind,
      relativePath,
      targetRelativePath,
      baseHash: before?.hash ?? null,
      beforeContent: before?.content ?? null,
      proposedContent,
      fileDocumentId: proposal.fileDocumentId,
    });
  }
  const now = new Date().toISOString();
  const changeSet: WorkspaceChangeSet = {
    version: 1,
    id: crypto.randomUUID(),
    projectId: input.projectId,
    rootId: root.id,
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    source,
    sourceTaskId: input.sourceTaskId,
    sourceExecutionId: input.sourceExecutionId,
    sourceAgentId: input.sourceAgentId,
    status: "proposed",
    operations,
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  const store = await readStore(input.projectId, dataDir);
  store.changeSets.push(changeSet);
  await writeStore(input.projectId, store, dataDir);
  await recordChangeSetEvent(changeSet, dataDir);
  return changeSet;
}

export async function approveWorkspaceChangeSet(
  projectId: string,
  changeSetId: string,
  dataDir = getZenmeDataDir(),
) {
  const changeSet = await updateStatus(projectId, changeSetId, ["proposed"], "approved", "approvedAt", dataDir);
  await recordChangeSetEvent(changeSet, dataDir);
  return changeSet;
}

export async function rejectWorkspaceChangeSet(
  projectId: string,
  changeSetId: string,
  dataDir = getZenmeDataDir(),
) {
  const changeSet = await updateStatus(projectId, changeSetId, ["proposed", "approved"], "rejected", "rejectedAt", dataDir);
  await recordChangeSetEvent(changeSet, dataDir);
  return changeSet;
}

export async function applyWorkspaceChangeSet(
  projectId: string,
  changeSetId: string,
  dataDir = getZenmeDataDir(),
) {
  const binding = await requireResolvedBinding(projectId, dataDir);
  const { changeSet, store } = await getRequiredChangeSet(projectId, changeSetId, dataDir);
  const root = requireChangeSetRoot(binding, changeSet);
  if (changeSet.status !== "approved") {
    throw new ChangeSetError("ChangeSet 尚未批准", "invalid_status");
  }
  requireApplyCapabilities(root, changeSet);
  try {
    await preflightApply(root.realPath, changeSet.operations);
  } catch (error) {
    changeSet.status = "conflict";
    changeSet.error = "Workspace 文件版本与提案基线不一致";
    changeSet.updatedAt = new Date().toISOString();
    await writeStore(projectId, store, dataDir);
    if (error instanceof ChangeSetError) throw error;
    throw new ChangeSetError("Workspace 文件版本冲突", "version_conflict");
  }
  changeSet.status = "applying";
  changeSet.error = null;
  changeSet.updatedAt = new Date().toISOString();
  await writeStore(projectId, store, dataDir);

  const applied: ChangeSetOperation[] = [];
  try {
    for (const operation of changeSet.operations) {
      await applyOperation(root.realPath, operation);
      applied.push(operation);
    }
  } catch {
    let rollbackFailed = false;
    for (const operation of applied.reverse()) {
      try {
        await rollbackOperation(root.realPath, operation);
      } catch {
        rollbackFailed = true;
      }
    }
    changeSet.status = "conflict";
    changeSet.error = rollbackFailed
      ? "应用失败，自动回滚未完全成功；请检查相关文件"
      : "应用失败，已自动恢复应用前内容";
    changeSet.updatedAt = new Date().toISOString();
    await writeStore(projectId, store, dataDir);
    throw new ChangeSetError(changeSet.error, "apply_failed");
  }

  for (const operation of changeSet.operations) {
    operation.appliedHash = await readAppliedHash(root.realPath, operation);
  }
  const now = new Date().toISOString();
  changeSet.status = "applied";
  changeSet.appliedAt = now;
  changeSet.updatedAt = now;
  await writeStore(projectId, store, dataDir);
  await recordChangeSetEvent(changeSet, dataDir);
  return changeSet;
}

export async function revertWorkspaceChangeSet(
  projectId: string,
  changeSetId: string,
  dataDir = getZenmeDataDir(),
) {
  const binding = await requireResolvedBinding(projectId, dataDir);
  const { changeSet, store } = await getRequiredChangeSet(projectId, changeSetId, dataDir);
  const root = requireChangeSetRoot(binding, changeSet);
  if (changeSet.status !== "applied") {
    throw new ChangeSetError("只有已应用 ChangeSet 可以 Revert", "invalid_status");
  }
  requireApplyCapabilities(root, changeSet);
  await preflightRevert(root.realPath, changeSet.operations);
  changeSet.status = "reverting";
  changeSet.error = null;
  changeSet.updatedAt = new Date().toISOString();
  await writeStore(projectId, store, dataDir);
  try {
    for (const operation of [...changeSet.operations].reverse()) {
      await rollbackOperation(root.realPath, operation);
    }
  } catch {
    changeSet.status = "conflict";
    changeSet.error = "Revert 未完整完成；重启恢复仍无法确认文件状态";
    changeSet.updatedAt = new Date().toISOString();
    await writeStore(projectId, store, dataDir);
    throw new ChangeSetError(changeSet.error, "apply_failed");
  }
  const now = new Date().toISOString();
  changeSet.status = "reverted";
  changeSet.revertedAt = now;
  changeSet.updatedAt = now;
  await writeStore(projectId, store, dataDir);
  await recordChangeSetEvent(changeSet, dataDir);
  return changeSet;
}

async function recordChangeSetEvent(changeSet: WorkspaceChangeSet, dataDir: string) {
  await appendContinuousProjectEvent({
    projectId: changeSet.projectId,
    type: "changeSet.changed",
    source: "changeSet",
    sourceId: changeSet.id,
    idempotencyKey: `change-set:${changeSet.id}:${changeSet.status}:${changeSet.updatedAt}`,
    data: {
      status: changeSet.status,
      title: changeSet.title,
      source: changeSet.source,
      ...(changeSet.rootId ? { rootId: changeSet.rootId } : {}),
      operationCount: changeSet.operations.length,
      affectedPaths: changeSet.operations.flatMap((operation) => [
        operation.relativePath,
        ...(operation.targetRelativePath ? [operation.targetRelativePath] : []),
      ]).slice(0, 200),
      ...(changeSet.sourceExecutionId ? { sourceExecutionId: changeSet.sourceExecutionId } : {}),
      ...(changeSet.error ? { error: changeSet.error.slice(0, 4_000) } : {}),
    },
  }, dataDir).catch(() => undefined);
}

export async function recoverWorkspaceChangeSetTransactions(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  const binding = await requireResolvedBinding(projectId, dataDir);
  const store = await readStore(projectId, dataDir);
  let changed = false;
  for (const changeSet of store.changeSets) {
    if (changeSet.status !== "applying" && changeSet.status !== "reverting") continue;
    changed = true;
    try {
      const root = requireChangeSetRoot(binding, changeSet);
      if (changeSet.status === "applying") {
        await recoverInterruptedApply(root.realPath, changeSet);
      } else {
        await recoverInterruptedRevert(root.realPath, changeSet);
      }
    } catch {
      changeSet.status = "conflict";
      changeSet.error = "中断恢复无法确认文件状态；请检查 ChangeSet 涉及的文件";
      changeSet.updatedAt = new Date().toISOString();
    }
  }
  if (changed) await writeStore(projectId, store, dataDir);
  return store.changeSets;
}

async function recoverInterruptedApply(rootPath: string, changeSet: WorkspaceChangeSet) {
  const states = await Promise.all(changeSet.operations.map((operation) => inspectOperationState(rootPath, operation)));
  if (states.some((state) => state === "unknown")) {
    throw new ChangeSetError("无法确认中断事务的文件状态", "version_conflict");
  }
  for (let index = changeSet.operations.length - 1; index >= 0; index -= 1) {
    if (states[index] === "applied") {
      await rollbackOperation(rootPath, changeSet.operations[index]);
    }
  }
  changeSet.status = "conflict";
  changeSet.error = "应用被中断，已自动恢复应用前内容；可重新创建提案";
  changeSet.updatedAt = new Date().toISOString();
}

async function recoverInterruptedRevert(rootPath: string, changeSet: WorkspaceChangeSet) {
  const states = await Promise.all(changeSet.operations.map((operation) => inspectOperationState(rootPath, operation)));
  if (states.some((state) => state === "unknown")) {
    throw new ChangeSetError("无法确认中断 Revert 的文件状态", "version_conflict");
  }
  for (let index = changeSet.operations.length - 1; index >= 0; index -= 1) {
    if (states[index] === "applied") {
      await rollbackOperation(rootPath, changeSet.operations[index]);
    }
  }
  const now = new Date().toISOString();
  changeSet.status = "reverted";
  changeSet.error = null;
  changeSet.revertedAt = now;
  changeSet.updatedAt = now;
}

async function inspectOperationState(
  rootPath: string,
  operation: ChangeSetOperation,
): Promise<"before" | "applied" | "unknown"> {
  if (operation.kind === "create") {
    const current = await readOptionalTextState(rootPath, operation.relativePath);
    if (!current) return "before";
    return current.hash === hashText(operation.proposedContent ?? "") ? "applied" : "unknown";
  }
  if (operation.kind === "delete") {
    const current = await readOptionalTextState(rootPath, operation.relativePath);
    if (!current) return "applied";
    return current.hash === operation.baseHash ? "before" : "unknown";
  }
  if (operation.kind === "modify") {
    const current = await readOptionalTextState(rootPath, operation.relativePath);
    if (!current) return "unknown";
    if (current.hash === operation.baseHash) return "before";
    return current.hash === hashText(operation.proposedContent ?? "") ? "applied" : "unknown";
  }
  const source = await readOptionalTextState(rootPath, operation.relativePath);
  const target = await readOptionalTextState(rootPath, operation.targetRelativePath!);
  if (source?.hash === operation.baseHash && !target) return "before";
  if (!source && target?.hash === operation.baseHash) return "applied";
  return "unknown";
}

async function readOptionalTextState(rootPath: string, relativePath: string) {
  try {
    return await readTextState(rootPath, relativePath);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function updateStatus(
  projectId: string,
  changeSetId: string,
  allowed: WorkspaceChangeSet["status"][],
  status: WorkspaceChangeSet["status"],
  timestampKey: "approvedAt" | "rejectedAt",
  dataDir: string,
) {
  const { changeSet, store } = await getRequiredChangeSet(projectId, changeSetId, dataDir);
  if (!allowed.includes(changeSet.status)) throw new ChangeSetError("ChangeSet 状态不允许此操作", "invalid_status");
  const now = new Date().toISOString();
  changeSet.status = status;
  changeSet[timestampKey] = now;
  changeSet.updatedAt = now;
  await writeStore(projectId, store, dataDir);
  return changeSet;
}

async function preflightApply(rootPath: string, operations: ChangeSetOperation[]) {
  for (const operation of operations) {
    if (operation.kind === "create") {
      await assertPathDoesNotExist(rootPath, operation.relativePath);
      await resolveNewWorkspacePath(rootPath, operation.relativePath);
      continue;
    }
    const current = await readTextState(rootPath, operation.relativePath);
    if (!current || current.hash !== operation.baseHash) {
      throw new ChangeSetError("文件版本冲突", "version_conflict");
    }
    if (operation.kind === "rename") {
      await assertPathDoesNotExist(rootPath, operation.targetRelativePath!);
      await resolveNewWorkspacePath(rootPath, operation.targetRelativePath!);
    }
  }
}

async function preflightRevert(rootPath: string, operations: ChangeSetOperation[]) {
  for (const operation of operations) {
    const appliedPath = operation.kind === "rename" ? operation.targetRelativePath! : operation.relativePath;
    if (operation.kind === "delete") {
      await assertPathDoesNotExist(rootPath, operation.relativePath);
      continue;
    }
    const current = await readTextState(rootPath, appliedPath);
    if (!current || current.hash !== operation.appliedHash) {
      throw new ChangeSetError("Revert 前文件版本已变化", "version_conflict");
    }
  }
}

async function applyOperation(rootPath: string, operation: ChangeSetOperation) {
  if (operation.kind === "create" || operation.kind === "modify") {
    const filePath = operation.kind === "create"
      ? await resolveNewWorkspacePath(rootPath, operation.relativePath)
      : await resolveExistingWorkspacePath(rootPath, operation.relativePath);
    await writeTextAtomically(filePath, operation.proposedContent ?? "");
  } else if (operation.kind === "delete") {
    await fs.rm(await resolveExistingWorkspacePath(rootPath, operation.relativePath));
  } else {
    await fs.rename(
      await resolveExistingWorkspacePath(rootPath, operation.relativePath),
      await resolveNewWorkspacePath(rootPath, operation.targetRelativePath!),
    );
  }
}

async function rollbackOperation(rootPath: string, operation: ChangeSetOperation) {
  if (operation.kind === "create") {
    await fs.rm(await resolveExistingWorkspacePath(rootPath, operation.relativePath), { force: true });
  } else if (operation.kind === "modify" || operation.kind === "delete") {
    const filePath = operation.kind === "delete"
      ? await resolveNewWorkspacePath(rootPath, operation.relativePath)
      : await resolveExistingWorkspacePath(rootPath, operation.relativePath);
    await writeTextAtomically(filePath, operation.beforeContent ?? "");
  } else {
    await fs.rename(
      await resolveExistingWorkspacePath(rootPath, operation.targetRelativePath!),
      await resolveNewWorkspacePath(rootPath, operation.relativePath),
    );
  }
}

async function readAppliedHash(rootPath: string, operation: ChangeSetOperation) {
  if (operation.kind === "delete") return null;
  const relativePath = operation.kind === "rename" ? operation.targetRelativePath! : operation.relativePath;
  return (await readTextState(rootPath, relativePath))?.hash ?? null;
}

async function readTextState(rootPath: string, relativePath: string) {
  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_WORKSPACE_TEXT_BYTES) {
    throw new ChangeSetError("ChangeSet 只支持 1 MiB 内文本文件", "invalid_change_set");
  }
  const buffer = await fs.readFile(filePath);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ChangeSetError("ChangeSet 只支持 UTF-8 文本文件", "invalid_change_set");
  }
  return { content, hash: hashBuffer(buffer) };
}

async function assertPathDoesNotExist(rootPath: string, relativePath: string) {
  const candidate = await resolveNewWorkspacePath(rootPath, relativePath);
  try {
    await fs.lstat(candidate);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new ChangeSetError("目标文件已经存在", "version_conflict");
}

async function resolveNewWorkspacePath(rootPath: string, relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) throw new ChangeSetError("文件路径无效", "invalid_change_set");
  const parentPath = await resolveExistingWorkspacePath(rootPath, path.posix.dirname(normalized));
  const candidate = path.resolve(parentPath, path.posix.basename(normalized));
  const relative = path.relative(rootPath, candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ChangeSetError("文件路径越过 Workspace", "invalid_change_set");
  }
  return candidate;
}

async function writeTextAtomically(filePath: string, content: string) {
  const tempPath = path.join(path.dirname(filePath), `.zenme-change-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fs.open(tempPath, "wx");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function requireApplyCapabilities(
  root: WorkspaceResolvedRoot,
  changeSet: WorkspaceChangeSet,
) {
  if (!canUseWorkspaceRootCapability(root, "write")) {
    throw new ChangeSetError("Workspace 未授权写入", "write_not_allowed");
  }
  if (
    changeSet.operations.some((operation) => operation.kind === "delete" || operation.kind === "rename") &&
    !canUseWorkspaceRootCapability(root, "delete")
  ) {
    throw new ChangeSetError("Workspace 未授权删除或重命名", "delete_not_allowed");
  }
}

function requireResolvedRoot(binding: WorkspaceBinding, rootId?: string) {
  const root = resolveWorkspaceRoot(binding, rootId);
  if (!root || root.status !== "resolved") {
    throw new ChangeSetError("Workspace 根目录未绑定或不可用", "workspace_unavailable");
  }
  if (!canUseWorkspaceRootCapability(root, "read")) {
    throw new ChangeSetError("Workspace 根目录未授权读取", "workspace_unavailable");
  }
  return root;
}

function requireChangeSetRoot(binding: WorkspaceBinding, changeSet: WorkspaceChangeSet) {
  return requireResolvedRoot(binding, changeSet.rootId ?? binding.id);
}

async function requireResolvedBinding(projectId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  if (!binding || binding.status !== "resolved") {
    throw new ChangeSetError("Workspace 未绑定或不可用", "workspace_unavailable");
  }
  return binding;
}

async function getRequiredChangeSet(projectId: string, changeSetId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  assertSafePathSegment(changeSetId, "changeSetId");
  const store = await readStore(projectId, dataDir);
  const changeSet = store.changeSets.find((entry) => entry.id === changeSetId);
  if (!changeSet) throw new ChangeSetError("ChangeSet 不存在", "change_set_not_found");
  return { changeSet, store };
}

function validateProposedContent(value: unknown) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_WORKSPACE_TEXT_BYTES) {
    throw new ChangeSetError("ChangeSet 文本内容无效", "invalid_change_set");
  }
  return value;
}

function normalizeRelativePath(value: string) {
  if (typeof value !== "string" || path.isAbsolute(value) || value.includes("\0")) return "";
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.split("/").some((part) => !part || part === "..")) return "";
  if (normalized.split("/").some((part) => part === ".git" || part === "node_modules" || part.startsWith(".zenme-"))) return "";
  return normalized;
}

function hashBuffer(buffer: Uint8Array) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hashText(content: string) {
  return hashBuffer(Buffer.from(content, "utf8"));
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "not_found");
}

function getStorePath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "workspace", "change-sets.json");
}

function readStore(projectId: string, dataDir: string) {
  return readJsonFile<ChangeSetStore>(getStorePath(projectId, dataDir), {
    defaultValue: { version: 1, changeSets: [] },
    normalize: normalizeStore,
  });
}

function writeStore(projectId: string, store: ChangeSetStore, dataDir: string) {
  return writeJsonFile(getStorePath(projectId, dataDir), store);
}

function normalizeStore(value: unknown): ChangeSetStore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const store = value as Partial<ChangeSetStore>;
  if (store.version !== 1 || !Array.isArray(store.changeSets)) return null;
  const changeSets = store.changeSets.map(normalizeChangeSet);
  if (changeSets.some((entry) => !entry)) return null;
  return { ...store, version: 1, changeSets: changeSets as WorkspaceChangeSet[] } as ChangeSetStore;
}

function normalizeChangeSet(value: unknown): WorkspaceChangeSet | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = value as Partial<WorkspaceChangeSet>;
  const statuses: WorkspaceChangeSet["status"][] = ["proposed", "approved", "applying", "applied", "reverting", "rejected", "conflict", "reverted"];
  if (
    entry.version !== 1 || typeof entry.id !== "string" || typeof entry.projectId !== "string" ||
    typeof entry.title !== "string" || typeof entry.description !== "string" ||
    (entry.source !== "user" && entry.source !== "agent") || !entry.status || !statuses.includes(entry.status) ||
    typeof entry.createdAt !== "string" || typeof entry.updatedAt !== "string" || !Array.isArray(entry.operations)
  ) return null;
  const operations = entry.operations.map(normalizeOperation);
  if (operations.some((operation) => !operation)) return null;
  return { ...entry, operations: operations as ChangeSetOperation[] } as WorkspaceChangeSet;
}

function normalizeOperation(value: unknown): ChangeSetOperation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const operation = value as Partial<ChangeSetOperation>;
  if (
    typeof operation.id !== "string" ||
    (operation.kind !== "create" && operation.kind !== "modify" && operation.kind !== "delete" && operation.kind !== "rename") ||
    typeof operation.relativePath !== "string" || normalizeRelativePath(operation.relativePath) !== operation.relativePath ||
    (operation.targetRelativePath !== undefined && (typeof operation.targetRelativePath !== "string" || normalizeRelativePath(operation.targetRelativePath) !== operation.targetRelativePath)) ||
    (operation.kind === "rename") !== (typeof operation.targetRelativePath === "string") ||
    (operation.baseHash !== null && typeof operation.baseHash !== "string") ||
    (operation.beforeContent !== null && typeof operation.beforeContent !== "string") ||
    (operation.proposedContent !== null && typeof operation.proposedContent !== "string")
  ) return null;
  return operation as ChangeSetOperation;
}
