export const WORKSPACE_CAPABILITIES = [
  "read",
  "write",
  "delete",
  "execute",
  "gitWrite",
] as const;

export type WorkspaceCapability = (typeof WORKSPACE_CAPABILITIES)[number];

export type WorkspacePermissions = Record<WorkspaceCapability, boolean>;

export type WorkspaceBindingStatus =
  | "resolved"
  | "missing"
  | "identity_mismatch";

export type WorkspaceDirectoryIdentity = {
  platform: NodeJS.Platform;
  device: string | null;
  inode: string | null;
  fingerprint: string;
};

export type WorkspaceGitSummary = {
  available: boolean;
  branch: string | null;
  dirty: boolean | null;
  repositoryRoot: string | null;
};

export type WorkspaceBinding = {
  version: 1;
  id: string;
  projectId: string;
  rootPath: string;
  realPath: string;
  displayName: string;
  identity: WorkspaceDirectoryIdentity;
  permissions: WorkspacePermissions;
  git: WorkspaceGitSummary;
  status: WorkspaceBindingStatus;
  trustedAt: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string;
  additionalRoots?: WorkspaceAdditionalRoot[];
  [key: string]: unknown;
};

export type WorkspaceAdditionalRoot = {
  id: string;
  rootPath: string;
  realPath: string;
  displayName: string;
  identity: WorkspaceDirectoryIdentity;
  permissions: WorkspacePermissions;
  git: WorkspaceGitSummary;
  status: WorkspaceBindingStatus;
  trustedAt: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt: string;
};

export type WorkspaceResolvedRoot = {
  id: string;
  primary: boolean;
  rootPath: string;
  realPath: string;
  displayName: string;
  identity: WorkspaceDirectoryIdentity;
  permissions: WorkspacePermissions;
  git: WorkspaceGitSummary;
  status: WorkspaceBindingStatus;
};

export const DEFAULT_WORKSPACE_PERMISSIONS: WorkspacePermissions = {
  read: true,
  write: false,
  delete: false,
  execute: false,
  gitWrite: false,
};

export function canUseWorkspaceCapability(
  binding: WorkspaceBinding,
  capability: WorkspaceCapability,
) {
  return binding.status === "resolved" && binding.permissions[capability] === true;
}

export function listWorkspaceRoots(binding: WorkspaceBinding): WorkspaceResolvedRoot[] {
  return [
    {
      id: binding.id,
      primary: true,
      rootPath: binding.rootPath,
      realPath: binding.realPath,
      displayName: binding.displayName,
      identity: binding.identity,
      permissions: binding.permissions,
      git: binding.git,
      status: binding.status,
    },
    ...(binding.additionalRoots ?? []).map((root) => ({ ...root, primary: false })),
  ];
}

export function resolveWorkspaceRoot(binding: WorkspaceBinding, rootId?: string) {
  const requested = rootId?.trim() || binding.id;
  return listWorkspaceRoots(binding).find((root) => root.id === requested) ?? null;
}

export function canUseWorkspaceRootCapability(
  root: WorkspaceResolvedRoot,
  capability: WorkspaceCapability,
) {
  return root.status === "resolved" && root.permissions[capability] === true;
}
