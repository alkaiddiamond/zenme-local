import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import {
  getLocalProject,
  ProjectNotFoundError,
  setLocalProjectWorkspaceBinding,
} from "@/lib/local/project-repository";
import {
  DEFAULT_WORKSPACE_PERMISSIONS,
  type WorkspaceAdditionalRoot,
  type WorkspaceBinding,
  type WorkspaceBindingStatus,
} from "@/lib/workspace/types";
import {
  inspectWorkspaceRoot,
  workspaceIdentityMatches,
} from "@/lib/workspace/workspace-inspection";

export async function bindLocalWorkspace(
  input: { projectId: string; rootPath: string },
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(input.projectId, "projectId");
  const project = await getLocalProject(input.projectId, dataDir);
  if (!project) throw new ProjectNotFoundError();

  const inspected = await inspectWorkspaceRoot(input.rootPath);
  const existing = await readWorkspaceBindingFile(input.projectId, dataDir);
  const isSameDirectory = existing
    ? workspaceIdentityMatches(existing.identity, inspected.identity)
    : false;
  const now = new Date().toISOString();
  const binding: WorkspaceBinding = {
    ...(existing ?? {}),
    version: 1,
    id: existing?.id ?? crypto.randomUUID(),
    projectId: input.projectId,
    rootPath: inspected.rootPath,
    realPath: inspected.realPath,
    displayName: inspected.displayName,
    identity: inspected.identity,
    permissions: isSameDirectory
      ? existing!.permissions
      : { ...DEFAULT_WORKSPACE_PERMISSIONS },
    git: inspected.git,
    status: "resolved",
    trustedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastValidatedAt: now,
  };

  await writeWorkspaceBinding(binding, dataDir);
  await setLocalProjectWorkspaceBinding({
    projectId: input.projectId,
    workspaceBindingId: binding.id,
  }, dataDir);
  return binding;
}

export async function getLocalWorkspaceBinding(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(projectId, "projectId");
  const project = await getLocalProject(projectId, dataDir);
  if (!project) throw new ProjectNotFoundError();
  if (!project.workspaceBindingId) return null;

  const binding = await readWorkspaceBindingFile(projectId, dataDir);
  if (!binding || binding.id !== project.workspaceBindingId) return null;
  const validation = await validateBinding(binding);
  if (validation.changed) {
    await writeWorkspaceBinding(validation.binding, dataDir);
  }
  return validation.binding;
}

export async function unbindLocalWorkspace(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(projectId, "projectId");
  const project = await getLocalProject(projectId, dataDir);
  if (!project) throw new ProjectNotFoundError();
  await setLocalProjectWorkspaceBinding({
    projectId,
    workspaceBindingId: null,
  }, dataDir);
  await fs.rm(getWorkspaceBindingPath(projectId, dataDir), { force: true });
}

export async function setLocalWorkspaceWritePermission(
  input: { allowed: boolean; projectId: string },
  dataDir = getZenmeDataDir(),
) {
  return setLocalWorkspacePermissions({
    permissions: { write: input.allowed },
    projectId: input.projectId,
  }, dataDir);
}

export async function setLocalWorkspacePermissions(
  input: {
    permissions: Partial<Pick<WorkspaceBinding["permissions"], "delete" | "execute" | "gitWrite" | "write">>;
    projectId: string;
  },
  dataDir = getZenmeDataDir(),
) {
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding) throw new Error("Workspace binding not found");
  const next: WorkspaceBinding = {
    ...binding,
    permissions: { ...binding.permissions, ...input.permissions },
    updatedAt: new Date().toISOString(),
  };
  await writeWorkspaceBinding(next, dataDir);
  return next;
}

export async function setLocalWorkspaceRootPermissions(
  input: {
    permissions: Partial<Pick<WorkspaceBinding["permissions"], "delete" | "execute" | "gitWrite" | "write">>;
    projectId: string;
    rootId: string;
  },
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(input.rootId, "rootId");
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding) throw new Error("Workspace binding not found");
  const index = (binding.additionalRoots ?? []).findIndex((root) => root.id === input.rootId);
  if (index < 0) throw new Error("Workspace root not found");
  const now = new Date().toISOString();
  const additionalRoots = [...(binding.additionalRoots ?? [])];
  additionalRoots[index] = {
    ...additionalRoots[index],
    permissions: { ...additionalRoots[index].permissions, ...input.permissions },
    updatedAt: now,
  };
  const next = { ...binding, additionalRoots, updatedAt: now };
  await writeWorkspaceBinding(next, dataDir);
  return next;
}

export async function addLocalWorkspaceRoot(
  input: { projectId: string; rootPath: string },
  dataDir = getZenmeDataDir(),
) {
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding) throw new Error("Workspace binding not found");
  const inspected = await inspectWorkspaceRoot(input.rootPath);
  const roots = [binding.realPath, ...(binding.additionalRoots ?? []).map((root) => root.realPath)];
  const duplicate = roots.some((root) =>
    isSameOrInside(root, inspected.realPath) || isSameOrInside(inspected.realPath, root));
  if (duplicate) return binding;
  const now = new Date().toISOString();
  const additionalRoot: WorkspaceAdditionalRoot = {
    id: crypto.randomUUID(),
    rootPath: inspected.rootPath,
    realPath: inspected.realPath,
    displayName: inspected.displayName,
    identity: inspected.identity,
    permissions: { ...DEFAULT_WORKSPACE_PERMISSIONS },
    git: inspected.git,
    status: "resolved",
    trustedAt: now,
    createdAt: now,
    updatedAt: now,
    lastValidatedAt: now,
  };
  const next = {
    ...binding,
    additionalRoots: [...(binding.additionalRoots ?? []), additionalRoot],
    updatedAt: now,
  };
  await writeWorkspaceBinding(next, dataDir);
  return next;
}

