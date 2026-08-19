import type { ExecutionStatus } from "@/lib/execution/types";
import type { ChangeSetOperation } from "@/lib/workspace/change-set-types";
import type { ProjectMemoryContextItem } from "@/lib/memory/types";
import type { KnowledgeSearchResult } from "@/lib/knowledge/types";
import type { WorkspaceDirectoryIdentity } from "@/lib/workspace/types";
import type { ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";

export const AGENT_EXECUTION_DETAIL_VERSION = 1 as const;

export type AgentExecutionStage =
  | "planning"
  | "searching"
  | "reading"
  | "editing"
  | "waitingApproval"
  | "waitingInput"
  | "testing"
  | "completed"
  | "failed"
  | "stopped"
  | "interrupted";

export type AgentWorkspaceToolName =
  | "workspace_status"
  | "list_directory"
  | "glob_files"
  | "search_files"
  | "code_diagnostics"
  | "code_intelligence"
  | "view_image"
  | "image_gen"
  | "image_edit"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "apply_patch"
  | "notebook_edit"
  | "propose_patch"
  | "propose_memory"
  | "search_knowledge"
  | "list_mcp_resources"
  | "read_mcp_resource"
  | "web_search"
  | "web_fetch"
  | "browser"
  | "ask_user_question"
  | "enter_plan_mode"
  | "exit_plan_mode"
  | "enter_worktree"
  | "exit_worktree"
  | "shell_command"
  | "task_output"
  | "task_stop"
  | "delegate_tasks"
  | "workflow"
  | "team_create"
  | "agent_spawn"
  | "send_message"
  | "team_delete"
  | "todo_write"
  | "task_create"
  | "task_get"
  | "task_list"
  | "project_task_list"
  | "task_update"
  | "skill"
  | "tool_search"
  | "git_diff"
  | "run_approved_command";

export type AgentCallableToolName = AgentWorkspaceToolName | "send_message" | `mcp__${string}__${string}`;

export type AgentToolCallStatus = "running" | "succeeded" | "failed" | "stopped";

export type AgentToolCall = {
  id: string;
  name: AgentCallableToolName;
  arguments: Record<string, unknown>;
  status: AgentToolCallStatus;
  output?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
};

export type AgentCommandStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "running"
  | "succeeded"
  | "failed"
  | "stopped"
  | "timedOut";

export type AgentCommandRequest = {
  id: string;
  /** Stable Workspace root identity. Missing on legacy commands means primary root. */
  rootId?: string;
  executable: string;
  args: string[];
  /** Original complete shell command when the model used the preferred script protocol. */
  command?: string;
  cwd: string;
  timeoutMs: number;
  reason: string;
  background?: boolean;
  processId?: number;
  /** Durable combined stdout/stderr log for background and auto-backgrounded commands. */
  outputFilePath?: string;
  /** Bytes persisted at outputFilePath. */
  outputFileSize?: number;
  /** True when stdout/stderr shown inline is only a bounded preview. */
  outputPreviewTruncated?: boolean;
  /** True only when the durable output file reached its safety limit. */
  outputFileTruncated?: boolean;
  previewUrl?: string;
  /** Legacy field retained for persisted commands; preview discovery no longer scans unrelated ports. */
  previewBaselinePorts?: number[];
  runtimeInstanceId?: string;
  requiresExplicitApproval?: boolean;
  /** Command mutates Git metadata or the worktree and requires the Root gitWrite capability. */
  requiresGitWrite?: boolean;
  sandboxMode?: "workspace-write" | "danger-full-access";
  /** Historical Codex values remain readable in persisted executions; new Windows commands use `none`. */
  sandboxBackend?: "codex-windows-elevated" | "codex-windows-unelevated" | "platform-default" | "none";
  status: AgentCommandStatus;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  approvalScope?: "once" | "project";
  externalRoot?: {
    displayName: string;
    identity: WorkspaceDirectoryIdentity;
    realPath: string;
    rootPath: string;
  };
};

export type AgentWorkflowTaskSnapshot = {
  taskId: string;
  taskType: "local_workflow";
  runId: string;
  workflowName: string;
  status: "queued" | "running" | "succeeded" | "failed" | "stopped";
  scriptPath: string;
  journalPath: string;
  events: import("@/lib/agent/workflow-types").AgentWorkflowProgressEvent[];
  outcome?: import("@/lib/agent/workflow-types").AgentWorkflowOutcome;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type AgentContextSelection = {
  selectedNodeIds: string[];
  fileDocumentIds: string[];
  canvasContext: string;
  contextSnapshot?: import("@/lib/agent/context-model").AgentContextSnapshot;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  projectMemories?: ProjectMemoryContextItem[];
  knowledgeContext?: KnowledgeSearchResult[];
  /** Stable Workspace root assigned to this execution. Missing means no single-root restriction. */
  workspaceRootId?: string;
  allowedPathPrefixes?: string[];
  allowedTools?: AgentWorkspaceToolName[];
  /** Turn-scoped cc-haha-style permission grants inherited by a forked Skill Agent. */
  additionalAllowedTools?: string[];
  orchestrationId?: string;
  subtaskId?: string;
  agentMemory?: {
    agentType: string;
    scope: "user" | "project" | "local";
  };
  /** Session permission override declared by the selected custom Agent. */
  permissionMode?: import("@/lib/local/settings").ZenmeSessionPermissionMode;
  /** cc-haha-compatible lifecycle hooks declared by the selected custom Agent. */
  agentHooks?: import("@/lib/agent/project-agent-hooks").ProjectAgentHooks;
  /** Inherited and Agent-private MCP servers declared by the selected custom Agent. */
  agentMcpServers?: import("@/lib/agent/project-agent-mcp").ProjectAgentMcpServerSpec[];
  /** Trust source of the selected custom Agent for managed customization policy. */
  agentCustomizationSource?: "policy" | "project" | "user" | "plugin";
  /** Internal Workflow contract enforced before a delegated Sub-agent may complete. */
  structuredResultSchema?: unknown;
};

export type AgentExecutionDetail = {
  version: typeof AGENT_EXECUTION_DETAIL_VERSION;
  id: string;
  projectId: string;
  nodeRunId: string;
  attemptId: string;
  agentId: string;
  instruction: string;
  resultNodeId?: string;
  triggerNodeId?: string;
  context: AgentContextSelection;
  stage: AgentExecutionStage;
  status: ExecutionStatus;
  toolCalls: AgentToolCall[];
  commandRequests: AgentCommandRequest[];
  changeSetIds: string[];
  resultSummary?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  [key: string]: unknown;
};

export type ProposePatchArguments = {
  rootId?: string;
  title: string;
  description?: string;
  operations: Array<{
    fileDocumentId?: string;
    kind: ChangeSetOperation["kind"];
    proposedContent?: string | null;
    relativePath: string;
    targetRelativePath?: string;
  }>;
};

export type AgentWorkspaceToolArguments = {
  workspace_status: { recentFileLimit?: number; rootId?: string };
  list_directory: { relativePath?: string; rootId?: string };
  glob_files: { pattern: string; pathPrefix?: string; maxResults?: number; rootId?: string };
  search_files: { query: string; pathPrefix?: string; maxResults?: number; rootId?: string };
  code_diagnostics: { configPath?: string; relativePaths?: string[]; maxProblems?: number; rootId?: string };
  code_intelligence: {
    operation: import("@/lib/agent/code-intelligence").CodeIntelligenceOperation;
    filePath: string;
    line: number;
    character: number;
    query?: string;
    configPath?: string;
    maxResults?: number;
    rootId?: string;
  };
  view_image: { relativePath: string; rootId?: string };
  image_gen: { prompt: string; count?: number; aspectRatio?: string; quality?: string };
  image_edit: { prompt: string; referencedImagePaths: string[]; aspectRatio?: string; quality?: string };
  search_knowledge: { query: string; limit?: number; budgetCharacters?: number };
  list_mcp_resources: { server?: string; rootId?: string };
  read_mcp_resource: { server: string; uri: string; rootId?: string };
  web_search: { query: string; model?: string };
  web_fetch: { url: string; prompt: string; model?: string; maxCharacters?: number };
  browser: {
    operation: import("@/lib/agent/browser-control").BrowserPreviewOperation;
    url?: string;
    ref?: string;
    text?: string;
    key?: string;
    includeScreenshot?: boolean;
  };
  ask_user_question: {
    /** Legacy single-question shape kept for persisted/tool-call compatibility. */
    question?: string;
    options?: Array<{ label: string; description?: string; preview?: string }>;
    questions?: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description?: string; preview?: string }>;
      multiSelect?: boolean;
    }>;
  };
  enter_plan_mode: Record<string, never>;
  exit_plan_mode: { plan: string };
  enter_worktree: { name?: string };
  exit_worktree: { action: "keep" | "remove"; discardChanges?: boolean };
  read_file: { relativePath: string; startLine?: number; endLine?: number; pages?: string; rootId?: string };
  write_file: { relativePath: string; content: string; title?: string; rootId?: string };
  edit_file: { relativePath: string; oldText: string; newText: string; replaceAll?: boolean; title?: string; rootId?: string };
  apply_patch: { patch: string; title?: string; rootId?: string };
  notebook_edit: { relativePath: string; cellIndex: number; source: string; title?: string; rootId?: string };
  propose_patch: ProposePatchArguments;
  propose_memory: {
    content: string;
    kind: "file" | "architecture" | "decision" | "todo";
    reason?: string;
    sources: ProjectMemoryContextItem["sources"];
    title: string;
  };
  shell_command: {
    cwd?: string;
    rootId?: string;
    reason?: string;
    shell?: "bash" | "powershell";
    timeoutMs?: number;
    run_in_background?: boolean;
    /** @deprecated Persisted compatibility for turns created before the cc-haha Bash protocol alignment. */
    background?: boolean;
  } & (
    | { command: string; executable?: never; args?: never }
    | { command?: never; executable: string; args: string[] }
  );
  task_output: {
    task_id?: string;
    block?: boolean;
    timeout?: number;
    /** @deprecated Persisted compatibility for older Zenme turns. */
    taskId?: string;
    /** @deprecated Persisted compatibility for older Zenme turns. */
    wait?: boolean;
    /** @deprecated Persisted compatibility for older Zenme turns. */
    timeoutMs?: number;
  };
  task_stop: {
    task_id?: string;
    /** @deprecated Persisted compatibility for older Zenme turns. */
    taskId?: string;
  };
  delegate_tasks: {
    goal: string;
    tasks: Array<{
      title: string;
      instruction: string;
      rootId?: string;
      dependsOn?: number[];
      allowedPathPrefixes?: string[];
      allowedTools?: AgentWorkspaceToolName[];
    }>;
    concurrencyLimit?: number;
    model?: string;
  };
  workflow: {
    script?: string;
    scriptPath?: string;
    name?: string;
    rootId?: string;
    args?: unknown;
    resumeFromRunId?: string;
  };
  team_create: { teamName: string; description?: string; maxMembers?: number };
  agent_spawn: {
    teamId?: string;
    name?: string;
    instruction: string;
    agentType?: string;
    title?: string;
    rootId?: string;
    allowedPathPrefixes?: string[];
    allowedTools?: AgentWorkspaceToolName[];
    model?: string;
    isolation?: "worktree";
    mode?: "plan";
    run_in_background?: boolean;
    /** Internal Workflow-only contract; not advertised as a general Agent argument. */
    structuredResultSchema?: unknown;
  };
  send_message: {
    teamId?: string;
    to: string;
    message: string | { type: "shutdown_request"; reason?: string } | {
      type: "plan_approval_response";
      request_id: string;
      approve: boolean;
      feedback?: string;
    };
    summary?: string;
    /** Legacy compatibility for events created before structured Team messages. */
    messageType?: "message" | "shutdown_request";
    model?: string;
  };
  team_delete: { teamId?: string };
  todo_write: {
    items: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>;
  };
  task_create: { subject: string; description: string; activeForm?: string; owner?: string; blockedBy?: string[] };
  task_get: { taskId: string };
  task_list: Record<string, never>;
  /** @deprecated Persisted compatibility for builds that renamed cc-haha's TaskList. */
  project_task_list: Record<string, never>;
  task_update: {
    taskId: string;
    subject?: string;
    description?: string;
    activeForm?: string;
    owner?: string;
    status?: "pending" | "in_progress" | "completed" | "deleted";
    addBlockedBy?: string[];
  };
  skill: { skill: string; args?: string; rootId?: string; /** Internal direct Slash invocation marker. */ invokedBy?: "user" };
  tool_search: { query: string; maxResults?: number };
  git_diff: { relativePaths?: string[]; rootId?: string };
  run_approved_command: { commandRequestId: string };
};

