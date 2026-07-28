export const EXECUTION_STORE_VERSION = 1 as const;

export type ExecutionKind = "text" | "image" | "video";

export type ExecutionStatus =
  | "queued"
  | "running"
  | "polling"
  | "succeeded"
  | "failed"
  | "stopped"
  | "timedOut"
  | "interrupted";

export type ExecutionError = {
  code: string;
  message: string;
  retryable: boolean;
  stage?: "preflight" | "submit" | "poll" | "download" | "persist" | "recovery";
};

export type ExecutionInputSnapshot = {
  context?: string;
  parameters?: Record<string, string | number | boolean>;
  prompt: string;
};

export type AssetRef = {
  id: string;
  fileId: string;
  projectId: string;
  kind: "image" | "video" | "audio" | "file";
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
};

export type ExecutionAttempt = {
  id: string;
  sequence: number;
  status: ExecutionStatus;
  providerId?: string;
  modelId?: string;
  input?: ExecutionInputSnapshot;
  externalTaskId?: string;
  outputText?: string;
  error?: ExecutionError;
  assetRefs: AssetRef[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type NodeRun = {
  id: string;
  executionId: string;
  nodeId: string;
  kind: ExecutionKind;
  status: ExecutionStatus;
  currentAttemptId: string;
  attempts: ExecutionAttempt[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type Execution = {
  id: string;
  projectId: string;
  triggerNodeId: string;
  status: ExecutionStatus;
  nodeRuns: NodeRun[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};

export type ExecutionStore = {
  version: typeof EXECUTION_STORE_VERSION;
  executions: Execution[];
};

export const ACTIVE_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  "queued",
  "running",
  "polling",
  "interrupted",
]);

export const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  "succeeded",
  "failed",
  "stopped",
  "timedOut",
]);

export function isActiveExecutionStatus(value: ExecutionStatus) {
  return ACTIVE_EXECUTION_STATUSES.has(value);
}

export function isTerminalExecutionStatus(value: ExecutionStatus) {
  return TERMINAL_EXECUTION_STATUSES.has(value);
}

export function createAssetRef(input: {
  createdAt?: string;
  fileId: string;
  fileName: string;
  kind: AssetRef["kind"];
  mimeType: string | null;
  projectId: string;
  sizeBytes: number;
}): AssetRef {
  return {
    id: crypto.randomUUID(),
    fileId: input.fileId,
    projectId: input.projectId,
    kind: input.kind,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
