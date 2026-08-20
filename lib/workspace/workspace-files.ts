import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import type {
  WorkspaceFileDocument,
  WorkspaceFileDocumentView,
  WorkspaceFileEntry,
} from "@/lib/workspace/file-document-types";
import {
  canUseWorkspaceCapability,
  canUseWorkspaceRootCapability,
  resolveWorkspaceRoot,
} from "@/lib/workspace/types";
import {
  resolveExistingWorkspacePath,
  WorkspacePathError,
} from "@/lib/workspace/workspace-inspection";

const execFileAsync = promisify(execFile);
const MAX_VISIBLE_FILES = 20_000;
export const MAX_WORKSPACE_TEXT_BYTES = 1024 * 1024;
const ALWAYS_IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".nuxt", ".turbo", ".cache", "node_modules",
  "coverage", "dist", "build", "out", "target",
]);

type FileDocumentStore = {
  version: 1;
  documents: WorkspaceFileDocument[];
};

type DocumentRuntimeState = {
  contentHash: string | null;
  modifiedAtMs: number | null;
  relativePath: string;
};

const runtimeState = new Map<string, DocumentRuntimeState>();

export class WorkspaceFileError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_unavailable"
      | "read_not_allowed"
      | "write_not_allowed"
      | "invalid_file"
      | "file_not_found"
      | "document_not_found"
      | "version_conflict"
      | "invalid_content",
  ) {
    super(message);
    this.name = "WorkspaceFileError";
  }
}