export async function removeLocalWorkspaceRoot(
  input: { projectId: string; rootId: string },
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(input.rootId, "rootId");
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding) throw new Error("Workspace binding not found");
  const next = {
    ...binding,
    additionalRoots: (binding.additionalRoots ?? []).filter((root) => root.id !== input.rootId),
    updatedAt: new Date().toISOString(),
  };
  await writeWorkspaceBinding(next, dataDir);
  return next;
}

async function validateBinding(binding: WorkspaceBinding) {
  const now = new Date().toISOString();
  let status: WorkspaceBindingStatus = "resolved";
  let current = null;
  try {
    current = await inspectWorkspaceRoot(binding.rootPath);
    if (
      path.normalize(current.realPath) !== path.normalize(binding.realPath) ||
      !workspaceIdentityMatches(binding.identity, current.identity)
    ) {
      status = "identity_mismatch";
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "not_found" || error.code === "not_directory")
    ) {
      status = "missing";
    } else {
      throw error;
    }
  }

  const additionalRoots = await Promise.all((binding.additionalRoots ?? []).map(validateAdditionalRoot));
  const next: WorkspaceBinding = {
    ...binding,
    status,
    git: status === "resolved" && current ? current.git : binding.git,
    updatedAt: status === binding.status ? binding.updatedAt : now,
    lastValidatedAt: now,
    additionalRoots,
  };
  return {
    binding: next,
    changed:
      next.status !== binding.status ||
      JSON.stringify(next.git) !== JSON.stringify(binding.git) ||
      next.additionalRoots?.some((root, index) =>
        root.status !== binding.additionalRoots?.[index]?.status ||
        JSON.stringify(root.git) !== JSON.stringify(binding.additionalRoots?.[index]?.git)) ||
      next.additionalRoots?.length !== (binding.additionalRoots ?? []).length,
  };
}

async function validateAdditionalRoot(root: WorkspaceAdditionalRoot): Promise<WorkspaceAdditionalRoot> {
  const now = new Date().toISOString();
  try {
    const current = await inspectWorkspaceRoot(root.rootPath);
    const status = path.normalize(current.realPath) === path.normalize(root.realPath) &&
      workspaceIdentityMatches(root.identity, current.identity) ? "resolved" : "identity_mismatch";
    return {
      ...root,
      git: status === "resolved" ? current.git : root.git,
      status,
      updatedAt: status === root.status ? root.updatedAt : now,
      lastValidatedAt: now,
    };
  } catch {
    return { ...root, status: "missing", updatedAt: root.status === "missing" ? root.updatedAt : now, lastValidatedAt: now };
  }
}

function isSameOrInside(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function readWorkspaceBindingFile(projectId: string, dataDir: string) {
  return readJsonFile<WorkspaceBinding | null>(
    getWorkspaceBindingPath(projectId, dataDir),
    { defaultValue: null, normalize: normalizeWorkspaceBinding },
  );
}

async function writeWorkspaceBinding(binding: WorkspaceBinding, dataDir: string) {
  const bindingPath = getWorkspaceBindingPath(binding.projectId, dataDir);
  await fs.mkdir(path.dirname(bindingPath), { recursive: true });
  await writeJsonFile(bindingPath, binding);
}

function getWorkspaceBindingPath(projectId: string, dataDir: string) {
  return resolveInside(
    getProjectDir(projectId, dataDir),
    "workspace",
    "binding.json",
  );
}

function normalizeWorkspaceBinding(value: unknown): WorkspaceBinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<WorkspaceBinding>;
  if (
    row.version !== 1 ||
    typeof row.id !== "string" ||
    typeof row.projectId !== "string" ||
    typeof row.rootPath !== "string" ||
    typeof row.realPath !== "string" ||
    typeof row.displayName !== "string" ||
    !row.identity ||
    !row.permissions ||
    !row.git ||
    (row.status !== "resolved" &&
      row.status !== "missing" &&
      row.status !== "identity_mismatch") ||
    typeof row.trustedAt !== "string" ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string" ||
    typeof row.lastValidatedAt !== "string"
  ) {
    return null;
  }
  return {
    ...(row as WorkspaceBinding),
    additionalRoots: Array.isArray(row.additionalRoots)
      ? row.additionalRoots
        .map((root) => normalizeWorkspaceAdditionalRoot(root))
        .filter((root): root is WorkspaceAdditionalRoot => Boolean(root))
      : [],
  };
}

function normalizeWorkspaceAdditionalRoot(value: unknown): WorkspaceAdditionalRoot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Partial<WorkspaceAdditionalRoot>;
  if (!(typeof root.id === "string" && typeof root.rootPath === "string" &&
    typeof root.realPath === "string" && typeof root.displayName === "string" &&
    Boolean(root.identity) &&
    (root.status === "resolved" || root.status === "missing" || root.status === "identity_mismatch") &&
    typeof root.trustedAt === "string" && typeof root.createdAt === "string" &&
    typeof root.updatedAt === "string" && typeof root.lastValidatedAt === "string")) return null;
  return {
    ...(root as WorkspaceAdditionalRoot),
    permissions: root.permissions ?? { ...DEFAULT_WORKSPACE_PERMISSIONS },
    git: root.git ?? { available: false, branch: null, dirty: null, repositoryRoot: null },
  };
}