export type AgentWorkspaceToolResult = {
  workspace_status: {
    rootId: string;
    primary: boolean;
    displayName: string;
    status: "resolved" | "missing" | "identity_mismatch";
    permissions: { read: boolean; write: boolean; execute: boolean };
    git: { available: boolean; branch: string | null; dirty: boolean | null };
    changeTracking: "git" | "none";
    summary: {
      directories: number;
      files: number;
      sensitiveFiles: number;
      visibleEntriesMayBeTruncated: boolean;
    };
    roots: Array<{
      rootId: string;
      primary: boolean;
      displayName: string;
      status: "resolved" | "missing" | "identity_mismatch";
      permissions: { read: boolean; write: boolean; execute: boolean };
      git: { available: boolean; branch: string | null; dirty: boolean | null };
    }>;
    topLevelEntries: Array<{ kind: "directory" | "file"; relativePath: string }>;
    recentFiles: Array<{ relativePath: string; size: number; modifiedAt: string }>;
    recentFilesScanTruncated: boolean;
  };
  list_directory: { rootId?: string; entries: Array<{ kind: "directory" | "file"; relativePath: string }> };
  glob_files: {
    rootId?: string;
    paths: string[];
    matches?: Array<{ rootId: string; relativePath: string }>;
    truncated: boolean;
  };
  search_files: {
    rootId?: string;
    matches: Array<{ rootId?: string; line: number; relativePath: string; text: string }>;
    truncated: boolean;
  };
  code_diagnostics: import("@/lib/agent/code-diagnostics").CodeDiagnosticsResult;
  code_intelligence: import("@/lib/agent/code-intelligence").CodeIntelligenceResult;
  view_image: import("@/lib/agent/workspace-images").WorkspaceImageObservation;
  image_gen: import("@/lib/agent/image-tools").AgentImageResult;
  image_edit: import("@/lib/agent/image-tools").AgentImageResult;
  search_knowledge: { results: KnowledgeSearchResult[]; consumedCharacters: number; budgetCharacters: number };
  list_mcp_resources: {
    resources: Array<{ serverId: string; serverName: string; uri: string; name?: string; description?: string; mimeType?: string }>;
    failures: Array<{ serverId: string; serverName: string; error: string }>;
  };
  read_mcp_resource: {
    serverId: string;
    serverName: string;
    uri: string;
    contents: Array<{ uri: string; mimeType?: string; text?: string; binary?: true }>;
    truncated: boolean;
  };
  web_search: { query: string; sources: string[] };
  web_fetch: {
    summary: string;
    claims: Array<{
      claim: string;
      evidence?: string;
      date?: string;
    }>;
    contentType: string;
    finalUrl: string;
    title?: string;
    truncated: boolean;
  };
  browser: import("@/lib/agent/browser-control").BrowserPreviewResult;
  ask_user_question: {
    question: string;
    options: Array<{ label: string; description?: string; preview?: string }>;
    questions: Array<{
      question: string;
      header: string;
      options: Array<{ label: string; description?: string; preview?: string }>;
      multiSelect: boolean;
    }>;
    status: "waitingInput";
  };
  enter_plan_mode: {
    message: string;
    status: "entered";
  };
  exit_plan_mode: {
    filePath: string;
    plan: string;
    question: string;
    options: Array<{ label: string; description?: string }>;
    status: "waitingInput";
  };
  enter_worktree: {
    message: string;
    originalRootId: string;
    rootId: string;
    worktreeBranch: string;
    worktreePath: string;
  };
  exit_worktree: {
    action: "keep" | "remove";
    message: string;
    originalRootId: string;
    worktreeBranch: string;
    worktreePath: string;
    discardedFiles?: number;
    discardedCommits?: number;
  };
  read_file: { content: string; endLine: number; relativePath: string; rootId?: string; startLine: number; totalLines: number };
  write_file: { changeSetId?: string; operation: "create" | "modify"; relativePath?: string; status: "proposed" | "written" };
  edit_file: { changeSetId?: string; replacements: number; relativePath?: string; status: "proposed" | "written" };
  apply_patch: { changeSetId: string; operationCount: number; paths: string[]; status: "proposed" };
  notebook_edit: { changeSetId: string; cellIndex: number; status: "proposed" };
  propose_patch: { changeSetId: string; status: "proposed" };
  propose_memory: { memoryId: string; status: "candidate" };
  shell_command: AgentCommandRequest;
  task_output: AgentCommandRequest | AgentWorkflowTaskSnapshot | AgentBackgroundTaskSnapshot;
  task_stop: AgentCommandRequest | AgentWorkflowTaskSnapshot | AgentBackgroundTaskSnapshot;
  delegate_tasks: {
    orchestrationId: string;
    status: import("@/lib/global-agent/types").GlobalOrchestrationStatus;
    tasks: Array<{
      id: string;
      title: string;
      status: import("@/lib/global-agent/types").GlobalSubtaskStatus;
      resultSummary?: string;
      error?: string;
      changeSetIds: string[];
      agentExecutionId?: string;
      pendingCommand?: Pick<AgentCommandRequest, "id" | "executable" | "args" | "cwd" | "rootId" | "reason" | "externalRoot" | "sandboxMode">;
      messages?: Array<Pick<import("@/lib/global-agent/types").GlobalSubtaskMessage, "id" | "from" | "kind" | "summary" | "text" | "createdAt">>;
    }>;
  };
  workflow: {
    status: "async_launched";
    taskId: string;
    taskType: "local_workflow";
    workflowName: string;
    runId: string;
    summary: string;
    scriptPath: string;
  };
  team_create: {
    teamId: string;
    teamName: string;
    status: import("@/lib/global-agent/types").GlobalOrchestrationStatus;
  };
  agent_spawn: {
    teamId: string;
    agentId: string;
    taskId: string;
    taskType: "local_agent";
    name: string;
    status: import("@/lib/global-agent/types").GlobalSubtaskStatus;
    background: boolean;
    result?: string;
    pendingCommand?: Pick<AgentCommandRequest, "id" | "executable" | "args" | "cwd" | "rootId" | "reason" | "externalRoot" | "sandboxMode">;
  };
  send_message: {
    teamId: string;
    recipients: string[];
    agentIds: string[];
    reactivatedAgentIds: string[];
    delivered: boolean;
    requestId?: string;
    approved?: boolean;
  };
  team_delete: { success: boolean; teamName?: string; activeMembers?: string[]; message: string };
  todo_write: {
    items: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>;
  };
  task_create: { task: import("@/lib/agent/project-session-types").ProjectAgentTaskItem };
  task_get: { task: import("@/lib/agent/project-session-types").ProjectAgentTaskItem | null };
  task_list: {
    tasks: Array<{ id: string; subject: string; status: "pending" | "in_progress" | "completed"; owner?: string; blockedBy: string[] }>;
  };
  /** @deprecated Persisted compatibility for builds that renamed cc-haha's TaskList. */
  project_task_list: {
    tasks: Array<{ id: string; subject: string; status: "pending" | "in_progress" | "completed"; owner?: string; blockedBy: string[] }>;
  };
  task_update: { success: boolean; task: import("@/lib/agent/project-session-types").ProjectAgentTaskItem | null };
  skill: {
    name: string;
    description: string;
    source: "policy" | "project" | "user" | "plugin";
    rootId?: string;
    rootDisplayName?: string;
    baseDirectory: string;
    content: string;
    shell?: "bash" | "powershell";
    hooks?: ProjectAgentHooks;
    allowedTools?: string[];
    argumentHint?: string;
    command?: boolean;
    disableModelInvocation?: boolean;
    effort?: "low" | "medium" | "high" | "xhigh";
    model?: string;
    userInvocable?: boolean;
    executionContext?: "fork";
    agent?: string;
    forked?: true;
    orchestrationId?: string;
    agentId?: string;
    status?: import("@/lib/global-agent/types").GlobalSubtaskStatus | import("@/lib/global-agent/types").GlobalOrchestrationStatus;
    result?: string;
    pendingCommand?: Pick<AgentCommandRequest, "id" | "executable" | "args" | "cwd" | "rootId" | "reason" | "externalRoot" | "sandboxMode">;
    promptShellState?: {
      executionId: string;
      source: string;
      shell: "bash" | "powershell";
      outputs: Array<string | null>;
      pendingCommandId?: string;
    };
  };
  tool_search: {
    tools: Array<{
      name: AgentCallableToolName;
      description: string;
      permission: "read" | "write" | "execute" | "interact";
      requiresWorkspace: boolean;
      example?: Record<string, unknown>;
      parameters?: Record<string, unknown>;
      serverName?: string;
    }>;
  };
  git_diff: {
    state: "ok" | "not_git_repository";
    diff: string;
    truncated: boolean;
  };
  run_approved_command: AgentCommandRequest;
};

export type AgentBackgroundTaskSnapshot = {
  taskId: string;
  taskType: "local_agent";
  orchestrationId: string;
  agentId: string;
  name?: string;
  description: string;
  status: import("@/lib/global-agent/types").GlobalSubtaskStatus;
  prompt: string;
  output: string;
  result?: string;
  error?: string;
  agentExecutionId?: string;
  changeSetIds: string[];
};
