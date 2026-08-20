export type ChangeSetStatus =
  | "proposed"
  | "approved"
  | "applying"
  | "applied"
  | "reverting"
  | "rejected"
  | "conflict"
  | "reverted";

export type ChangeSetOperation = {
  id: string;
  kind: "create" | "modify" | "delete" | "rename";
  relativePath: string;
  targetRelativePath?: string;
  baseHash: string | null;
  beforeContent: string | null;
  proposedContent: string | null;
  appliedHash?: string | null;
  fileDocumentId?: string;
};

export type WorkspaceChangeSet = {
  version: 1;
  id: string;
  projectId: string;
  /** Missing on legacy records, which always belong to the primary root. */
  rootId?: string;
  title: string;
  description: string;
  source: "user" | "agent";
  sourceTaskId?: string;
  sourceExecutionId?: string;
  sourceAgentId?: string;
  status: ChangeSetStatus;
  operations: ChangeSetOperation[];
  error?: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  appliedAt?: string;
  rejectedAt?: string;
  revertedAt?: string;
};
