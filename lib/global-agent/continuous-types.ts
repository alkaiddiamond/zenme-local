export const CONTINUOUS_GLOBAL_AGENT_VERSION = 1 as const;

export type ContinuousGlobalAgentMode = "disabled" | "paused" | "enabled";
export type ContinuousGlobalAgentRuntimeStatus = "disabled" | "paused" | "idle" | "running" | "backoff";

export type ContinuousProjectEventType =
  | "workspace.changed"
  | "changeSet.changed"
  | "execution.changed"
  | "task.changed"
  | "memory.changed"
  | "knowledge.changed"
  | "canvas.lifecycleChanged"
  | "manual.requested";

export type ContinuousProjectEvent = {
  id: string;
  sequence: number;
  type: ContinuousProjectEventType;
  source: "workspace" | "changeSet" | "execution" | "task" | "memory" | "knowledge" | "canvas" | "user";
  sourceId: string;
  idempotencyKey: string;
  createdAt: string;
  data?: Record<string, unknown>;
};

export type ContinuousAgentSuggestion = {
  id: string;
  runId: string;
  kind: "nextTask" | "memoryCandidate" | "knowledgeReview" | "canvasConvergence";
  title: string;
  summary: string;
  rationale: string[];
  sourceEventIds: string[];
  idempotencyKey: string;
  status: "candidate" | "accepted" | "rejected" | "dismissed";
  createdAt: string;
  updatedAt: string;
};

export type ContinuousAgentRun = {
  id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  runtimeInstanceId?: string;
  eventSequences: number[];
  startedAt: string;
  completedAt?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cancelRequestedAt?: string;
};

export type ContinuousAgentBudget = {
  maxRunsPerHour: number;
  maxEventsPerRun: number;
  maxTokensPerHour: number;
  cooldownMs: number;
};

export type ContinuousAgentCheckpoint = {
  lastProcessedSequence: number;
  contextSummary: string;
  waitingItems: string[];
  consecutiveFailures: number;
  windowStartedAt: string;
  runsInWindow: number;
  tokensInWindow: number;
  lastRunAt?: string;
  cooldownUntil?: string;
  activeRun?: ContinuousAgentRun;
};

export type ContinuousGlobalAgentState = {
  version: typeof CONTINUOUS_GLOBAL_AGENT_VERSION;
  projectId: string;
  mode: ContinuousGlobalAgentMode;
  status: ContinuousGlobalAgentRuntimeStatus;
  modelId: string | null;
  budget: ContinuousAgentBudget;
  checkpoint: ContinuousAgentCheckpoint;
  events: ContinuousProjectEvent[];
  runs: ContinuousAgentRun[];
  suggestions: ContinuousAgentSuggestion[];
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type ContinuousAgentSuggestionInput = Pick<ContinuousAgentSuggestion,
  "kind" | "title" | "summary" | "rationale" | "sourceEventIds" | "idempotencyKey">;