export async function listWorkspaceFiles(
  projectId: string,
  dataDir = getZenmeDataDir(),
  rootId?: string,
): Promise<WorkspaceFileEntry[]> {
  const root = await requireReadableRoot(projectId, dataDir, rootId);
  const relativeFiles = root.git.available
    ? await listGitVisibleFiles(root.realPath)
    : await walkVisibleFiles(root.realPath);
  const entries = new Map<string, WorkspaceFileEntry>();

  for (const relativePath of relativeFiles.slice(0, MAX_VISIBLE_FILES)) {
    const normalized = normalizeRelativePath(relativePath);
    if (!normalized || hasIgnoredDirectory(normalized)) continue;
    const parts = normalized.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      const directoryPath = parts.slice(0, index).join("/");
      entries.set(`d:${directoryPath}`, {
        kind: "directory",
        name: parts[index - 1],
        relativePath: directoryPath,
        rootId: root.id,
        sensitive: false,
      });
    }
    entries.set(`f:${normalized}`, {
      kind: "file",
      name: parts.at(-1)!,
      relativePath: normalized,
      rootId: root.id,
      sensitive: isSensitiveWorkspacePath(normalized),
    });
  }

  return [...entries.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export async function openWorkspaceFileDocument(
  input: { projectId: string; relativePath: string; rootId?: string },
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(input.projectId, "projectId");
  const binding = await requireReadableBinding(input.projectId, dataDir);
  const root = await requireReadableRoot(input.projectId, dataDir, input.rootId);
  const relativePath = normalizeRelativePath(input.relativePath);
  if (!relativePath || hasIgnoredDirectory(relativePath)) {
    throw new WorkspaceFileError("文件路径无效", "invalid_file");
  }
  const realPath = await resolveWorkspaceFile(root.realPath, relativePath);
  const stat = await fs.stat(realPath, { bigint: true });
  if (!stat.isFile()) {
    throw new WorkspaceFileError("目标不是文件", "invalid_file");
  }

  const store = await readDocumentStore(input.projectId, dataDir);
  const existing = store.documents.find(
    (document) => (document.rootId ?? binding.id) === root.id && document.relativePath === relativePath,
  );
  if (existing) return readWorkspaceFileDocument(input.projectId, existing.id, dataDir);

  const now = new Date().toISOString();
  const document: WorkspaceFileDocument = {
    version: 1,
    id: crypto.randomUUID(),
    projectId: input.projectId,
    rootId: root.id,
    relativePath,
    fileIdentity: fileIdentity(stat),
    createdAt: now,
    updatedAt: now,
  };
  store.documents.push(document);
  await writeDocumentStore(input.projectId, store, dataDir);
  return readWorkspaceFileDocument(input.projectId, document.id, dataDir);
}

export async function readWorkspaceFileDocument(
  projectId: string,
  documentId: string,
  dataDir = getZenmeDataDir(),
): Promise<WorkspaceFileDocumentView> {
  assertSafePathSegment(projectId, "projectId");
  assertSafePathSegment(documentId, "documentId");
  const store = await readDocumentStore(projectId, dataDir);
  const document = store.documents.find((entry) => entry.id === documentId);
  if (!document) {
    throw new WorkspaceFileError("File Document 不存在", "document_not_found");
  }
  const root = await requireReadableRoot(projectId, dataDir, document.rootId);
  if (!document.rootId) {
    document.rootId = root.id;
    document.updatedAt = new Date().toISOString();
    await writeDocumentStore(projectId, store, dataDir);
  }

  let relativePath = document.relativePath;
  let resolvedPath: string | null = null;
  try {
    resolvedPath = await resolveWorkspaceFile(root.realPath, relativePath);
  } catch (error) {
    if (!(error instanceof WorkspaceFileError) || error.code !== "file_not_found") {
      throw error;
    }
    const relocated = await findFileByIdentity(root.realPath, document.fileIdentity);
    if (relocated) {
      relativePath = relocated;
      resolvedPath = await resolveWorkspaceFile(root.realPath, relocated);
      document.relativePath = relocated;
      document.updatedAt = new Date().toISOString();
      await writeDocumentStore(projectId, store, dataDir);
    }
  }

  const runtimeKey = `${projectId}:${documentId}`;
  const previous = runtimeState.get(runtimeKey);
  if (!resolvedPath) {
    runtimeState.set(runtimeKey, {
      contentHash: null,
      modifiedAtMs: null,
      relativePath,
    });
    return {
      document,
      status: "deleted",
      change: "deleted",
      content: null,
      contentHash: null,
      contentKind: "missing",
      encoding: null,
      size: null,
      modifiedAt: null,
      gitStatus: null,
      sensitive: isSensitiveWorkspacePath(relativePath),
      writable: canUseWorkspaceRootCapability(root, "write"),
    };
  }

  const [file, gitStatus] = await Promise.all([
    readWorkspaceTextFile(resolvedPath),
    readGitFileStatus(root.realPath, relativePath, root.git.available),
  ]);
  const contentHash = file.buffer
    ? crypto.createHash("sha256").update(file.buffer).digest("hex")
    : `${file.contentKind}:${file.size}:${file.modifiedAtMs}`;
  let change: WorkspaceFileDocumentView["change"] = "unchanged";
  if (previous?.relativePath !== undefined && previous.relativePath !== relativePath) {
    change = "renamed";
  } else if (previous?.contentHash && previous.contentHash !== contentHash) {
    change = "modified";
  }
  runtimeState.set(runtimeKey, {
    contentHash,
    modifiedAtMs: file.modifiedAtMs,
    relativePath,
  });
  return {
    document,
    status: "resolved",
    change,
    content: file.content,
    contentHash,
    contentKind: file.contentKind,
    encoding: file.encoding,
    size: file.size,
    modifiedAt: new Date(file.modifiedAtMs).toISOString(),
    gitStatus,
    sensitive: isSensitiveWorkspacePath(relativePath),
    writable: canUseWorkspaceRootCapability(root, "write"),
  };
}

export async function saveWorkspaceFileDocument(
  input: {
    content: string;
    documentId: string;
    expectedHash: string;
    projectId: string;
  },
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(input.projectId, "projectId");
  assertSafePathSegment(input.documentId, "documentId");
  if (typeof input.content !== "string" || Buffer.byteLength(input.content, "utf8") > MAX_WORKSPACE_TEXT_BYTES) {
    throw new WorkspaceFileError("文件内容无效或超过 1 MiB", "invalid_content");
  }
  const documentStore = await readDocumentStore(input.projectId, dataDir);
  const document = documentStore.documents.find((entry) => entry.id === input.documentId);
  if (!document) {
    throw new WorkspaceFileError("File Document 不存在", "document_not_found");
  }
  const root = await requireReadableRoot(input.projectId, dataDir, document.rootId);
  if (!canUseWorkspaceRootCapability(root, "write")) {
    throw new WorkspaceFileError("Workspace 未授权写入", "write_not_allowed");
  }
  const store = documentStore;
  const filePath = await resolveWorkspaceFile(root.realPath, document.relativePath);
  const current = await readWorkspaceTextFile(filePath);
  if (current.contentKind !== "text" || !current.buffer) {
    throw new WorkspaceFileError("只有 UTF-8 文本文件可以编辑", "invalid_content");
  }
  const currentHash = crypto.createHash("sha256").update(current.buffer).digest("hex");
  if (!input.expectedHash || currentHash !== input.expectedHash) {
    throw new WorkspaceFileError("磁盘文件已发生变化，请先处理冲突", "version_conflict");
  }

  const directoryPath = path.dirname(filePath);
  const tempPath = path.join(directoryPath, `.zenme-save-${crypto.randomUUID()}.tmp`);
  try {
    const handle = await fs.open(tempPath, "wx");
    try {
      await handle.writeFile(input.content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const savedStat = await fs.stat(filePath, { bigint: true });
  document.fileIdentity = fileIdentity(savedStat);
  document.updatedAt = new Date().toISOString();
  await writeDocumentStore(input.projectId, store, dataDir);
  const savedBuffer = Buffer.from(input.content, "utf8");
  runtimeState.set(`${input.projectId}:${input.documentId}`, {
    contentHash: crypto.createHash("sha256").update(savedBuffer).digest("hex"),
    modifiedAtMs: Number(savedStat.mtimeMs),
    relativePath: document.relativePath,
  });
  return readWorkspaceFileDocument(input.projectId, input.documentId, dataDir);
}

export function isSensitiveWorkspacePath(relativePath: string) {
  const normalized = `/${normalizeRelativePath(relativePath).toLowerCase()}`;
  const name = normalized.split("/").at(-1) ?? "";
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name === ".npmrc" ||
    name === ".pypirc" ||
    name === "credentials" ||
    name === "credentials.json" ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    /\.(pem|key|p12|pfx|keystore)$/i.test(name) ||
    normalized.includes("/.ssh/") ||
    normalized.includes("/.aws/")
  );
}

async function requireReadableBinding(projectId: string, dataDir: string) {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  if (!binding || binding.status !== "resolved") {
    throw new WorkspaceFileError("Workspace 未绑定或不可用", "workspace_unavailable");
  }
  if (!canUseWorkspaceCapability(binding, "read")) {
    throw new WorkspaceFileError("Workspace 未授权读取", "read_not_allowed");
  }
  return binding;
}

async function requireReadableRoot(projectId: string, dataDir: string, rootId?: string) {
  const binding = await requireReadableBinding(projectId, dataDir);
  const root = resolveWorkspaceRoot(binding, rootId);
  if (!root || root.status !== "resolved") {
    throw new WorkspaceFileError("Workspace Root 不存在或不可用", "workspace_unavailable");
  }
  if (!canUseWorkspaceRootCapability(root, "read")) {
    throw new WorkspaceFileError("Workspace Root 未授权读取", "read_not_allowed");
  }
  return root;
}

async function resolveWorkspaceFile(rootPath: string, relativePath: string) {
  try {
    return await resolveExistingWorkspacePath(rootPath, relativePath);
  } catch (error) {
    if (error instanceof WorkspacePathError && error.code === "not_found") {
      throw new WorkspaceFileError("文件不存在", "file_not_found");
    }
    if (error instanceof WorkspacePathError) {
      throw new WorkspaceFileError("文件路径无效", "invalid_file");
    }
    throw error;
  }
}

async function listGitVisibleFiles(rootPath: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootPath, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."],
      { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 8_000, windowsHide: true },
    );
    return stdout.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return walkVisibleFiles(rootPath);
  }
}

async function walkVisibleFiles(rootPath: string) {
  const files: string[] = [];
  const queue: Array<{ relativeDirectory: string; rules: GitignoreRule[] }> = [
    { relativeDirectory: "", rules: [] },
  ];
  while (queue.length > 0 && files.length < MAX_VISIBLE_FILES) {
    const { relativeDirectory, rules: parentRules } = queue.shift()!;
    const absoluteDirectory = path.join(rootPath, relativeDirectory);
    const entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    const rules = [
      ...parentRules,
      ...await readGitignoreRules(absoluteDirectory, normalizeRelativePath(relativeDirectory) || ""),
    ];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = normalizeRelativePath(path.join(relativeDirectory, entry.name));
      if (entry.isDirectory()) {
        if (
          !ALWAYS_IGNORED_DIRECTORIES.has(entry.name) &&
          !isIgnoredByRules(relativePath, true, rules)
        ) {
          queue.push({ relativeDirectory: relativePath, rules });
        }
      } else if (entry.isFile()) {
        if (!isIgnoredByRules(relativePath, false, rules)) files.push(relativePath);
      }
    }
  }
  return files;
}

