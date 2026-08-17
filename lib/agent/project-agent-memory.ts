import fs from "node:fs/promises";
import path from "node:path";

import { getProjectDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceRootCapability, resolveWorkspaceRoot } from "@/lib/workspace/types";

export type ProjectAgentMemoryScope = "user" | "project" | "local";

export const AGENT_MEMORY_VIRTUAL_ROOT = "@agent-memory";
export const AGENT_MEMORY_ENTRYPOINT = `${AGENT_MEMORY_VIRTUAL_ROOT}/MEMORY.md`;

const MAX_AGENT_MEMORY_FILE_BYTES = 100 * 1024;

export async function loadProjectAgentMemoryPrompt(input: {
  projectId: string;
  agentType: string;
  scope: ProjectAgentMemoryScope;
  rootId?: string;
  dataDir: string;
}) {
  const content = await readProjectAgentMemoryFile({ ...input, virtualPath: AGENT_MEMORY_ENTRYPOINT, missingAsEmpty: true });
  const scopeGuidance = input.scope === "user"
    ? "这些记忆跨项目共享，只记录可复用的通用经验。"
    : input.scope === "project"
      ? "这些记忆属于项目并可进入版本控制，只记录对该项目长期有用的信息。"
      : "这些记忆仅属于当前项目和本机，不进入版本控制。";
  return [
    `<persistent-agent-memory scope="${input.scope}" path="${AGENT_MEMORY_ENTRYPOINT}">`,
    scopeGuidance,
    `使用 read_file、write_file、edit_file 维护 ${AGENT_MEMORY_ENTRYPOINT}；该虚拟路径只对当前 Agent 类型开放。`,
    "MEMORY.md 会在每次启动该 Agent 时载入。保持内容简洁、可检索，不要写入密钥或临时任务状态。",
    content.trim() ? `\n当前记忆：\n${content.trim()}` : "\n当前没有已保存记忆。",
    "</persistent-agent-memory>",
  ].join("\n");
}

export function isProjectAgentMemoryVirtualPath(value: unknown): value is string {
  return typeof value === "string" && (value === AGENT_MEMORY_VIRTUAL_ROOT || value.startsWith(`${AGENT_MEMORY_VIRTUAL_ROOT}/`));
}

export async function readProjectAgentMemoryFile(input: {
  projectId: string;
  agentType: string;
  scope: ProjectAgentMemoryScope;
  rootId?: string;
  virtualPath: string;
  missingAsEmpty?: boolean;
  dataDir: string;
}) {
  const filePath = await resolveAgentMemoryPath(input, false);
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_AGENT_MEMORY_FILE_BYTES) throw new Error("Agent Memory 文件不可读或超过 100 KiB");
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (input.missingAsEmpty && isMissing(error)) return "";
    throw error;
  }
}

export async function writeProjectAgentMemoryFile(input: {
  projectId: string;
  agentType: string;
  scope: ProjectAgentMemoryScope;
  rootId?: string;
  virtualPath: string;
  content: string;
  dataDir: string;
}) {
  if (Buffer.byteLength(input.content, "utf8") > MAX_AGENT_MEMORY_FILE_BYTES) throw new Error("Agent Memory 文件超过 100 KiB");
  const filePath = await resolveAgentMemoryPath(input, true);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, input.content, { encoding: "utf8", flag: "w" });
  return { relativePath: input.virtualPath, bytes: Buffer.byteLength(input.content, "utf8") };
}

async function resolveAgentMemoryPath(input: {
  projectId: string;
  agentType: string;
  scope: ProjectAgentMemoryScope;
  rootId?: string;
  virtualPath: string;
  dataDir: string;
}, forWrite: boolean) {
  assertSafePathSegment(input.projectId, "projectId");
  const agentDirName = sanitizeAgentType(input.agentType);
  const relativePath = normalizeVirtualMemoryPath(input.virtualPath);
  let basePath: string;
  let containmentRoot: string;
  if (input.scope === "user") {
    containmentRoot = resolveInside(input.dataDir, "agent-memory");
    basePath = resolveInside(containmentRoot, agentDirName);
  } else if (input.scope === "local") {
    containmentRoot = resolveInside(getProjectDir(input.projectId, input.dataDir), "agent-memory-local");
    basePath = resolveInside(containmentRoot, agentDirName);
  } else {
    const binding = await getLocalWorkspaceBinding(input.projectId, input.dataDir);
    const root = binding ? resolveWorkspaceRoot(binding, input.rootId) : null;
    const capability = forWrite ? "write" : "read";
    if (!root || !canUseWorkspaceRootCapability(root, capability)) throw new Error(`Agent Memory 的项目 Workspace 未授权${forWrite ? "写入" : "读取"}`);
    containmentRoot = root.realPath;
    basePath = resolveInside(containmentRoot, ".claude", "agent-memory", agentDirName);
  }
  await ensureMemoryBasePath(containmentRoot, basePath);
  return resolveInside(basePath, ...relativePath.split("/"));
}

async function ensureMemoryBasePath(containmentRoot: string, basePath: string) {
  await fs.mkdir(containmentRoot, { recursive: true });
  const containmentStat = await fs.lstat(containmentRoot);
  if (containmentStat.isSymbolicLink() || !containmentStat.isDirectory()) throw new Error("Agent Memory 根目录不安全");
  const relative = path.relative(containmentRoot, basePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Agent Memory 路径越界");
  let current = containmentRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Agent Memory 路径包含不安全链接或非目录项");
    } catch (error) {
      if (!isMissing(error)) throw error;
      await fs.mkdir(current);
    }
  }
}

function normalizeVirtualMemoryPath(value: string) {
  if (!isProjectAgentMemoryVirtualPath(value)) throw new Error("Agent Memory 虚拟路径无效");
  const relative = value.slice(AGENT_MEMORY_VIRTUAL_ROOT.length).replace(/^\//, "");
  if (!relative || relative.length > 500 || path.posix.isAbsolute(relative) || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Agent Memory 虚拟路径无效");
  }
  return relative;
}

function sanitizeAgentType(value: string) {
  const normalized = value.trim().replaceAll(":", "-");
  assertSafePathSegment(normalized, "agentType");
  return normalized;
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}
