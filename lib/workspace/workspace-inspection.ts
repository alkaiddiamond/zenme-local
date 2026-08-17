import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  WorkspaceDirectoryIdentity,
  WorkspaceGitSummary,
} from "@/lib/workspace/types";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 3_000;
const MAX_FINGERPRINT_ENTRIES = 512;

export class WorkspacePathError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_path"
      | "network_path_unsupported"
      | "not_found"
      | "not_directory",
  ) {
    super(message);
    this.name = "WorkspacePathError";
  }
}

export async function inspectWorkspaceRoot(rawPath: string) {
  if (typeof rawPath !== "string" || !rawPath.trim() || !path.isAbsolute(rawPath)) {
    throw new WorkspacePathError("Workspace 路径必须是绝对目录", "invalid_path");
  }
  if (isNetworkOrDevicePath(rawPath)) {
    throw new WorkspacePathError(
      "Phase 0 暂不支持网络路径或设备路径",
      "network_path_unsupported",
    );
  }

  const rootPath = path.resolve(rawPath);
  let stat;
  let realPath;
  try {
    [stat, realPath] = await Promise.all([
      fs.stat(rootPath, { bigint: true }),
      fs.realpath(rootPath),
    ]);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new WorkspacePathError("Workspace 目录不存在", "not_found");
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new WorkspacePathError("Workspace 必须是目录", "not_directory");
  }

  const [fingerprint, git] = await Promise.all([
    createWorkspaceFingerprint(realPath),
    inspectGitWorkspace(realPath),
  ]);
  const identity: WorkspaceDirectoryIdentity = {
    platform: process.platform,
    device: String(stat.dev) === "0" ? null : String(stat.dev),
    inode: String(stat.ino) === "0" ? null : String(stat.ino),
    fingerprint,
  };

  return {
    displayName: path.basename(realPath) || realPath,
    git,
    identity,
    realPath,
    rootPath,
  };
}

export async function inspectGitWorkspace(
  workspacePath: string,
): Promise<WorkspaceGitSummary> {
  try {
    const [{ stdout: rootOutput }, { stdout: branchOutput }, { stdout: statusOutput }] =
      await Promise.all([
        runGit(workspacePath, ["rev-parse", "--show-toplevel"]),
        runGit(workspacePath, ["branch", "--show-current"]),
        runGit(workspacePath, ["status", "--porcelain", "--untracked-files=no"]),
      ]);
    const repositoryRoot = await fs.realpath(rootOutput.trim());
    return {
      available: true,
      branch: branchOutput.trim() || null,
      dirty: Boolean(statusOutput.trim()),
      repositoryRoot,
    };
  } catch {
    return {
      available: false,
      branch: null,
      dirty: null,
      repositoryRoot: null,
    };
  }
}

export function workspaceIdentityMatches(
  stored: WorkspaceDirectoryIdentity,
  current: WorkspaceDirectoryIdentity,
) {
  if (stored.platform !== current.platform) return false;
  if (stored.device && stored.inode && current.device && current.inode) {
    return stored.device === current.device && stored.inode === current.inode;
  }
  return stored.fingerprint === current.fingerprint;
}

export async function resolveExistingWorkspacePath(
  workspaceRealPath: string,
  relativePath: string,
) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    path.isAbsolute(relativePath) ||
    relativePath.includes("\0")
  ) {
    throw new WorkspacePathError("Workspace 相对路径无效", "invalid_path");
  }
  const candidate = path.resolve(workspaceRealPath, relativePath);
  if (!isInsideRoot(workspaceRealPath, candidate)) {
    throw new WorkspacePathError("Workspace 路径越过授权根目录", "invalid_path");
  }
  let realPath;
  try {
    realPath = await fs.realpath(candidate);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new WorkspacePathError("Workspace 路径不存在", "not_found");
    }
    throw error;
  }
  if (!isInsideRoot(workspaceRealPath, realPath)) {
    throw new WorkspacePathError("Workspace 链接越过授权根目录", "invalid_path");
  }
  return realPath;
}

async function createWorkspaceFingerprint(rootPath: string) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const stableEntries = entries
    .filter((entry) => entry.name !== ".DS_Store")
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_FINGERPRINT_ENTRIES)
    .map((entry) => `${entry.name}:${directoryEntryKind(entry)}`);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableEntries))
    .digest("hex");
}

function directoryEntryKind(entry: import("node:fs").Dirent) {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (entry.isSymbolicLink()) return "symlink";
  return "other";
}

function runGit(cwd: string, args: string[]) {
  return execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
  });
}

function isNetworkOrDevicePath(rawPath: string) {
  const normalized = rawPath.replaceAll("/", "\\");
  return normalized.startsWith("\\\\") || normalized.startsWith("\\?\\");
}

function isInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