type GitignoreRule = {
  base: string;
  directoryOnly: boolean;
  negate: boolean;
  pattern: string;
};

async function readGitignoreRules(directoryPath: string, base: string) {
  let source: string;
  try {
    source = await fs.readFile(path.join(directoryPath, ".gitignore"), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return source.split(/\r?\n/).flatMap((rawLine): GitignoreRule[] => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];
    const negate = trimmed.startsWith("!");
    let pattern = negate ? trimmed.slice(1) : trimmed;
    const directoryOnly = pattern.endsWith("/");
    pattern = pattern.replace(/^\//, "").replace(/\/$/, "");
    if (!pattern) return [];
    return [{ base, directoryOnly, negate, pattern }];
  });
}

function isIgnoredByRules(relativePath: string, isDirectory: boolean, rules: GitignoreRule[]) {
  let ignored = false;
  for (const rule of rules) {
    const pathFromBase = rule.base
      ? relativePath.startsWith(`${rule.base}/`)
        ? relativePath.slice(rule.base.length + 1)
        : ""
      : relativePath;
    if (!pathFromBase) continue;
    const matches = rule.pattern.includes("/")
      ? globMatches(pathFromBase, rule.pattern, rule.directoryOnly, isDirectory)
      : pathFromBase.split("/").some((part, index, parts) =>
          globSegmentMatches(part, rule.pattern) &&
          (!rule.directoryOnly || isDirectory || index < parts.length - 1),
        );
    if (matches) ignored = !rule.negate;
  }
  return ignored;
}

function globMatches(
  relativePath: string,
  pattern: string,
  directoryOnly: boolean,
  isDirectory: boolean,
) {
  const expression = globToRegExp(pattern);
  if (expression.test(relativePath)) return !directoryOnly || isDirectory;
  if (!directoryOnly) return false;
  return relativePath.split("/").some((_, index, parts) =>
    expression.test(parts.slice(0, index + 1).join("/")),
  );
}

function globSegmentMatches(value: string, pattern: string) {
  return globToRegExp(pattern).test(value);
}

function globToRegExp(pattern: string) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index += 1;
    } else if (character === "*") {
      source += "[^/]*";
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${source}$`);
}

async function findFileByIdentity(
  rootPath: string,
  identity: WorkspaceFileDocument["fileIdentity"],
) {
  if (!identity.device || !identity.inode) return null;
  const candidates = await listGitVisibleFiles(rootPath);
  for (const relativePath of candidates) {
    try {
      const stat = await fs.stat(path.join(rootPath, relativePath), { bigint: true });
      const current = fileIdentity(stat);
      if (current.device === identity.device && current.inode === identity.inode) {
        return relativePath;
      }
    } catch {
      // The external filesystem may change while a scan is in progress.
    }
  }
  return null;
}

async function readWorkspaceTextFile(filePath: string) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_WORKSPACE_TEXT_BYTES) {
    return {
      buffer: null,
      content: null,
      contentKind: "large" as const,
      encoding: null,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
    };
  }
  const buffer = await fs.readFile(filePath);
  if (buffer.subarray(0, 8192).includes(0)) {
    return {
      buffer,
      content: null,
      contentKind: "binary" as const,
      encoding: null,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
    };
  }
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return {
      buffer,
      content,
      contentKind: "text" as const,
      encoding: "utf-8" as const,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
    };
  } catch {
    return {
      buffer,
      content: null,
      contentKind: "binary" as const,
      encoding: null,
      size: stat.size,
      modifiedAtMs: stat.mtimeMs,
    };
  }
}

async function readGitFileStatus(rootPath: string, relativePath: string, available: boolean) {
  if (!available) return null;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", rootPath, "status", "--porcelain=v1", "--untracked-files=all", "--", relativePath],
      { encoding: "utf8", timeout: 3_000, windowsHide: true },
    );
    return stdout.slice(0, 2).trim() || null;
  } catch {
    return null;
  }
}

function normalizeRelativePath(value: string) {
  if (typeof value !== "string" || value.includes("\0") || path.isAbsolute(value)) return "";
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.split("/").some((part) => !part || part === "..")) {
    return "";
  }
  return normalized;
}

function hasIgnoredDirectory(relativePath: string) {
  return relativePath.split("/").some((part) => ALWAYS_IGNORED_DIRECTORIES.has(part));
}

function fileIdentity(stat: import("node:fs").BigIntStats) {
  return {
    device: String(stat.dev) === "0" ? null : String(stat.dev),
    inode: String(stat.ino) === "0" ? null : String(stat.ino),
  };
}

function getDocumentStorePath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "workspace", "documents.json");
}

function readDocumentStore(projectId: string, dataDir: string) {
  return readJsonFile<FileDocumentStore>(getDocumentStorePath(projectId, dataDir), {
    defaultValue: { version: 1, documents: [] },
    normalize: normalizeDocumentStore,
  });
}

function writeDocumentStore(projectId: string, store: FileDocumentStore, dataDir: string) {
  return writeJsonFile(getDocumentStorePath(projectId, dataDir), store);
}

function normalizeDocumentStore(value: unknown): FileDocumentStore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const store = value as Partial<FileDocumentStore>;
  if (store.version !== 1 || !Array.isArray(store.documents)) return null;
  const documents = store.documents.filter((entry): entry is WorkspaceFileDocument =>
    Boolean(entry) && entry.version === 1 && typeof entry.id === "string" &&
    typeof entry.projectId === "string" && typeof entry.relativePath === "string" &&
    Boolean(entry.fileIdentity) && typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string",
  );
  return { ...store, version: 1, documents } as FileDocumentStore;
}
