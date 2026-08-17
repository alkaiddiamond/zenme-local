import type { ProjectAgentWorktree } from "@/lib/agent/project-agent-worktree";
import type { ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";

export const PROJECT_AGENT_SESSION_VERSION = 1 as const;

export type ProjectAgentEventType =
  | "user"
  | "assistant"
  | "assistantDraft"
  | "thinking"
  | "toolCall"
  | "toolResult"
  | "approval"
  | "status"
  | "compact"
  | "memory"
  | "todo";

export type ProjectAgentTaskItem = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  description?: string;
  activeForm?: string;
  owner?: string;
  blockedBy?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ProjectAgentEvent = {
  id: string;
  sequence: number;
  turnId: string;
  type: ProjectAgentEventType;
  createdAt: string;
  content?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

export type ProjectAgentCompactCheckpoint = {
  id: string;
  summary: string;
  compactedThroughSequence: number;
  sourceTokenEstimate: number;
  createdAt: string;
  [key: string]: unknown;
};

export type ProjectAgentContextState = {
  modelId: string | null;
  interactionMode?: "default" | "plan";
  activePlan?: string;
  activeWorktree?: ProjectAgentWorktree;
  permissionMode?: "untrusted" | "onRequest" | "neverAsk";
  contextWindowTokens: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedEffectiveTokens: number;
  compactedThroughSequence: number;
  activeSummary: string;
  consecutiveCompactionFailures: number;
  compactionBlockedAt?: string;
  lastCompactionFailureCode?: string;
  lastCompactedAt?: string;
  /** Session-scoped hooks registered by invoked Skills, matching cc-haha. */
  skillHooks?: ProjectAgentHooks;
  consumedHookIds?: string[];
  [key: string]: unknown;
};

export type ProjectAgentSession = {
  version: typeof PROJECT_AGENT_SESSION_VERSION;
  id: string;
  projectId: string;
  events: ProjectAgentEvent[];
  compactCheckpoints: ProjectAgentCompactCheckpoint[];
  taskPlan: ProjectAgentTaskItem[];
  context: ProjectAgentContextState;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};

export type ProjectAgentContextBudget = {
  contextWindowTokens: number;
  reservedOutputTokens: number;
  effectiveContextWindowTokens: number;
  compactBufferTokens: number;
  compactAtTokens: number;
};

export type ProjectAgentCompactionPlan = {
  previousSummary: string;
  eventsToSummarize: ProjectAgentEvent[];
  eventsToKeep: ProjectAgentEvent[];
  compactedThroughSequence: number;
  sourceTokenEstimate: number;
  retainedTokenEstimate: number;
};
