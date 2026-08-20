export type AgentWorkflowPhase = {
  title: string;
  detail?: string;
  model?: string;
};

export type AgentWorkflowMeta = {
  name: string;
  description: string;
  title?: string;
  whenToUse?: string;
  model?: string;
  phases?: AgentWorkflowPhase[];
};

export type AgentWorkflowAgentOptions = {
  label?: string;
  phase?: string;
  model?: string;
  effort?: string;
  isolation?: "worktree";
  agentType?: string;
  schema?: unknown;
};

export type AgentWorkflowProgressEvent =
  | { type: "workflow_phase"; index: number; title: string; kind: "meta" | "script" }
  | { type: "workflow_log"; message: string }
  | {
      type: "workflow_agent";
      index: number;
      label: string;
      state: "queued" | "running" | "succeeded" | "failed";
      cached?: boolean;
      phase?: string;
      model?: string;
      startedAt?: number;
      durationMs?: number;
      error?: string;
      resultPreview?: string;
    };

export type AgentWorkflowOutcome = {
  result: unknown;
  agentCount: number;
  failures: string[];
  logs: string[];
  durationMs: number;
  error?: string;
};
