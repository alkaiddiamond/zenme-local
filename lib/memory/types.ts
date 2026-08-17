export const PROJECT_MEMORY_VERSION = 1 as const;

export type ProjectMemoryKind = "file" | "architecture" | "decision" | "todo";
export type ProjectMemoryStatus = "candidate" | "confirmed" | "needsReview" | "stale" | "rejected";
export type ProjectMemorySourceKind = "workspaceFile" | "changeSet" | "task" | "decision" | "execution" | "canvasNode" | "gitCommit";

export type ProjectMemorySource = {
  kind: ProjectMemorySourceKind;
  id: string;
  label: string;
  /** Stable Workspace root identity for workspaceFile sources. Legacy sources use the primary root. */
  rootId?: string;
  relativePath?: string;
  contentHash?: string | null;
  version?: string;
};

export type ProjectMemoryRevision = {
  revision: number;
  title: string;
  content: string;
  sources: ProjectMemorySource[];
  status: ProjectMemoryStatus;
  reason: string;
  createdAt: string;
  createdBy: "user" | "agent" | "system";
};

export type ProjectMemory = {
  version: typeof PROJECT_MEMORY_VERSION;
  id: string;
  projectId: string;
  kind: ProjectMemoryKind;
  title: string;
  content: string;
  status: ProjectMemoryStatus;
  pinned: boolean;
  sources: ProjectMemorySource[];
  currentRevision: number;
  revisions: ProjectMemoryRevision[];
  supersedesMemoryId?: string;
  invalidationReason?: string;
  lastValidatedAt?: string;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  rejectedAt?: string;
};

export type ProjectMemoryContextItem = {
  id: string;
  kind: ProjectMemoryKind;
  title: string;
  content: string;
  revision: number;
  status: "confirmed";
  sources: ProjectMemorySource[];
};
