import type {
  AssetRef,
  Execution,
  ExecutionAttempt,
  ExecutionError,
  ExecutionInputSnapshot,
  ExecutionKind,
  ExecutionStatus,
  ExecutionStore,
  NodeRun,
} from "@/lib/execution/types";
import {
  EXECUTION_STORE_VERSION,
  isActiveExecutionStatus,
  isTerminalExecutionStatus,
} from "@/lib/execution/types";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";

type LegacyExecutionStore = {
  version: 0;
  runs: Array<{
    id: string;
    projectId: string;
    nodeId: string;
    kind: ExecutionKind;
    status: ExecutionStatus;
    taskId?: string;
    providerId?: string;
    modelId?: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

const mutationLocks = new Map<string, Promise<unknown>>();

export async function listLocalExecutions(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  const store = await readExecutionStore(projectId, dataDir);
  return [...store.executions].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export async function listRecoverableLocalExecutions(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  return (await listLocalExecutions(projectId, dataDir)).filter((execution) =>
    isActiveExecutionStatus(execution.status),
  );
}

export async function getLocalExecution(
  input: { executionId: string; projectId: string },
  dataDir = getZenmeDataDir(),
) {
  assertExecutionIdentifiers(input);
  return (await readExecutionStore(input.projectId, dataDir)).executions.find(
    (execution) => execution.id === input.executionId,
  ) ?? null;
}

export async function createLocalExecution(input: {
  executionId?: string;
  kind: ExecutionKind;
  input?: ExecutionInputSnapshot;
  modelId?: string;
  nodeId: string;
  nodeRunId?: string;
  attemptId?: string;
  projectId: string;
  providerId?: string;
  startedAt?: string;
  triggerNodeId: string;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  const executionId = input.executionId ?? crypto.randomUUID();
  const nodeRunId = input.nodeRunId ?? crypto.randomUUID();
  const attemptId = input.attemptId ?? crypto.randomUUID();
  const now = input.startedAt ?? new Date().toISOString();
  const attempt: ExecutionAttempt = {
    id: attemptId,
    sequence: 1,
    status: "running",
    providerId: input.providerId,
    modelId: input.modelId,
    input: input.input,
    assetRefs: [],
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };
  const nodeRun: NodeRun = {
    id: nodeRunId,
    executionId,
    nodeId: input.nodeId,
    kind: input.kind,
    status: "running",
    currentAttemptId: attemptId,
    attempts: [attempt],
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };
  const execution: Execution = {
    id: executionId,
    projectId: input.projectId,
    triggerNodeId: input.triggerNodeId,
    status: "running",
    nodeRuns: [nodeRun],
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };

  await mutateExecutionStore(input.projectId, dataDir, (store) => {
    if (store.executions.some((current) => current.id === executionId)) {
      throw new Error("执行记录已存在");
    }
    store.executions.push(execution);
    return execution;
  });
  return execution;
}

export async function updateLocalExecutionAttempt(input: {
  assetRefs?: AssetRef[];
  attemptId: string;
  error?: ExecutionError | null;
  executionId: string;
  externalTaskId?: string;
  outputText?: string;
  nodeRunId: string;
  projectId: string;
  status: ExecutionStatus;
  updatedAt?: string;
}, dataDir = getZenmeDataDir()) {
  assertExecutionIdentifiers(input);
  return mutateExecutionStore(input.projectId, dataDir, (store) => {
    const execution = requireExecution(store, input.executionId);
    const nodeRun = requireNodeRun(execution, input.nodeRunId);
    const attempt = requireAttempt(nodeRun, input.attemptId);
    const now = input.updatedAt ?? new Date().toISOString();

    // A late provider response must never revive or overwrite a stopped, timed-out,
    // failed, or already completed attempt. Retry creates a new Attempt instead.
    if (isTerminalExecutionStatus(attempt.status)) return execution;

    attempt.status = input.status;
    attempt.updatedAt = now;
    if (input.externalTaskId !== undefined) attempt.externalTaskId = input.externalTaskId;
    if (input.outputText !== undefined) attempt.outputText = input.outputText;
    if (input.error === null) delete attempt.error;
    else if (input.error) attempt.error = input.error;
    if (input.assetRefs) attempt.assetRefs = dedupeAssetRefs(input.assetRefs);
    if (isTerminalExecutionStatus(input.status)) attempt.completedAt = now;

    nodeRun.status = input.status;
    nodeRun.updatedAt = now;
    if (isTerminalExecutionStatus(input.status)) nodeRun.completedAt = now;

    execution.status = summarizeExecutionStatus(execution.nodeRuns);
    execution.updatedAt = now;
    if (isTerminalExecutionStatus(execution.status)) execution.completedAt = now;
    return execution;
  });
}

export async function retryLocalNodeRun(input: {
  executionId: string;
  modelId?: string;
  nodeRunId: string;
  projectId: string;
  providerId?: string;
  startedAt?: string;
}, dataDir = getZenmeDataDir()) {
  assertExecutionIdentifiers(input);
  return mutateExecutionStore(input.projectId, dataDir, (store) => {
    const execution = requireExecution(store, input.executionId);
    const nodeRun = requireNodeRun(execution, input.nodeRunId);
    const now = input.startedAt ?? new Date().toISOString();
    const previousAttempt = nodeRun.attempts.at(-1);
    const attempt: ExecutionAttempt = {
      id: crypto.randomUUID(),
      sequence: nodeRun.attempts.length + 1,
      status: "running",
      providerId: input.providerId ?? previousAttempt?.providerId,
      modelId: input.modelId ?? previousAttempt?.modelId,
      input: previousAttempt?.input,
      assetRefs: [],
      createdAt: now,
      startedAt: now,
      updatedAt: now,
    };
    nodeRun.attempts.push(attempt);
    nodeRun.currentAttemptId = attempt.id;
    nodeRun.status = "running";
    nodeRun.updatedAt = now;
    delete nodeRun.completedAt;
    execution.status = "running";
    execution.updatedAt = now;
    delete execution.completedAt;
    return { attempt, execution };
  });
}

export async function stopLocalExecution(input: {
  executionId: string;
  projectId: string;
  stoppedAt?: string;
}, dataDir = getZenmeDataDir()) {
  assertExecutionIdentifiers(input);
  return mutateExecutionStore(input.projectId, dataDir, (store) => {
    const execution = requireExecution(store, input.executionId);
    const now = input.stoppedAt ?? new Date().toISOString();
    for (const nodeRun of execution.nodeRuns) {
      if (!isActiveExecutionStatus(nodeRun.status)) continue;
      nodeRun.status = "stopped";
      nodeRun.updatedAt = now;
      nodeRun.completedAt = now;
      const attempt = nodeRun.attempts.find(
        (candidate) => candidate.id === nodeRun.currentAttemptId,
      );
      if (attempt && isActiveExecutionStatus(attempt.status)) {
        attempt.status = "stopped";
        attempt.updatedAt = now;
        attempt.completedAt = now;
      }
    }
    execution.status = "stopped";
    execution.updatedAt = now;
    execution.completedAt = now;
    return execution;
  });
}

async function readExecutionStore(projectId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  let migrated = false;
  const filePath = getExecutionStorePath(projectId, dataDir);
  const store = await readJsonFile<ExecutionStore>(filePath, {
    defaultValue: { version: EXECUTION_STORE_VERSION, executions: [] },
    normalize: (value) => {
      const normalized = normalizeExecutionStore(value, projectId);
      migrated = normalized?.migrated ?? false;
      return normalized?.store ?? null;
    },
  });
  if (migrated) await writeJsonFile(filePath, store);
  return store;
}

async function mutateExecutionStore<T>(
  projectId: string,
  dataDir: string,
  mutate: (store: ExecutionStore) => T,
) {
  const filePath = getExecutionStorePath(projectId, dataDir);
  const previous = mutationLocks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const store = await readExecutionStore(projectId, dataDir);
    const result = mutate(store);
    await writeJsonFile(filePath, store);
    return result;
  });
  mutationLocks.set(filePath, next);
  try {
    return await next;
  } finally {
    if (mutationLocks.get(filePath) === next) mutationLocks.delete(filePath);
  }
}

function normalizeExecutionStore(value: unknown, projectId: string) {
  if (!isObject(value)) return null;
  if (value.version === 0 && Array.isArray(value.runs)) {
    const legacy = value as LegacyExecutionStore;
    return {
      migrated: true,
      store: {
        version: EXECUTION_STORE_VERSION,
        executions: legacy.runs.map((run) => migrateLegacyRun(run, projectId)),
      } satisfies ExecutionStore,
    };
  }
  if (value.version !== EXECUTION_STORE_VERSION || !Array.isArray(value.executions)) {
    return null;
  }
  const executions = value.executions
    .map((execution) => normalizeExecution(execution, projectId))
    .filter((execution): execution is Execution => Boolean(execution));
  return {
    migrated: executions.length !== value.executions.length,
    store: { version: EXECUTION_STORE_VERSION, executions } satisfies ExecutionStore,
  };
}

function normalizeExecution(value: unknown, projectId: string): Execution | null {
  if (!isObject(value) || typeof value.id !== "string" || !Array.isArray(value.nodeRuns)) {
    return null;
  }
  if (!isExecutionStatus(value.status) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return null;
  }
  const executionId = value.id;
  const nodeRuns = value.nodeRuns
    .map((nodeRun) => normalizeNodeRun(nodeRun, executionId))
    .filter((nodeRun): nodeRun is NodeRun => Boolean(nodeRun));
  return {
    id: executionId,
    projectId,
    triggerNodeId: typeof value.triggerNodeId === "string" ? value.triggerNodeId : nodeRuns[0]?.nodeId ?? "",
    status: value.status,
    nodeRuns,
    createdAt: value.createdAt,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
    updatedAt: value.updatedAt,
  };
}

function normalizeNodeRun(value: unknown, executionId: string): NodeRun | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.nodeId !== "string" || !isExecutionKind(value.kind) || !isExecutionStatus(value.status) || !Array.isArray(value.attempts)) {
    return null;
  }
  const attempts = value.attempts
    .map(normalizeAttempt)
    .filter((attempt): attempt is ExecutionAttempt => Boolean(attempt));
  const currentAttemptId = typeof value.currentAttemptId === "string"
    ? value.currentAttemptId
    : attempts.at(-1)?.id;
  if (!currentAttemptId || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
  return {
    id: value.id,
    executionId,
    nodeId: value.nodeId,
    kind: value.kind,
    status: value.status,
    currentAttemptId,
    attempts,
    createdAt: value.createdAt,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
    updatedAt: value.updatedAt,
  };
}

function normalizeAttempt(value: unknown): ExecutionAttempt | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.sequence !== "number" || !isExecutionStatus(value.status) || !Array.isArray(value.assetRefs) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    return null;
  }
  return {
    id: value.id,
    sequence: value.sequence,
    status: value.status,
    providerId: typeof value.providerId === "string" ? value.providerId : undefined,
    modelId: typeof value.modelId === "string" ? value.modelId : undefined,
    input: normalizeExecutionInput(value.input),
    externalTaskId: typeof value.externalTaskId === "string" ? value.externalTaskId : undefined,
    outputText: typeof value.outputText === "string" ? value.outputText : undefined,
    error: normalizeExecutionError(value.error),
    assetRefs: value.assetRefs.map(normalizeAssetRef).filter((asset): asset is AssetRef => Boolean(asset)),
    createdAt: value.createdAt,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
    updatedAt: value.updatedAt,
  };
}

