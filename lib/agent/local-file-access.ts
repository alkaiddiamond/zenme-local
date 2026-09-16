import fs from "node:fs/promises";
import path from "node:path";

import { isSensitiveWorkspacePath } from "@/lib/workspace/workspace-files";

export function isInsideLocalDirectory(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

// Explicit absolute paths opt into local filesystem access. Workspace-relative
// paths continue to use the existing workspace resolver and its link boundary.
export async function resolveAgentLocalReadPath(requestedPath: string, dataDir: string) {
  if (!path.isAbsolute(requestedPath) || requestedPath.includes("\0")) {
    throw new Error("本地文件路径必须是有效的绝对路径");
  }
  if (isInsideLocalDirectory(path.resolve(dataDir), path.resolve(requestedPath))) {
    throw new Error("Zenme 内部数据只能通过对应工具或当前 Execution 的输出路径读取");
  }
  const realPath = await fs.realpath(requestedPath);
  const realDataDir = await fs.realpath(dataDir);
  if (isInsideLocalDirectory(realDataDir, realPath)) {
    throw new Error("Zenme 内部数据只能通过对应工具或当前 Execution 的输出路径读取");
  }
  const sensitive = (value: string) => isSensitiveWorkspacePath(path.relative(path.parse(value).root, value).replaceAll("\\", "/"));
  if (sensitive(requestedPath) || sensitive(realPath)) {
    throw new Error("敏感文件默认不提供给 Agent");
  }
  return realPath;
}

export async function listAgentLocalEntries(directory: string, dataDir: string, recursive: boolean, limit: number) {
  const basePath = await resolveAgentLocalReadPath(directory, dataDir);
  const entries: Array<{ kind: "file" | "directory"; relativePath: string; absolutePath: string }> = [];
  const pending = [basePath];
  const ignored = new Set([".git", "node_modules", ".next", "dist", "build", "coverage"]);
  let truncated = false;
  let visited = 0;
  while (pending.length) {
    const current = pending.pop()!;
    try {
      const handle = await fs.opendir(current);
      for await (const entry of handle) {
        if (++visited > limit) { truncated = true; break; }
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue;
        if (recursive && entry.isDirectory() && ignored.has(entry.name)) continue;
        const absolutePath = path.join(current, entry.name);
        try { await resolveAgentLocalReadPath(absolutePath, dataDir); } catch { continue; }
        entries.push({ kind: entry.isDirectory() ? "directory" : "file", relativePath: path.relative(basePath, absolutePath).replaceAll("\\", "/"), absolutePath });
        if (recursive && entry.isDirectory()) pending.push(absolutePath);
      }
    } catch (error) {
      if (current === basePath) throw error;
      truncated = true;
    }
    if (truncated) break;
  }
  return { entries, truncated };
}
