import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { getProjectDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;

export type ProjectAgentWorktree = {
  originalRootId: string;
  rootId?: string;
  path: string;
  branch: string;
  headCommit: string;
  gitRoot: string;
  state: "active" | "kept" | "cleaned";
};

export async function createProjectAgentWorktree(input: {
  projectId: string;
  taskId: string;
  name?: string;
  originalRootId: string;
  workspacePath: string;
  dataDir: string;
}): Promise<ProjectAgentWorktree> {
  assertSafePathSegment(input.projectId, "projectId");
  assertSafePathSegment(input.taskId, "taskId");
  const gitRoot = (await runGit(input.workspacePath, ["rev-parse", "--show-toplevel"])).stdout.trim();
  const headCommit = (await runGit(gitRoot, ["rev-parse", "HEAD"])).stdout.trim();
  if (!gitRoot || !headCommit) throw new Error("worktree isolation 需要已提交 HEAD 的 Git 仓库");
  const requestedName = input.name?.trim();
  if (requestedName && (requestedName.length > 64 || requestedName.split("/").some((segment) =>
    !segment || !/^[a-z0-9._-]+$/i.test(segment)))) throw new Error("Agent worktree 名称无效");
  const suffix = requestedName?.replaceAll("/", "-") ?? input.taskId.slice(0, 8).toLocaleLowerCase();
  const slug = `agent-${suffix}`;
  const worktreesRoot = resolveInside(getProjectDir(input.projectId, input.dataDir), "agent-worktrees");
  const worktreePath = resolveInside(worktreesRoot, slug);
  const branch = `zenme/${slug}`;
  await fs.mkdir(worktreesRoot, { recursive: true });
  try {
    await fs.access(worktreePath);
    throw new Error("Agent worktree 路径已存在，拒绝覆盖");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  await runGit(gitRoot, ["worktree", "add", "-b", branch, worktreePath, headCommit]);
  return { originalRootId: input.originalRootId, path: worktreePath, branch, headCommit, gitRoot, state: "active" };
}

export async function settleProjectAgentWorktree(worktree: ProjectAgentWorktree, preserve: boolean) {
  if (worktree.state !== "active") return worktree;
  if (preserve || await projectAgentWorktreeHasChanges(worktree)) return { ...worktree, state: "kept" as const };
  await assertManagedWorktreePath(worktree.path);
  await runGit(worktree.gitRoot, ["worktree", "remove", "--force", worktree.path]);
  await runGit(worktree.gitRoot, ["branch", "-D", worktree.branch]).catch(() => undefined);
  return { ...worktree, state: "cleaned" as const };
}

export async function projectAgentWorktreeHasChanges(worktree: ProjectAgentWorktree) {
  try {
    const status = await runGit(worktree.path, ["status", "--porcelain"]);
    if (status.stdout.trim()) return true;
    const commits = await runGit(worktree.path, ["rev-list", "--count", `${worktree.headCommit}..HEAD`]);
    return Number.parseInt(commits.stdout.trim(), 10) > 0;
  } catch {
    return true;
  }
}

export async function inspectProjectAgentWorktreeChanges(worktree: ProjectAgentWorktree) {
  try {
    const status = await runGit(worktree.path, ["status", "--porcelain"]);
    const changedFiles = status.stdout.split(/\r?\n/).filter((line) => line.trim()).length;
    const commits = await runGit(worktree.path, ["rev-list", "--count", `${worktree.headCommit}..HEAD`]);
    const commitCount = Number.parseInt(commits.stdout.trim(), 10);
    if (!Number.isSafeInteger(commitCount) || commitCount < 0) return null;
    return { changedFiles, commits: commitCount };
  } catch {
    return null;
  }
}

export async function removeProjectAgentWorktree(worktree: ProjectAgentWorktree) {
  if (worktree.state !== "active") throw new Error("当前会话没有可移除的活动 worktree");
  await assertManagedWorktreePath(worktree.path);
  await runGit(worktree.gitRoot, ["worktree", "remove", "--force", worktree.path]);
  await runGit(worktree.gitRoot, ["branch", "-D", worktree.branch]).catch(() => undefined);
  return { ...worktree, state: "cleaned" as const };
}

async function assertManagedWorktreePath(worktreePath: string) {
  const normalized = path.resolve(worktreePath);
  if (!normalized.split(path.sep).includes("agent-worktrees") || !path.basename(normalized).startsWith("agent-")) {
    throw new Error("拒绝清理非 Zenme 管理的 Agent worktree");
  }
}

function runGit(cwd: string, args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  });
}
