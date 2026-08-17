import type { AgentWorkspaceToolName } from "@/lib/agent/types";
import type { ProjectAgentWorktree } from "@/lib/agent/project-agent-worktree";
import type { ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import type { ProjectAgentMcpServerSpec } from "@/lib/agent/project-agent-mcp";
import type { ZenmeSessionPermissionMode } from "@/lib/local/settings";

export const GLOBAL_ORCHESTRATION_VERSION = 1 as const;

export type GlobalOrchestrationStatus =
  | "planning"
  | "running"
  | "waitingReview"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";

export type GlobalSubtaskStatus =
  | "queued"
  | "dispatching"
  | "running"
  | "waitingApproval"
  | "waitingInput"
  | "succeeded"
  | "failed"
  | "timedOut"
  | "stopped"
  | "interrupted";

export type GlobalContextEvidence = {
  kind: "selectedNode" | "workspaceFile" | "canvasRelation" | "pathScope" | "projectMemory" | "knowledgeSearch";
  id: string;
  reason: string;
  contentHash?: string;
};

export type GlobalSubtaskMessage = {
  id: string;
  from: "parent" | "subagent";
  /** Human-addressable sender/recipient names used by the persistent Team mailbox. */
  senderName?: string;
  recipientName?: string;
  text: string;
  kind?: "progress" | "question" | "blocked" | "shutdown_request" | "shutdown_response" | "plan_approval_request" | "plan_approval_response";
  summary?: string;
  requestId?: string;
  approve?: boolean;
  reason?: string;
  feedback?: string;
  createdAt: string;
  readAt?: string;
};

export type GlobalSubtask = {
  id: string;
  /** Human-addressable teammate name, unique inside an open team. */
  name?: string;
  title: string;
  instruction: string;
  agentType?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxTurns?: number;
  skills?: string[];
  memory?: "user" | "project" | "local";
  isolation?: "worktree";
  permissionMode?: ZenmeSessionPermissionMode;
  /** cc-haha teammate mode=plan handshake. */
  planModeRequired?: boolean;
  planApproval?: {
    requestId: string;
    plan: string;
    status: "pending" | "approved" | "rejected";
    feedback?: string;
    createdAt: string;
    respondedAt?: string;
  };
  hooks?: ProjectAgentHooks;
  mcpServers?: ProjectAgentMcpServerSpec[];
  customizationSource?: "policy" | "project" | "user" | "plugin";
  structuredResultSchema?: unknown;
  worktree?: ProjectAgentWorktree;
  /** Stable Workspace root this task is confined to. */
  rootId?: string;
  rootDisplayName?: string;
  dependsOn: string[];
  allowedPathPrefixes: string[];
  allowedTools: AgentWorkspaceToolName[];
  additionalAllowedTools?: string[];
  baselineHashes: Record<string, string>;
  status: GlobalSubtaskStatus;
  agentExecutionId?: string;
  changeSetIds: string[];
  messages: GlobalSubtaskMessage[];
  resultSummary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type GlobalConflictEdge = {
  leftSubtaskId: string;
  rightSubtaskId: string;
  relativePaths: string[];
};

export type CanvasConvergenceProposal = {
  generatedAt: string;
  summary: string;
  suggestedLifecycle: "knowledge" | "archived";
  foldExecutionDetails: boolean;
  preserveChangeSetIds: string[];
  promoteMemoryIds: string[];
  rationale: string[];
};

export type GlobalOrchestration = {
  version: typeof GLOBAL_ORCHESTRATION_VERSION;
  id: string;
  projectId: string;
  resultNodeId: string;
  triggerNodeId: string;
  parentTurnId?: string;
  kind?: "batch" | "team";
  teamName?: string;
  description?: string;
  deletedAt?: string;
  goal: string;
  status: GlobalOrchestrationStatus;
  concurrencyLimit: number;
  maxSubagents: number;
  contextEvidence: GlobalContextEvidence[];
  selectedNodeIds: string[];
  fileDocumentIds: string[];
  canvasContext: string;
  tasks: GlobalSubtask[];
  conflicts: GlobalConflictEdge[];
  applicationOrder: string[];
  resultSummary?: string;
  convergenceProposal?: CanvasConvergenceProposal;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type GlobalTaskPlanInput = {
  name?: string;
  agentType?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxTurns?: number;
  skills?: string[];
  memory?: "user" | "project" | "local";
  isolation?: "worktree";
  permissionMode?: ZenmeSessionPermissionMode;
  planModeRequired?: boolean;
  hooks?: ProjectAgentHooks;
  mcpServers?: ProjectAgentMcpServerSpec[];
  customizationSource?: "policy" | "project" | "user" | "plugin";
  structuredResultSchema?: unknown;
  title: string;
  instruction: string;
  rootId?: string;
  dependsOn?: number[];
  allowedPathPrefixes?: string[];
  allowedTools?: AgentWorkspaceToolName[];
  additionalAllowedTools?: string[];
};