function migrateLegacyRun(run: LegacyExecutionStore["runs"][number], projectId: string): Execution {
  const executionId = run.id;
  const nodeRunId = `node-run:${run.id}`;
  const attemptId = `attempt:${run.id}:1`;
  const attempt: ExecutionAttempt = {
    id: attemptId,
    sequence: 1,
    status: run.status,
    providerId: run.providerId,
    modelId: run.modelId,
    externalTaskId: run.taskId,
    assetRefs: [],
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
  return {
    id: executionId,
    projectId,
    triggerNodeId: run.nodeId,
    status: run.status,
    nodeRuns: [{
      id: nodeRunId,
      executionId,
      nodeId: run.nodeId,
      kind: run.kind,
      status: run.status,
      currentAttemptId: attemptId,
      attempts: [attempt],
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }],
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function summarizeExecutionStatus(nodeRuns: NodeRun[]): ExecutionStatus {
  if (nodeRuns.some((nodeRun) => nodeRun.status === "failed")) return "failed";
  if (nodeRuns.some((nodeRun) => nodeRun.status === "timedOut")) return "timedOut";
  if (nodeRuns.some((nodeRun) => nodeRun.status === "running")) return "running";
  if (nodeRuns.some((nodeRun) => nodeRun.status === "polling")) return "polling";
  if (nodeRuns.some((nodeRun) => nodeRun.status === "queued")) return "queued";
  if (nodeRuns.some((nodeRun) => nodeRun.status === "interrupted")) return "interrupted";
  if (nodeRuns.every((nodeRun) => nodeRun.status === "stopped")) return "stopped";
  return "succeeded";
}

function dedupeAssetRefs(assetRefs: AssetRef[]) {
  return [...new Map(assetRefs.map((asset) => [asset.id, asset])).values()];
}

function requireExecution(store: ExecutionStore, executionId: string) {
  const execution = store.executions.find((candidate) => candidate.id === executionId);
  if (!execution) throw new Error("执行记录不存在");
  return execution;
}

function requireNodeRun(execution: Execution, nodeRunId: string) {
  const nodeRun = execution.nodeRuns.find((candidate) => candidate.id === nodeRunId);
  if (!nodeRun) throw new Error("节点运行记录不存在");
  return nodeRun;
}

function requireAttempt(nodeRun: NodeRun, attemptId: string) {
  const attempt = nodeRun.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) throw new Error("执行尝试不存在");
  return attempt;
}

function assertExecutionIdentifiers(input: { executionId: string; projectId: string; nodeRunId?: string; attemptId?: string }) {
  assertSafePathSegment(input.projectId, "projectId");
  assertSafePathSegment(input.executionId, "executionId");
  if (input.nodeRunId) assertSafePathSegment(input.nodeRunId, "nodeRunId");
  if (input.attemptId) assertSafePathSegment(input.attemptId, "attemptId");
}

function getExecutionStorePath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "executions", "index.json");
}

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === "string" && ["queued", "running", "polling", "succeeded", "failed", "stopped", "timedOut", "interrupted"].includes(value);
}

function isExecutionKind(value: unknown): value is ExecutionKind {
  return value === "text" || value === "image" || value === "video";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeExecutionError(value: unknown): ExecutionError | undefined {
  if (!isObject(value) || typeof value.code !== "string" || typeof value.message !== "string" || typeof value.retryable !== "boolean") return undefined;
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    stage: value.stage === "preflight" || value.stage === "submit" || value.stage === "poll" || value.stage === "download" || value.stage === "persist" || value.stage === "recovery" ? value.stage : undefined,
  };
}

function normalizeExecutionInput(value: unknown): ExecutionInputSnapshot | undefined {
  if (!isObject(value) || typeof value.prompt !== "string") return undefined;
  const parameters = isObject(value.parameters)
    ? Object.fromEntries(Object.entries(value.parameters).filter((entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean"))
    : undefined;
  return {
    prompt: value.prompt,
    context: typeof value.context === "string" ? value.context : undefined,
    parameters,
  };
}

function normalizeAssetRef(value: unknown): AssetRef | null {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.fileId !== "string" || typeof value.projectId !== "string" || typeof value.fileName !== "string" || typeof value.sizeBytes !== "number" || typeof value.createdAt !== "string") return null;
  if (value.kind !== "image" && value.kind !== "video" && value.kind !== "audio" && value.kind !== "file") return null;
  return {
    id: value.id,
    fileId: value.fileId,
    projectId: value.projectId,
    kind: value.kind,
    fileName: value.fileName,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : null,
    sizeBytes: value.sizeBytes,
    createdAt: value.createdAt,
  };
}
