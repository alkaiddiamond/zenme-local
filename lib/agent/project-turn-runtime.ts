import crypto from "node:crypto";
import type { ElicitResult } from "@modelcontextprotocol/client";

import {
  createAgentExecution,
  completeAgentExecution,
  getAgentExecution,
  listAgentExecutions,
  setAgentExecutionHooks,
  stopAgentExecution,
} from "@/lib/agent/execution-store";
import { AgentToolPipelineError, executeAgentToolPipeline } from "@/lib/agent/tool-execution-pipeline";
import {
  AgentCommandError,
  type AgentCommandStall,
  approveAgentCommand,
  listAgentBackgroundTasks,
  rejectAgentCommand,
  runApprovedAgentCommand,
  stopRunningAgentCommands,
  waitForAgentBackgroundTaskCompletion,
} from "@/lib/agent/command-runtime";
import { callProjectAgentModel, ProjectAgentModelStreamError, type ProjectAgentModelResponse } from "@/lib/agent/project-agent-model";
import { projectAgentTranscript, projectConversationEvents } from "@/lib/agent/project-agent-transcript";
import { buildAgentRetrievalQuery, formatAgentCanvasContext } from "@/lib/agent/context-router";
import {
  applyAgentContextSnapshot,
  createAgentContextLayers,
  createAgentContextSnapshot,
  parseAgentContextSnapshot,
  type AgentContextSnapshot,
} from "@/lib/agent/context-model";
import {
  appendProjectAgentEvent,
  calculateProjectAgentContextBudget,
  canAttemptProjectAgentCompaction,
  clearProjectAgentAnswerDraft,
  createProjectAgentCompactCheckpoint,
  getProjectAgentConversationRuntimeState,
  getProjectAgentModelContext,
  getProjectAgentSession,
  recordProjectAgentCompactionFailure,
  shouldCompactProjectAgentContext,
  updateProjectAgentConversationContext,
  updateProjectAgentContext,
  updateProjectAgentEvent,
  upsertProjectAgentAnswerDraft,
} from "@/lib/agent/project-session-store";
import {
  isProjectAgentShellCommandTool,
  planProjectAgentCompaction,
  planProjectAgentConversationCompaction,
  projectAgentEventForCompaction,
} from "@/lib/agent/project-context-policy";
import type { AgentCommandRequest, AgentWorkspaceToolArguments, AgentWorkspaceToolName, AgentWorkspaceToolResult } from "@/lib/agent/types";
import {
  AgentHookPreventContinuationError,
  continueProjectSkillPromptShell,
  executeAgentWorkspaceTool,
  persistedAgentWorkspaceToolOutput,
} from "@/lib/agent/workspace-tools";
import { mergeModelImageDataUrls, readWorkspaceImage } from "@/lib/agent/workspace-images";
import { browserScreenshotDataUrl } from "@/lib/agent/browser-control";
import {
  DEFERRED_MODEL_AGENT_TOOL_NAMES,
  describeAgentToolCallValidationError,
  getAgentToolDefinition,
  MODEL_AGENT_TOOL_DEFINITIONS,
  parseAgentToolCall,
} from "@/lib/agent/tool-registry";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalSettings } from "@/lib/local/settings";
import type { AgentFileAttachment } from "@/lib/ai/file-attachment";
import {
  loadReadingFileAttachments,
  MAX_AGENT_READING_ATTACHMENTS,
  ReadingFileAttachmentError,
} from "@/lib/agent/reading-file-attachments";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { resolveProviderModelSelection } from "@/lib/ai/provider-model-resolution";
import { getRelevantConfirmedMemoryContext } from "@/lib/memory/repository";
import { searchProjectKnowledge } from "@/lib/knowledge/index-store";
import type { KnowledgeSearchResult } from "@/lib/knowledge/types";
import { scheduleProjectAutoDream } from "@/lib/agent/project-auto-dream";
import type { ZenmeModelSpeed, ZenmeReasoningEffort, ZenmeSessionPermissionMode } from "@/lib/local/settings";
import { applyWorkspaceChangeSet, approveWorkspaceChangeSet, rejectWorkspaceChangeSet } from "@/lib/workspace/change-sets";
import { listWorkspaceRoots } from "@/lib/workspace/types";
import {
  formatProjectSkillListing,
  listProjectSkills,
  resolveProjectSlashCommand,
} from "@/lib/agent/project-skills";
import { formatProjectAgentDefinitionListing, listProjectAgentDefinitions } from "@/lib/agent/project-agents";
import {
  extractProjectInstructionTargetPaths,
  formatProjectAgentInstructions,
  loadProjectAgentInstructions,
} from "@/lib/agent/project-instructions";
import {
  callProjectMcpTool,
  isMcpToolName,
  listProjectMcpTools,
  parseProjectMcpToolCall,
  searchProjectMcpTools,
  type McpToolName,
  type ProjectMcpElicitationCompleteHandler,
  type ProjectMcpElicitationRequest,
  type ProjectMcpTool,
} from "@/lib/agent/mcp-runtime";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import type { AgentWorkflowProgressEvent } from "@/lib/agent/workflow-types";
import {
  dequeueProjectAgentMessage,
  enqueueProjectAgentMessage,
  listProjectAgentMessages,
} from "@/lib/agent/project-message-queue";
import { getAcceptedContinuousAgentSuggestions } from "@/lib/global-agent/continuous-store";
import type { ContinuousAgentSuggestion } from "@/lib/global-agent/continuous-types";
import { loadProjectAgentHooks } from "@/lib/agent/project-hook-config";
import { resolveProjectAgentHooksWithConfigChangeRuntime } from "@/lib/agent/project-config-change-runtime";
import { loadActiveProjectOutputStyle } from "@/lib/agent/project-output-styles";
import { createProjectAgentToolHooks, runProjectAgentLifecycleHooks } from "@/lib/agent/project-agent-hook-runtime";
import {
  mergeProjectAgentHooks,
  omitConsumedProjectAgentHooks,
  projectAgentHookId,
  type ProjectAgentHook,
  type ProjectAgentHookEvent,
  type ProjectAgentHookMatcher,
  type ProjectAgentHooks,
} from "@/lib/agent/project-agent-hooks";
import type { ProjectAgentHookRuntimeResult } from "@/lib/agent/project-agent-hook-runtime";
import { StreamingToolExecutor } from "@/lib/agent/streaming-tool-executor";
import { persistAgentToolResultForModel } from "@/lib/agent/tool-result-storage";
import {
  formatProjectPromptShellOutput,
  projectPromptShellMatches,
  substituteProjectPromptShellOutputs,
} from "@/lib/agent/project-prompt-shell";
import {
  evaluateProjectToolPermission,
  isProjectToolBlanketDenied,
  loadProjectPermissionRules,
  type ProjectPermissionRule,
} from "@/lib/agent/project-permission-rules";

// Keep the model/tool loop finite. The limit is configurable by callers that
// need a different budget, while production uses a conservative default.
const DEFAULT_MAX_AGENT_TURNS = 64;
const MAX_RESEARCH_ANSWER_RETRIES = 1;
const DEFAULT_CONTEXT_WINDOW = 200_000;
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;
const ESCALATED_MAX_OUTPUT_TOKENS = 64_000;
const PLAN_MODE_ALLOWED_TOOLS = new Set<AgentWorkspaceToolName>([
  "workspace_status", "list_directory", "glob_files", "search_files", "code_diagnostics",
  "code_intelligence", "view_image", "read_file", "search_knowledge", "list_mcp_resources",
  "read_mcp_resource", "web_search", "web_fetch", "browser", "ask_user_question",
  "exit_plan_mode", "task_output", "task_get", "task_list", "skill", "tool_search",
  "git_diff", "write_file", "edit_file",
]);
const STREAMABLE_EXCLUSIVE_TOOLS = new Set<AgentWorkspaceToolName>([
  "view_image", "web_search", "web_fetch", "task_output", "task_stop", "skill", "tool_search",
  "image_gen", "image_edit", "propose_memory",
  "write_file", "edit_file", "apply_patch", "notebook_edit", "propose_patch",
  "task_create", "task_update", "enter_plan_mode", "ask_user_question", "exit_plan_mode", "browser",
  "enter_worktree", "exit_worktree",
  "delegate_tasks", "team_create", "agent_spawn", "send_message", "team_delete",
]);

type ProjectTurnDecision =
  | { type: "tool"; name: AgentWorkspaceToolName | McpToolName; arguments: Record<string, unknown> }
  | { type: "complete"; summary: string };

type WorkspaceToolDecision = {
  type: "tool";
  name: AgentWorkspaceToolName;
  arguments: Record<string, unknown>;
};

type StreamedToolOutcome = {
  decision: Extract<ProjectTurnDecision, { type: "tool" }>;
  event: ProjectAgentEvent;
  error?: string;
  output?: unknown;
};

type FinalizedStreamedToolOutcome = {
  outcome: StreamedToolOutcome;
  output: unknown;
};

type ProjectTurnJob = {
  acceptingSteering: boolean;
  activeStep?: ProjectTurnActiveStep;
  controller: AbortController;
  pendingSteering: Promise<void>;
  promise: Promise<unknown>;
  steeringRevision: number;
  turnId: string;
};
type ProjectTurnActiveStep = {
  controller: AbortController;
  interruptBehavior: "cancel" | "block";
};
type TurnRuntimeState = {
  activeProjects: Set<string>;
  backgroundMonitors: Set<string>;
  jobs: Map<string, ProjectTurnJob>;
  pendingElicitations: Map<string, {
    resolve: (result: ElicitResult) => void;
    signal?: AbortSignal;
    abortListener?: () => void;
  }>;
};
const runtimeKey = Symbol.for("zenme.project-agent-turn-runtime");
const existingRuntime = Reflect.get(globalThis, runtimeKey) as TurnRuntimeState | undefined;
const runtime = existingRuntime ?? {
  activeProjects: new Set<string>(),
  backgroundMonitors: new Set<string>(),
  jobs: new Map<string, ProjectTurnJob>(),
  pendingElicitations: new Map(),
};
if (!existingRuntime) Reflect.set(globalThis, runtimeKey, runtime);
runtime.jobs ??= new Map<string, ProjectTurnJob>();
runtime.backgroundMonitors ??= new Set<string>();
runtime.pendingElicitations ??= new Map();

export class ProjectAgentTurnError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "busy" | "model_failed" | "tool_failed", cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectAgentTurnError";
  }
}

type ProjectAgentQuestionAnswer = {
  eventId: string;
  value?: string;
  answers?: Record<string, string>;
  annotations?: Record<string, { notes?: string; preview?: string }>;
};

export async function startProjectAgentTurnRun(input: {
  projectId: string;
  prompt: string;
  model: string;
  contextSnapshot?: AgentContextSnapshot;
  canvasContext?: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  parentConversationIds?: string[];
  parentTurnId?: string;
  resultNodeId?: string;
  selectedNodeIds?: string[];
  sourceNodeId?: string;
  fileDocumentIds?: string[];
  readingAssetIds?: string[];
  imageDataUrls?: string[];
  turnId?: string;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  permissionMode?: ZenmeSessionPermissionMode;
  resume?: boolean;
  questionAnswer?: ProjectAgentQuestionAnswer;
}, options: {
  dataDir?: string;
  callModel?: typeof callProjectAgentModel;
  executeTool?: typeof executeAgentWorkspaceTool;
  listMcpTools?: typeof listProjectMcpTools;
  callMcpTool?: typeof callProjectMcpTool;
  maxTurns?: number;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const projectRuntimeKey = `${dataDir}\u0000${input.projectId}`;
  const turnId = input.turnId?.trim() || crypto.randomUUID();
  const existing = runtime.jobs.get(projectRuntimeKey);
  if (existing) {
    if (existing.turnId === turnId) return { started: false, turnId };
    throw new ProjectAgentTurnError("项目 Agent 正在处理上一条消息", "busy");
  }
  const controller = new AbortController();
  const promise = runProjectAgentTurn({ ...input, turnId, signal: controller.signal }, { ...options, dataDir })
    .catch(() => undefined)
    .finally(() => {
      if (runtime.jobs.get(projectRuntimeKey)?.controller === controller) runtime.jobs.delete(projectRuntimeKey);
    });
  runtime.jobs.set(projectRuntimeKey, {
    acceptingSteering: true,
    controller,
    pendingSteering: Promise.resolve(),
    promise,
    steeringRevision: 0,
    turnId,
  });
  return { started: true, turnId };
}

export async function steerProjectAgentTurnRun(input: {
  projectId: string;
  prompt: string;
  turnId: string;
}, dataDir = getZenmeDataDir()) {
  const prompt = input.prompt.trim();
  const turnId = input.turnId.trim();
  if (!prompt || prompt.length > 200_000 || !turnId) {
    throw new ProjectAgentTurnError("项目 Agent 补充指令无效", "invalid_input");
  }
  const projectRuntimeKey = `${dataDir}\u0000${input.projectId}`;
  const job = runtime.jobs.get(projectRuntimeKey);
  if (!job || job.turnId !== turnId || !job.acceptingSteering || job.controller.signal.aborted) {
    throw new ProjectAgentTurnError("项目 Agent 当前没有可追加指令的运行中 Turn", "busy");
  }
  job.steeringRevision += 1;
  const revision = job.steeringRevision;
  if (job.activeStep?.interruptBehavior === "cancel") {
    job.activeStep.controller.abort();
  }
  job.pendingSteering = job.pendingSteering.then(async () => {
    await enqueueProjectAgentMessage({
      projectId: input.projectId,
      turnId: job.turnId,
      kind: "user",
      priority: "now",
      content: prompt,
      data: { source: "steering", revision },
    }, dataDir);
    await drainProjectAgentQueuedMessages(input.projectId, job.turnId, dataDir);
    await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId: job.turnId,
      type: "status",
      data: { stage: "steering", revision },
    }, dataDir);
    const { broadcastProjectTurnMessageToSubagents } = await import("@/lib/global-agent/orchestration-store");
    await broadcastProjectTurnMessageToSubagents(input.projectId, job.turnId, prompt, dataDir).catch(() => []);
  });
  await job.pendingSteering;
  return { turnId: job.turnId, revision };
}

export function stopProjectAgentTurnRun(projectId: string, turnId: string, dataDir = getZenmeDataDir()) {
  const job = runtime.jobs.get(`${dataDir}\u0000${projectId}`);
  if (!job || job.turnId !== turnId) return false;
  job.controller.abort();
  return true;
}

export async function answerProjectAgentTurnRun(input: {
  projectId: string;
  turnId: string;
  eventId: string;
  value?: string;
  answers?: Record<string, string>;
  annotations?: ProjectAgentQuestionAnswer["annotations"];
}, dataDir = getZenmeDataDir()) {
  const key = pendingElicitationKey(dataDir, input.projectId, input.turnId, input.eventId);
  const pending = runtime.pendingElicitations.get(key);
  if (!pending) return false;
  await appendProjectAgentQuestionAnswer(input, dataDir);
  runtime.pendingElicitations.delete(key);
  if (pending.abortListener) pending.signal?.removeEventListener("abort", pending.abortListener);
  pending.resolve(parseMcpElicitationAnswer(input.value ?? Object.values(input.answers ?? {})[0] ?? "取消"));
  return true;
}

export async function resolveProjectAgentTurnCommandApproval(input: {
  projectId: string;
  turnId: string;
  eventId: string;
  decision: "approve" | "reject";
  scope?: "once" | "project";
}, dataDir = getZenmeDataDir()) {
  const session = await getProjectAgentSession(input.projectId, dataDir);
  const approvalEvent = session.events.find((event) =>
    event.id === input.eventId && event.turnId === input.turnId && event.type === "approval" &&
    event.data?.status === "pending");
  const executionId = typeof approvalEvent?.data?.executionId === "string" ? approvalEvent.data.executionId : "";
  const commandRequestId = typeof approvalEvent?.data?.commandRequestId === "string"
    ? approvalEvent.data.commandRequestId
    : "";
  if (!approvalEvent || !executionId || !commandRequestId) {
    throw new ProjectAgentTurnError("当前 Turn 没有等待处理的命令审批", "invalid_input");
  }

  if (input.decision === "approve") {
    await approveAgentCommand(
      input.projectId,
      executionId,
      commandRequestId,
      dataDir,
      input.scope ?? "once",
    );
    await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId: input.turnId,
      type: "approval",
      content: approvalEvent.content || "命令已批准",
      data: {
        ...approvalEvent.data,
        status: "approved",
        approvalEventId: approvalEvent.id,
        approvalScope: input.scope ?? "once",
      },
    }, dataDir);
    const toolEvent = await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId: input.turnId,
      type: "toolCall",
      content: "命令正在运行",
      data: {
        executionId,
        name: "shell_command",
        status: "running",
        approvalEventId: approvalEvent.id,
        arguments: {
          command: approvalEvent.data?.command,
          executable: approvalEvent.data?.executable,
          args: approvalEvent.data?.args,
          cwd: approvalEvent.data?.cwd,
        },
      },
    }, dataDir);
    const result = await runApprovedAgentCommand({
      projectId: input.projectId,
      executionId,
      commandId: commandRequestId,
      foregroundBudgetMs: 300_000,
      onProgress: async (progress) => {
        await updateProjectAgentEvent({
          projectId: input.projectId,
          eventId: toolEvent.id,
          content: formatCommandProgress(progress.stdout, progress.stderr),
          data: { elapsedMs: progress.elapsedMs },
        }, dataDir);
      },
    }, dataDir);
    await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId: input.turnId,
      type: "toolResult",
      content: result.stdout || result.stderr ||
        (result.status === "running" ? `后台任务已启动：${result.id}` : "命令执行完成"),
      data: {
        executionId,
        toolCallEventId: toolEvent.id,
        name: "shell_command",
        output: result,
        status: result.status === "succeeded" || result.status === "running" ? "succeeded" : "failed",
      },
    }, dataDir);
  } else {
    const result = await rejectAgentCommand(input.projectId, executionId, commandRequestId, dataDir);
    await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId: input.turnId,
      type: "approval",
      content: "用户拒绝执行命令",
      data: {
        ...approvalEvent.data,
        status: "rejected",
        approvalEventId: approvalEvent.id,
      },
    }, dataDir);
    await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId: input.turnId,
      type: "toolResult",
      content: "用户拒绝执行命令",
      data: { executionId, name: "shell_command", output: result, status: "failed" },
    }, dataDir);
  }

  const refreshed = await getProjectAgentSession(input.projectId, dataDir);
  const userEvent = refreshed.events.find((event) =>
    event.turnId === input.turnId && event.type === "user" && event.data?.meta !== true);
  const model = typeof userEvent?.data?.model === "string" ? userEvent.data.model : "";
  const prompt = userEvent?.content ?? "";
  if (!userEvent || !model || !prompt) {
    throw new ProjectAgentTurnError("当前 Turn 缺少可恢复的原始请求", "invalid_input");
  }
  const started = await startProjectAgentTurnRun({
    projectId: input.projectId,
    turnId: input.turnId,
    prompt,
    model,
    conversationId: userEvent.conversationId,
    reasoningEffort: optionalReasoningEffort(userEvent.data?.reasoningEffort),
    modelSpeed: optionalModelSpeed(userEvent.data?.modelSpeed),
    resume: true,
  }, { dataDir });
  return { turnId: started.turnId, status: "running" as const };
}

export function isProjectAgentTurnRunActive(projectId: string, turnId: string, dataDir = getZenmeDataDir()) {
  const projectRuntimeKey = `${dataDir}\u0000${projectId}`;
  const job = runtime.jobs.get(projectRuntimeKey);
  return job?.turnId === turnId || runtime.activeProjects.has(projectRuntimeKey);
}

async function steeringChanged(projectRuntimeKey: string, revision: number) {
  const job = runtime.jobs.get(projectRuntimeKey);
  await job?.pendingSteering;
  return Boolean(job && job.steeringRevision !== revision);
}

function beginProjectTurnStep(
  projectRuntimeKey: string,
  parentSignal: AbortSignal | undefined,
  interruptBehavior: ProjectTurnActiveStep["interruptBehavior"],
) {
  const job = runtime.jobs.get(projectRuntimeKey);
  if (!job) return { signal: parentSignal, finish: () => undefined };
  const controller = new AbortController();
  const step: ProjectTurnActiveStep = { controller, interruptBehavior };
  const abortFromParent = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  job.activeStep = step;
  return {
    signal: controller.signal,
    finish: () => {
      parentSignal?.removeEventListener("abort", abortFromParent);
      if (job.activeStep === step) job.activeStep = undefined;
    },
  };
}

function claimProjectAgentTurnCompletion(projectRuntimeKey: string, revision: number) {
  const job = runtime.jobs.get(projectRuntimeKey);
  if (!job) return true;
  if (job.steeringRevision !== revision) return false;
  job.acceptingSteering = false;
  return true;
}

export async function runProjectAgentTurn(input: {
  projectId: string;
  prompt: string;
  model: string;
  contextSnapshot?: AgentContextSnapshot;
  canvasContext?: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  parentConversationIds?: string[];
  parentTurnId?: string;
  resultNodeId?: string;
  selectedNodeIds?: string[];
  sourceNodeId?: string;
  fileDocumentIds?: string[];
  readingAssetIds?: string[];
  imageDataUrls?: string[];
  signal?: AbortSignal;
  turnId?: string;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  permissionMode?: ZenmeSessionPermissionMode;
  resume?: boolean;
  questionAnswer?: ProjectAgentQuestionAnswer;
}, options: {
  dataDir?: string;
  callModel?: typeof callProjectAgentModel;
  executeTool?: typeof executeAgentWorkspaceTool;
  listMcpTools?: typeof listProjectMcpTools;
  callMcpTool?: typeof callProjectMcpTool;
  maxTurns?: number;
} = {}) {
  input = applyAgentContextSnapshot(input);
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const callModel = options.callModel ?? callProjectAgentModel;
  const executeTool = options.executeTool ?? executeAgentWorkspaceTool;
  const listMcpTools = options.listMcpTools ?? listProjectMcpTools;
  const callMcpTool = options.callMcpTool ?? callProjectMcpTool;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_AGENT_TURNS;
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new ProjectAgentTurnError("Agent Turn 预算无效", "invalid_input");
  }
  const projectRuntimeKey = `${dataDir}\u0000${input.projectId}`;
  validateTurnInput(input);
  if (runtime.activeProjects.has(projectRuntimeKey)) {
    throw new ProjectAgentTurnError("项目 Agent 正在处理上一条消息", "busy");
  }
  runtime.activeProjects.add(projectRuntimeKey);
  const turnId = input.turnId?.trim() || crypto.randomUUID();
  let executionId: string | undefined;
  let runMainLifecycleForFailure: ((
    event: Exclude<ProjectAgentHookEvent, "PreToolUse" | "PostToolUse" | "PostToolUseFailure">,
    payload?: Record<string, unknown>,
  ) => Promise<ProjectAgentHookRuntimeResult | undefined>) | undefined;
  let research = createTurnResearchState();
  let approvedBrowserAction: Record<string, unknown> | undefined;
  let approvedWorkflowAction: Record<string, unknown> | undefined;
  let approvedMcpAction: { name: McpToolName; arguments: Record<string, unknown> } | undefined;
  let readingFileAttachments: AgentFileAttachment[] = [];
  const loadedInstructionPaths = new Set<string>();
  try {
    await clearProjectAgentAnswerDraft({ projectId: input.projectId, turnId }, dataDir);
    try {
      readingFileAttachments = await loadReadingFileAttachments({
        assetIds: input.readingAssetIds,
        dataDir,
        projectId: input.projectId,
      });
    } catch (error) {
      if (error instanceof ReadingFileAttachmentError) {
        throw new ProjectAgentTurnError(error.message, "invalid_input", error);
      }
      throw error;
    }
    const submittedPrompt = input.prompt;
    const manualCompactInstructions = !input.resume
      ? projectCompactInstructions(submittedPrompt)
      : undefined;
    const contextUsageRequested = !input.resume && submittedPrompt.trim().toLowerCase() === "/context";
    const resumedSession = input.resume ? await getProjectAgentSession(input.projectId, dataDir) : undefined;
    let skillInvocationEvent = resumedSession?.events.find((event) =>
      event.turnId === turnId && event.type === "user" && event.data?.skillInvocation === true);
    const slashCommand = !input.resume && manualCompactInstructions === undefined && !contextUsageRequested &&
        !projectSetupTrigger(submittedPrompt) && !isReservedLocalSlashCommand(submittedPrompt)
      ? await resolveProjectSlashCommand({
          projectId: input.projectId,
          dataDir,
          prompt: submittedPrompt,
        })
      : null;
    const persistedCommandModel = typeof skillInvocationEvent?.data?.commandModel === "string"
      ? skillInvocationEvent.data.commandModel
      : undefined;
    const persistedAllowedTools = Array.isArray(skillInvocationEvent?.data?.allowedTools)
      ? skillInvocationEvent.data.allowedTools.filter((value): value is string => typeof value === "string")
      : [];
    const turnModel = slashCommand?.model || persistedCommandModel || input.model;
    const turnAdditionalAllowedTools = new Set(slashCommand?.allowedTools ?? persistedAllowedTools);
    const modelInfo = await resolveTurnModel(
      input.projectId,
      turnModel,
      input.permissionMode,
      dataDir,
      input.conversationId,
    );
    const existingTurnUserEvent = input.resume
      ? (await getProjectAgentSession(input.projectId, dataDir)).events.find((event) =>
          event.turnId === turnId && event.type === "user")
      : undefined;
    const turnReasoningEffort = input.reasoningEffort ?? slashCommand?.effort ??
      optionalReasoningEffort(existingTurnUserEvent?.data?.reasoningEffort) ?? modelInfo.reasoningEffort;
    const turnModelSpeed = input.modelSpeed ??
      optionalModelSpeed(existingTurnUserEvent?.data?.modelSpeed) ?? modelInfo.modelSpeed;
    if (input.resume) {
      executionId = await recoverRunningParentExecutionId(input.projectId, turnId, dataDir);
    }
    if (input.resume && input.questionAnswer) {
      const resumedQuestion = await appendProjectAgentQuestionAnswer({
        projectId: input.projectId,
        turnId,
        eventId: input.questionAnswer.eventId,
        value: input.questionAnswer.value,
        answers: input.questionAnswer.answers,
        annotations: input.questionAnswer.annotations,
      }, dataDir);
      approvedBrowserAction = resumedQuestion.browserAction;
      approvedWorkflowAction = resumedQuestion.workflowAction;
      approvedMcpAction = resumedQuestion.mcpAction;
    }
    if (!input.resume) await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId,
      conversationId: input.conversationId,
      parentConversationIds: input.parentConversationIds,
      parentTurnId: input.parentTurnId,
      resultNodeId: input.resultNodeId,
      sourceNodeId: input.sourceNodeId,
      type: "user",
      content: submittedPrompt.trim(),
      data: {
        model: turnModel,
        contextSnapshot: createAgentContextSnapshot({
          prompt: input.prompt,
          currentNodeContext: input.currentNodeContext?.slice(0, 200_000),
          connectedGraphContext: input.connectedGraphContext?.slice(0, 200_000),
          conversationId: input.conversationId,
          selectedNodeIds: dedupeStrings(input.selectedNodeIds),
          fileDocumentIds: dedupeStrings(input.fileDocumentIds),
          readingAssetIds: dedupeStrings(input.readingAssetIds),
        }),
        parentConversationIds: dedupeStrings(input.parentConversationIds),
        imageCount: input.imageDataUrls?.length ?? 0,
        reasoningEffort: turnReasoningEffort,
        modelSpeed: turnModelSpeed,
        ...(manualCompactInstructions !== undefined || contextUsageRequested || slashCommand ? { uiProjection: true } : {}),
      },
    }, dataDir);
    if (!input.resume && slashCommand) {
      skillInvocationEvent = await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "user",
        content: slashCommand.content,
        data: {
          meta: true,
          skillInvocation: true,
          skill: slashCommand.name,
          source: slashCommand.source,
          allowedTools: slashCommand.allowedTools,
          commandModel: slashCommand.model,
          commandEffort: slashCommand.effort,
          commandShell: slashCommand.shell,
        },
      }, dataDir);
      input = {
        ...input,
        prompt: slashCommand.content,
        model: turnModel,
        reasoningEffort: turnReasoningEffort,
      };
      research = createTurnResearchState();
    }
    const resumedAgentHooks = input.resume && executionId
      ? (await getAgentExecution(input.projectId, executionId, dataDir))?.context.agentHooks
      : undefined;
    const hookSession = await getProjectAgentSession(input.projectId, dataDir);
    const hookRuntimeState = getProjectAgentConversationRuntimeState(hookSession, input.conversationId);
    const consumedHookIds = new Set(hookRuntimeState.consumedHookIds);
    const configuredAgentHooksCandidate = input.resume
      ? resumedAgentHooks
      : await resolveProjectAgentHooksWithConfigChangeRuntime({
          projectId: input.projectId,
          dataDir,
          // ConfigChange has dedicated watcher coverage. Unit Turn runs use
          // ephemeral directories and must not leave native OS watchers alive.
          watchChanges: process.env.NODE_ENV !== "test",
          acceptedCandidate: await loadProjectAgentHooks(input.projectId, dataDir),
          onConfigChange: async (change, acceptedHooks) => {
            if (!acceptedHooks?.ConfigChange?.length) return { blocked: false };
            const configExecution = (await createAgentExecution({
              projectId: input.projectId,
              instruction: `ConfigChange: ${change.source}`,
              resultNodeId: "project-config-change",
              triggerNodeId: "project-config-change",
              permissionMode: modelInfo.permissionMode,
              agentHooks: acceptedHooks,
              allowWithoutWorkspace: true,
            }, dataDir)).detail;
            try {
              const result = await runProjectAgentLifecycleHooks({
                projectId: input.projectId,
                executionId: configExecution.id,
                event: "ConfigChange",
                hooks: acceptedHooks,
                rootId: configExecution.context.workspaceRootId,
                model: input.model,
                reasoningEffort: turnReasoningEffort,
                modelSpeed: turnModelSpeed,
                callModel,
                dataDir,
                payload: { source: change.source, file_path: change.filePath },
                matchQuery: change.source,
              });
              const blocked = result?.permission === "deny" || Boolean(result?.preventContinuation);
              await completeAgentExecution({
                projectId: input.projectId,
                executionId: configExecution.id,
                status: "succeeded",
                resultSummary: blocked ? `ConfigChange 已阻止：${change.filePath}` : `ConfigChange 已接受：${change.filePath}`,
              }, dataDir);
              return { blocked };
            } catch (error) {
              const message = error instanceof Error ? error.message : "ConfigChange Hook 执行失败";
              await failExecutionIfNeeded(input.projectId, configExecution.id, message, dataDir);
              return { blocked: false };
            }
          },
        });
    const configuredAgentHooks = omitConsumedProjectAgentHooks(configuredAgentHooksCandidate, consumedHookIds);
    const persistedSkillHooks = omitConsumedProjectAgentHooks(hookRuntimeState.skillHooks, consumedHookIds);
    let sessionSkillHooks = mergeProjectAgentHooks(persistedSkillHooks, slashCommand?.hooks);
    let activeAgentHooks = input.resume
      ? configuredAgentHooks
      : mergeProjectAgentHooks(configuredAgentHooks, sessionSkillHooks);
    const updateConversationSessionState = async (state: {
      interactionMode?: "default" | "plan";
      activePlan?: string | null;
      permissionMode?: ZenmeSessionPermissionMode;
      skillHooks?: ProjectAgentHooks | null;
      consumedHookIds?: string[];
    }) => {
      if (input.conversationId) {
        await updateProjectAgentConversationContext({
          projectId: input.projectId,
          conversationId: input.conversationId,
          ...state,
        }, dataDir);
        return;
      }
      await updateProjectAgentContext({ projectId: input.projectId, ...state }, dataDir);
    };
    if (slashCommand?.hooks) {
      await updateConversationSessionState({ skillHooks: sessionSkillHooks });
    }
    const registerSkillHooks = async (output: unknown) => {
      if (!isObject(output) || !output.hooks) return;
      const hooks = output.hooks as ProjectAgentHooks;
      sessionSkillHooks = mergeProjectAgentHooks(sessionSkillHooks, hooks);
      activeAgentHooks = mergeProjectAgentHooks(activeAgentHooks, hooks);
      await updateConversationSessionState({ skillHooks: sessionSkillHooks });
      if (executionId) await setAgentExecutionHooks(input.projectId, executionId, activeAgentHooks, dataDir);
    };
    const consumeOnceHook = async (
      event: ProjectAgentHookEvent,
      hook: ProjectAgentHook,
      matcher: ProjectAgentHookMatcher,
    ) => {
      const id = projectAgentHookId(event, matcher, hook);
      if (consumedHookIds.has(id)) return;
      consumedHookIds.add(id);
      sessionSkillHooks = omitConsumedProjectAgentHooks(sessionSkillHooks, consumedHookIds);
      activeAgentHooks = omitConsumedProjectAgentHooks(activeAgentHooks, consumedHookIds);
      await updateConversationSessionState({
        skillHooks: sessionSkillHooks ?? null,
        consumedHookIds: [...consumedHookIds],
      });
      if (executionId) await setAgentExecutionHooks(input.projectId, executionId, activeAgentHooks, dataDir);
    };
    if (!executionId && activeAgentHooks) {
      executionId = (await createAgentExecution({
        projectId: input.projectId,
        instruction: input.prompt,
        resultNodeId: turnId,
        triggerNodeId: turnId,
        canvasContext: input.canvasContext,
        currentNodeContext: input.currentNodeContext,
        connectedGraphContext: input.connectedGraphContext,
        conversationId: input.conversationId,
        selectedNodeIds: input.selectedNodeIds,
        fileDocumentIds: input.fileDocumentIds,
        permissionMode: modelInfo.permissionMode,
        agentHooks: activeAgentHooks,
        allowWithoutWorkspace: true,
      }, dataDir)).detail.id;
    }
    const onAsyncHookRewake = (result: ProjectAgentHookRuntimeResult) => executionId
      ? enqueueAsyncHookRewake({
          projectId: input.projectId,
          turnId,
          executionId,
          prompt: input.prompt,
          model: input.model,
          reasoningEffort: turnReasoningEffort,
          modelSpeed: turnModelSpeed,
          permissionMode: modelInfo.permissionMode,
          result,
          dataDir,
          callModel,
          executeTool,
          listMcpTools,
          callMcpTool,
        })
      : Promise.resolve();
    const onHookFeedback = async (feedback: { additionalContext: string[]; preventContinuation: boolean }) => {
      if (!feedback.additionalContext.length) return;
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "toolResult",
        content: feedback.additionalContext.join("\n\n"),
        data: {
          name: "agent_hook",
          hookLifecycle: true,
          status: feedback.preventContinuation ? "failed" : "succeeded",
          preventContinuation: feedback.preventContinuation,
        },
      }, dataDir);
    };
    const runMainLifecycle = async (
      event: Exclude<ProjectAgentHookEvent, "PreToolUse" | "PostToolUse" | "PostToolUseFailure">,
      payload?: Record<string, unknown>,
      matchQuery?: string,
    ) => {
      if (!activeAgentHooks || !executionId) return undefined;
      const detail = await getAgentExecution(input.projectId, executionId, dataDir);
      const result = await runProjectAgentLifecycleHooks({
        projectId: input.projectId,
        executionId,
        event,
        hooks: activeAgentHooks,
        rootId: detail?.context.workspaceRootId,
        model: input.model,
        reasoningEffort: turnReasoningEffort,
        modelSpeed: turnModelSpeed,
        callModel,
        signal: input.signal,
        onHookSuccess: consumeOnceHook,
        dataDir,
        payload,
        matchQuery,
      });
      if (result?.additionalContext) {
        await onHookFeedback({
          additionalContext: [result.additionalContext],
          preventContinuation: Boolean(result.preventContinuation || result.permission === "deny"),
        });
      }
      return result;
    };
    runMainLifecycleForFailure = runMainLifecycle;
    const onMcpElicitation = async (request: ProjectMcpElicitationRequest): Promise<ElicitResult> => {
      if (!executionId) return { action: "cancel" };
      const params = request.params;
      const mode = params.mode === "url" ? "url" : "form";
      const elicitationId = mcpElicitationId(params);
      const hookPayload = {
        mcp_server_name: request.serverName,
        message: params.message,
        mode,
        ...(mcpElicitationUrl(params) ? { url: mcpElicitationUrl(params) } : {}),
        ...(elicitationId ? { elicitation_id: elicitationId } : {}),
        ...(mcpElicitationSchema(params) ? { requested_schema: mcpElicitationSchema(params) } : {}),
      };
      const before = await runMainLifecycle("Elicitation", hookPayload, request.serverName);
      let response = before?.elicitation;
      if (!response) {
        response = await waitForProjectMcpElicitation({
          projectId: input.projectId,
          turnId,
          executionId,
          request,
          signal: input.signal,
          dataDir,
        });
      }
      const after = await runMainLifecycle("ElicitationResult", {
        mcp_server_name: request.serverName,
        ...(elicitationId ? { elicitation_id: elicitationId } : {}),
        mode,
        action: response.action,
        ...(response.content ? { content: response.content } : {}),
      }, request.serverName);
      const result = after?.elicitation ?? response;
      await dispatchProjectAgentNotificationHook({
        projectId: input.projectId,
        turnId,
        executionId,
        notificationType: "elicitation_response",
        title: request.serverName,
        message: `已向 MCP 服务“${request.serverName}”提交用户响应：${result.action}`,
        dataDir,
        callModel,
      }).catch(() => undefined);
      return result as ElicitResult;
    };
    const onMcpElicitationComplete: ProjectMcpElicitationCompleteHandler = async (completion) => {
      if (!executionId) return;
      await dispatchProjectAgentNotificationHook({
        projectId: input.projectId,
        turnId,
        executionId,
        notificationType: "elicitation_complete",
        title: completion.serverName,
        message: `MCP 服务“${completion.serverName}”已确认授权 ${completion.elicitationId} 完成`,
        dataDir,
        callModel,
      }).catch(() => undefined);
    };
    const onFilesChanged = async (paths: string[]) => {
      for (const relativePath of paths) {
        await runMainLifecycle("FileChanged", { file_path: relativePath }, relativePath);
      }
    };
    const prepareMainCompletion = async (summary: string) => {
      const stop = await runMainLifecycle("Stop", { result: summary });
      if (stop?.permission === "deny" || stop?.preventContinuation) {
        if (!stop.additionalContext && stop.reason) {
          await onHookFeedback({ additionalContext: [stop.reason], preventContinuation: false });
        }
        return false;
      }
      return true;
    };
    if (skillInvocationEvent?.data?.promptShellExpanded === true && skillInvocationEvent.content) {
      input = { ...input, prompt: skillInvocationEvent.content };
      research = createTurnResearchState();
    }
    if (skillInvocationEvent && skillInvocationEvent.data?.promptShellExpanded !== true) {
      const promptShell = skillInvocationEvent.data?.commandShell === "powershell" ? "powershell" : "bash";
      const source = skillInvocationEvent.content ?? "";
      const matches = projectPromptShellMatches(source);
      if (matches.length) {
        if (!executionId) {
          executionId = (await createAgentExecution({
            projectId: input.projectId,
            instruction: source,
            resultNodeId: turnId,
            triggerNodeId: turnId,
            canvasContext: input.canvasContext,
            currentNodeContext: input.currentNodeContext,
            connectedGraphContext: input.connectedGraphContext,
            conversationId: input.conversationId,
            selectedNodeIds: input.selectedNodeIds,
            fileDocumentIds: input.fileDocumentIds,
            permissionMode: modelInfo.permissionMode,
            agentHooks: activeAgentHooks,
            allowWithoutWorkspace: true,
          }, dataDir)).detail.id;
        }
        const outputs: string[] = [];
        for (const match of matches) {
          const session = await getProjectAgentSession(input.projectId, dataDir);
          const completed = [...session.events].reverse().find((event) =>
            event.turnId === turnId && event.type === "toolResult" &&
            event.data?.promptShellIndex === match.index && isAgentCommandRequest(event.data.output));
          const approval = [...session.events].reverse().find((event) =>
            event.turnId === turnId && event.type === "approval" &&
            event.data?.promptShellIndex === match.index && typeof event.data.commandRequestId === "string");
          let output: AgentCommandRequest | undefined;
          if (completed && isAgentCommandRequest(completed.data?.output)) {
            output = completed.data.output;
          } else if (approval) {
            const detail = await getAgentExecution(input.projectId, executionId, dataDir);
            output = detail?.commandRequests.find((command) => command.id === approval.data?.commandRequestId);
            if (!output) throw new ProjectAgentTurnError("Skill 嵌入命令的审批记录已丢失", "tool_failed");
            if (output.status === "proposed" || output.status === "approved" || output.status === "running") {
              await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingApproval" } }, dataDir);
              return { turnId, status: "waitingApproval" as const, executionId, commandRequestId: output.id };
            }
          } else {
            const toolCall = await appendProjectAgentEvent({
              projectId: input.projectId,
              turnId,
              type: "toolCall",
              content: match.command,
              data: {
                status: "running",
                executionId,
                name: "shell_command",
                promptShell: true,
                promptShellIndex: match.index,
                arguments: { command: match.command, shell: promptShell, reason: `展开 Skill 嵌入命令（${match.index + 1}/${matches.length}）` },
              },
            }, dataDir);
            output = await executeTool({
              projectId: input.projectId,
              executionId,
              additionalAllowedTools: [...turnAdditionalAllowedTools],
              name: "shell_command",
              arguments: {
                command: match.command,
                shell: promptShell,
                reason: `展开 Skill 嵌入命令（${match.index + 1}/${matches.length}）`,
              },
              signal: input.signal,
              foregroundBudgetMs: 300_000,
              turnId,
              delegatedCallModel: callModel,
              delegatedModel: input.model,
              delegatedReasoningEffort: turnReasoningEffort,
              delegatedModelSpeed: turnModelSpeed,
              onAsyncHookRewake,
              onHookFeedback,
              onHookSuccess: consumeOnceHook,
              onCommandProgress: async (progress) => {
                await updateProjectAgentEvent({
                  projectId: input.projectId,
                  eventId: toolCall.id,
                  content: formatCommandProgress(progress.stdout, progress.stderr),
                  data: { elapsedMs: progress.elapsedMs },
                }, dataDir);
              },
            }, dataDir) as AgentCommandRequest;
            if (output.status === "proposed") {
              await appendProjectAgentEvent({
                projectId: input.projectId,
                turnId,
                type: "approval",
                content: output.reason,
                data: {
                  status: "pending",
                  executionId,
                  commandRequestId: output.id,
                  command: output.command,
                  executable: output.executable,
                  args: output.args,
                  cwd: output.cwd,
                  rootId: output.rootId,
                  externalRoot: output.externalRoot,
                  sandboxMode: output.sandboxMode,
                  promptShell: true,
                  promptShellIndex: match.index,
                },
              }, dataDir);
              await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingApproval" } }, dataDir);
              return { turnId, status: "waitingApproval" as const, executionId, commandRequestId: output.id };
            }
            await appendProjectAgentEvent({
              projectId: input.projectId,
              turnId,
              type: "toolResult",
              content: formatProjectPromptShellOutput(output) || "命令执行完成",
              data: {
                status: output.status === "succeeded" ? "succeeded" : "failed",
                executionId,
                toolCallEventId: toolCall.id,
                name: "shell_command",
                output,
                promptShell: true,
                promptShellIndex: match.index,
              },
            }, dataDir);
          }
          if (output.status !== "succeeded") {
            throw new ProjectAgentTurnError(projectPromptShellFailure(output, match.pattern), "tool_failed");
          }
          outputs.push(formatProjectPromptShellOutput(output));
        }
        const expanded = substituteProjectPromptShellOutputs(source, matches, outputs);
        skillInvocationEvent = await updateProjectAgentEvent({
          projectId: input.projectId,
          eventId: skillInvocationEvent.id,
          content: expanded,
          data: { promptShellExpanded: true, commandShell: promptShell },
        }, dataDir);
        input = { ...input, prompt: expanded };
        research = createTurnResearchState();
      } else {
        skillInvocationEvent = await updateProjectAgentEvent({
          projectId: input.projectId,
          eventId: skillInvocationEvent.id,
          data: { promptShellExpanded: true },
        }, dataDir);
      }
    }
    if (contextUsageRequested) {
      const session = await getProjectAgentSession(input.projectId, dataDir);
      const modelContext = await getProjectAgentModelContext(input.projectId, dataDir, input.conversationId);
      const effectiveTokens = input.conversationId
        ? modelContext.estimatedConversationTokens
        : Math.max(session.context.inputTokens, modelContext.estimatedTokens);
      const conversation = input.conversationId
        ? session.conversations?.find((candidate) => candidate.id === input.conversationId)
        : undefined;
      const projectedConversationEvents = input.conversationId
        ? projectConversationEvents(modelContext.events, input.conversationId, {
            compactedThroughSequence: modelContext.conversationCompactedThroughSequence,
          })
        : modelContext.events;
      const budget = calculateProjectAgentContextBudget(modelInfo.contextWindow);
      const answer = formatContextUsage({
        scope: input.conversationId ? "conversation" : "project",
        model: input.model,
        contextWindow: modelInfo.contextWindow,
        effectiveTokens,
        estimatedProjectionTokens: input.conversationId
          ? modelContext.estimatedConversationTokens
          : modelContext.estimatedTokens,
        providerReportedInputTokens: session.context.inputTokens,
        compactAtTokens: budget.compactAtTokens,
        reservedOutputTokens: budget.reservedOutputTokens,
        compactBufferTokens: budget.compactBufferTokens,
        checkpointCount: input.conversationId
          ? session.events.filter((event) =>
              event.conversationId === input.conversationId &&
              event.type === "compact" && event.data?.scope === "conversation"
            ).length
          : session.compactCheckpoints.length,
        hasActiveSummary: input.conversationId
          ? Boolean(conversation?.summary)
          : Boolean(session.context.activeSummary),
        activeEventCount: projectedConversationEvents.length,
        microcompactTokensSaved: modelContext.microcompactTokensSaved,
      });
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
      await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
      return { turnId, status: "completed" as const, answer, executionId };
    }
    const setupTrigger = !input.resume ? projectSetupTrigger(input.prompt) : undefined;
    if (setupTrigger) {
      const setup = await runMainLifecycle("Setup", { trigger: setupTrigger }, setupTrigger);
      if (setup?.permission === "deny" || setup?.preventContinuation) {
        throw new ProjectAgentTurnError(setup.reason || `Setup Hook（${setupTrigger}）已阻止执行`, "tool_failed");
      }
      const answer = activeAgentHooks?.Setup?.length
        ? `Project Setup（${setupTrigger}）Hook 已执行。`
        : `当前 Project 未配置 Setup（${setupTrigger}）Hook。`;
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
      await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
      return { turnId, status: "completed" as const, answer, executionId };
    }
    if (manualCompactInstructions !== undefined) {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "status",
        data: { stage: "planning" },
      }, dataDir);
      const compacted = await compactBeforeTurnIfNeeded({
        projectId: input.projectId,
        conversationId: input.conversationId,
        model: input.model,
        contextWindow: modelInfo.contextWindow,
        callModel,
        signal: input.signal,
        turnId,
        executionId,
        hooks: activeAgentHooks,
        reasoningEffort: turnReasoningEffort,
        modelSpeed: turnModelSpeed,
        trigger: "manual",
        customInstructions: manualCompactInstructions,
      }, dataDir);
      let answer: string;
      if (compacted.status === "compacted") {
        const sessionStart = await runMainLifecycle(
          "SessionStart",
          { source: "compact", trigger: "manual" },
          "compact",
        );
        if (sessionStart?.permission === "deny" || sessionStart?.preventContinuation) {
          throw new ProjectAgentTurnError(
            sessionStart.reason || "压缩后的 SessionStart Hook 已阻止继续",
            "tool_failed",
          );
        }
        answer = "上下文已压缩，后续对话将基于整理后的摘要继续。";
      } else if (compacted.status === "not_needed") {
        answer = "当前上下文还没有足够的历史内容可压缩。";
      } else {
        answer = "上下文压缩失败，请重试。";
      }
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
      await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
      return { turnId, status: "completed" as const, answer, executionId };
    }
    if (!input.resume) {
      const sessionStart = await runMainLifecycle("SessionStart", { instruction: input.prompt });
      if (sessionStart?.permission === "deny" || sessionStart?.preventContinuation) {
        throw new ProjectAgentTurnError(sessionStart.reason || "SessionStart Hook 已阻止 Agent 启动", "tool_failed");
      }
      const promptHook = await runMainLifecycle("UserPromptSubmit", { prompt: input.prompt });
      if (promptHook?.permission === "deny" || promptHook?.preventContinuation) {
        throw new ProjectAgentTurnError(promptHook.reason || "UserPromptSubmit Hook 已阻止本次请求", "tool_failed");
      }
    }
    if (!input.resume && slashCommand?.executionContext === "fork") {
      if (!executionId) {
        executionId = (await createAgentExecution({
          projectId: input.projectId,
          instruction: slashCommand.content,
          resultNodeId: turnId,
          triggerNodeId: turnId,
          canvasContext: input.canvasContext,
          currentNodeContext: input.currentNodeContext,
          connectedGraphContext: input.connectedGraphContext,
          conversationId: input.conversationId,
          selectedNodeIds: input.selectedNodeIds,
          fileDocumentIds: input.fileDocumentIds,
          permissionMode: modelInfo.permissionMode,
          agentHooks: activeAgentHooks,
          allowWithoutWorkspace: true,
        }, dataDir)).detail.id;
      }
      const toolCall = await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "toolCall",
        data: {
          status: "running",
          executionId,
          name: "skill",
          arguments: { skill: slashCommand.name, args: slashCommand.invocationArgs, invokedBy: "user" },
          forked: true,
        },
      }, dataDir);
      const output = await executeTool({
        projectId: input.projectId,
        executionId,
        additionalAllowedTools: [...turnAdditionalAllowedTools],
        name: "skill",
        arguments: { skill: slashCommand.name, args: slashCommand.invocationArgs, invokedBy: "user" },
        signal: input.signal,
        turnId,
        delegatedCallModel: callModel,
        delegatedModel: input.model,
        delegatedReasoningEffort: turnReasoningEffort,
        delegatedModelSpeed: turnModelSpeed,
        onHookSuccess: consumeOnceHook,
      }, dataDir);
      await registerSkillHooks(output);
      const pending = delegatedPendingApproval(output);
      if (pending) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "approval",
          content: pending.command.reason,
          data: {
            status: "pending",
            executionId: pending.executionId,
            commandRequestId: pending.command.id,
            command: pending.command.command,
            executable: pending.command.executable,
            args: pending.command.args,
            cwd: pending.command.cwd,
            externalRoot: pending.command.externalRoot,
            sandboxMode: pending.command.sandboxMode,
            orchestrationId: isObject(output) ? output.orchestrationId : undefined,
          },
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: pending.command.reason,
          data: { status: "waitingApproval", executionId, toolCallEventId: toolCall.id, name: "skill", output, forked: true },
        }, dataDir);
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingApproval" } }, dataDir);
        return {
          turnId,
          status: "waitingApproval" as const,
          executionId: pending.executionId,
          commandRequestId: pending.command.id,
        };
      }
      const answer = isObject(output) && typeof output.result === "string"
        ? output.result
        : "Skill execution completed";
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "toolResult",
        content: answer,
        data: { status: "succeeded", executionId, toolCallEventId: toolCall.id, name: "skill", output, forked: true },
      }, dataDir);
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
      await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
      await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
      return { turnId, status: "completed" as const, answer, executionId };
    }
    await drainProjectAgentQueuedMessages(input.projectId, turnId, dataDir);
    await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "planning" } }, dataDir);
    await updateProjectAgentContext({
      projectId: input.projectId,
      modelId: input.model,
      contextWindowTokens: modelInfo.contextWindow,
    }, dataDir);
    await updateConversationSessionState({ permissionMode: modelInfo.permissionMode });
    if (input.resume) {
      const resumeSession = await getProjectAgentSession(input.projectId, dataDir);
      const pendingSkillPromptResult = [...resumeSession.events].reverse().find((event) =>
        event.turnId === turnId && event.type === "toolResult" && event.data?.name === "skill" &&
        Boolean(skillPromptShellPendingApproval(event.data.output)) &&
        !resumeSession.events.some((candidate) => candidate.data?.promptShellResumeFor === event.id));
      if (pendingSkillPromptResult && isObject(pendingSkillPromptResult.data?.output)) {
        const priorOutput = pendingSkillPromptResult.data.output as AgentWorkspaceToolResult["skill"];
        const parentExecutionId = typeof pendingSkillPromptResult.data?.executionId === "string"
          ? pendingSkillPromptResult.data.executionId
          : priorOutput.promptShellState?.executionId;
        if (!parentExecutionId) throw new ProjectAgentTurnError("Skill 嵌入命令缺少父执行记录", "tool_failed");
        executionId = parentExecutionId;
        const toolCall = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolCall",
          data: {
            status: "running",
            executionId,
            name: "skill",
            arguments: { skill: priorOutput.name, resumePromptShell: true },
            promptShellResumeFor: pendingSkillPromptResult.id,
          },
        }, dataDir);
        const resumedOutput = await continueProjectSkillPromptShell({
          projectId: input.projectId,
          executionId,
          loaded: priorOutput,
          additionalAllowedTools: [...turnAdditionalAllowedTools],
          delegatedCallModel: callModel,
          delegatedModel: input.model,
          delegatedReasoningEffort: turnReasoningEffort,
          delegatedModelSpeed: turnModelSpeed,
          signal: input.signal,
          turnId,
          onAsyncHookRewake,
          onHookFeedback,
          onHookSuccess: consumeOnceHook,
          onCommandProgress: async (progress) => {
            await updateProjectAgentEvent({
              projectId: input.projectId,
              eventId: toolCall.id,
              content: formatCommandProgress(progress.stdout, progress.stderr),
              data: { elapsedMs: progress.elapsedMs },
            }, dataDir);
          },
        }, dataDir);
        await registerSkillHooks(resumedOutput);
        mergeSkillAllowedTools(turnAdditionalAllowedTools, resumedOutput);
        await updateProjectAgentEvent({
          projectId: input.projectId,
          eventId: pendingSkillPromptResult.id,
          data: { modelProjectionExcluded: true, status: "resumed" },
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: summarizeToolResult("skill", resumedOutput),
          data: {
            status: skillPromptShellPendingApproval(resumedOutput) ? "waitingApproval" : "succeeded",
            executionId,
            toolCallEventId: toolCall.id,
            name: "skill",
            output: resumedOutput,
            promptShellResumeFor: pendingSkillPromptResult.id,
          },
        }, dataDir);
        const promptPending = skillPromptShellPendingApproval(resumedOutput);
        if (promptPending) {
          const latest = await getProjectAgentSession(input.projectId, dataDir);
          if (!latest.events.some((event) => event.turnId === turnId && event.type === "approval" &&
            event.data?.commandRequestId === promptPending.command.id)) {
            await appendProjectAgentEvent({
              projectId: input.projectId,
              turnId,
              type: "approval",
              content: promptPending.command.reason,
              data: {
                status: "pending",
                executionId: promptPending.executionId,
                commandRequestId: promptPending.command.id,
                command: promptPending.command.command,
                executable: promptPending.command.executable,
                args: promptPending.command.args,
                cwd: promptPending.command.cwd,
                rootId: promptPending.command.rootId,
                externalRoot: promptPending.command.externalRoot,
                sandboxMode: promptPending.command.sandboxMode,
              },
            }, dataDir);
          }
          await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingApproval" } }, dataDir);
          return { turnId, status: "waitingApproval" as const, executionId: promptPending.executionId, commandRequestId: promptPending.command.id };
        }
      }
      const delegatedResume = await resumeDelegatedOrchestrationForTurn({
        projectId: input.projectId,
        turnId,
        model: input.model,
        signal: input.signal,
        callModel,
        reasoningEffort: turnReasoningEffort,
        modelSpeed: turnModelSpeed,
        dataDir,
      });
      executionId = delegatedResume.parentExecutionId ?? executionId;
      if (delegatedResume.pendingApproval) {
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingApproval" } }, dataDir);
        return {
          turnId,
          status: "waitingApproval" as const,
          executionId: delegatedResume.pendingApproval.executionId,
          commandRequestId: delegatedResume.pendingApproval.command.id,
        };
      }
      if (delegatedResume.forkedSkillAnswer !== undefined) {
        const answer = delegatedResume.forkedSkillAnswer;
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
        await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
        return { turnId, status: "completed" as const, answer, executionId };
      }
    }
    const automaticCompaction = await compactBeforeTurnIfNeeded({
      projectId: input.projectId,
      conversationId: input.conversationId,
      model: input.model,
      contextWindow: modelInfo.contextWindow,
      callModel,
      signal: input.signal,
      turnId,
      executionId,
      hooks: activeAgentHooks,
      reasoningEffort: turnReasoningEffort,
      modelSpeed: turnModelSpeed,
    }, dataDir);
    if (automaticCompaction.status === "compacted") {
      const compactSessionStart = await runMainLifecycle(
        "SessionStart",
        { source: "compact", trigger: "auto" },
        "compact",
      );
      if (compactSessionStart?.permission === "deny" || compactSessionStart?.preventContinuation) {
        throw new ProjectAgentTurnError(
          compactSessionStart.reason || "压缩后的 SessionStart Hook 已阻止继续",
          "tool_failed",
        );
      }
    }

    const retrievalQuery = buildAgentRetrievalQuery({
      instruction: input.prompt,
      currentNodeContext: input.currentNodeContext,
    });
    const memories = await getRelevantConfirmedMemoryContext({
      projectId: input.projectId,
      query: retrievalQuery,
      limit: 5,
      budgetCharacters: 20_000,
    }, dataDir).catch(() => []);
    const relevantKnowledge = await searchProjectKnowledge({
      projectId: input.projectId,
      query: retrievalQuery,
      limit: 8,
      budgetCharacters: 16_000,
    }, dataDir).then((response) => response.results).catch(() => []);
    const availableSkills = await listProjectSkills(input.projectId, dataDir).catch(() => []);
    const availableAgents = await listProjectAgentDefinitions(input.projectId, dataDir).catch(() => []);
    const activeOutputStyle = await loadActiveProjectOutputStyle(input.projectId, dataDir).catch(() => null);
    const acceptedContinuousSuggestions = await getAcceptedContinuousAgentSuggestions(input.projectId, dataDir).catch(() => []);
    const projectPermissionRules = await loadProjectPermissionRules(input.projectId, dataDir);
    const mcpDiscovery = await listMcpTools(input.projectId, dataDir, undefined, {
      connectionScope: executionId,
    }).catch(() => ({ tools: [], failures: [] }));
    const activeMcpToolNames = restoreActiveMcpToolNames(
      (await getProjectAgentSession(input.projectId, dataDir)).events,
      turnId,
      mcpDiscovery.tools,
    );
    const activeBuiltInToolNames = restoreActiveBuiltInToolNames(
      (await getProjectAgentSession(input.projectId, dataDir)).events,
      turnId,
    );
    if (mcpDiscovery.failures.length > 0) {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "thinking",
        content: `部分 MCP 服务不可用：${mcpDiscovery.failures.map((failure) => `${failure.serverName}（${failure.error}）`).join("；")}`,
        data: { stage: "mcpDiscovery", failures: mcpDiscovery.failures },
      }, dataDir);
    }
    const pendingNativeDecisions: ProjectTurnDecision[] = [
      ...(approvedBrowserAction ? [{ type: "tool" as const, name: "browser" as const, arguments: approvedBrowserAction }] : []),
      ...(approvedWorkflowAction ? [{ type: "tool" as const, name: "workflow" as const, arguments: approvedWorkflowAction }] : []),
      ...(approvedMcpAction ? [{ type: "tool" as const, name: approvedMcpAction.name, arguments: approvedMcpAction.arguments }] : []),
    ];
    const observedImageCache = new Map<string, string>();
    let browserScreenshot: string | undefined;
    const recordAutoApprovedShell = async (output: unknown) => {
      if (modelInfo.permissionMode !== "onRequest" || !isObject(output) || typeof output.id !== "string" || !executionId) return;
      const detail = await getAgentExecution(input.projectId, executionId, dataDir);
      const command = detail?.commandRequests.find((candidate) => candidate.id === output.id);
      if (!command || command.status === "proposed" || !command.approvalScope) return;
      const session = await getProjectAgentSession(input.projectId, dataDir);
      const alreadyRecorded = session.events.some((event) =>
        event.turnId === turnId && event.type === "approval" && event.data?.commandRequestId === command.id);
      if (alreadyRecorded) return;
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "approval",
        content: command.reason,
        data: {
          status: "autoApproved",
          executionId,
          commandRequestId: command.id,
          command: command.command,
          executable: command.executable,
          args: command.args,
          cwd: command.cwd,
          rootId: command.rootId,
          externalRoot: command.externalRoot,
          sandboxMode: command.sandboxMode,
          approvalScope: command.approvalScope,
        },
      }, dataDir);
    };
    const recordStreamedToolEffects = async (finalized: FinalizedStreamedToolOutcome[]) => {
      for (const { outcome, output } of finalized) {
        const { decision } = outcome;
        if (decision.name === "tool_search" && isObject(output) && Array.isArray(output.tools)) {
          const availableMcpNames = new Set(mcpDiscovery.tools.map((tool) => tool.name));
          for (const tool of output.tools) {
            if (!isObject(tool) || typeof tool.name !== "string") continue;
            if (DEFERRED_MODEL_AGENT_TOOL_NAMES.has(tool.name as AgentWorkspaceToolName)) {
              activeBuiltInToolNames.add(tool.name as AgentWorkspaceToolName);
            }
            if (availableMcpNames.has(tool.name as McpToolName)) activeMcpToolNames.add(tool.name);
          }
        }
        if (decision.name === "skill") {
          mergeSkillAllowedTools(turnAdditionalAllowedTools, output);
          await registerSkillHooks(output);
        }
        if (decision.name === "enter_plan_mode") {
          await updateConversationSessionState({
            interactionMode: "plan",
            activePlan: null,
          });
        }
        if (decision.name === "exit_plan_mode" && isObject(output) && typeof output.plan === "string") {
          await updateConversationSessionState({ activePlan: output.plan });
        }
        if (decision.name === "agent_spawn" && isObject(output) && output.background === true &&
          typeof output.teamId === "string" && typeof output.agentId === "string" && executionId) {
          scheduleSubagentSettlement({
            projectId: input.projectId,
            turnId,
            executionId,
            teamId: output.teamId,
            agentId: output.agentId,
            name: typeof output.name === "string" ? output.name : output.agentId,
            dataDir,
            callModel,
          });
        }
        if (decision.name === "send_message" && isObject(output) &&
          typeof output.teamId === "string" && Array.isArray(output.reactivatedAgentIds) && executionId) {
          const agentIds = output.reactivatedAgentIds.filter((value): value is string => typeof value === "string");
          const deliveredAgentIds = Array.isArray(output.agentIds)
            ? output.agentIds.filter((value): value is string => typeof value === "string")
            : [];
          const recipientNames = Array.isArray(output.recipients)
            ? output.recipients.filter((value): value is string => typeof value === "string")
            : [];
          const recipientNameByAgentId = new Map(
            deliveredAgentIds.map((agentId, index) => [agentId, recipientNames[index] ?? agentId]),
          );
          for (const agentId of agentIds) {
            scheduleSubagentSettlement({
              projectId: input.projectId,
              turnId,
              executionId,
              teamId: output.teamId,
              agentId,
              name: recipientNameByAgentId.get(agentId) ?? agentId,
              dataDir,
              callModel,
            });
          }
        }
        if (decision.name === "web_fetch") {
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "thinking",
            content: "正在基于已读取的网页正文归纳、去重并形成回答。",
          }, dataDir);
        }
        if (decision.name === "browser") {
          browserScreenshot = browserScreenshotDataUrl(output) ?? browserScreenshot;
        }
        if (decision.name === "shell_command") await recordAutoApprovedShell(output);
        if (!isMcpToolName(decision.name)) {
          updateTurnResearchState(research, decision.name, decision.arguments, output);
        }
      }
    };
    const streamedWaitingInputResult = async (finalized: FinalizedStreamedToolOutcome[]) => {
      const waiting = finalized.find(({ outcome }) =>
        outcome.decision.name === "ask_user_question" || outcome.decision.name === "exit_plan_mode");
      if (!waiting || !isObject(waiting.output) || typeof waiting.output.question !== "string") return null;
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "status",
        data: { stage: "waitingInput" },
      }, dataDir);
      return {
        turnId,
        status: "waitingInput" as const,
        question: waiting.output.question,
        options: Array.isArray(waiting.output.options) ? waiting.output.options : undefined,
        executionId,
      };
    };
    const streamedWaitingApprovalResult = async (finalized: FinalizedStreamedToolOutcome[]) => {
      const waiting = finalized.find(({ outcome, output }) =>
        (outcome.decision.name === "shell_command" && isAgentCommandRequest(output) && output.status === "proposed") ||
        (["delegate_tasks", "skill"].includes(outcome.decision.name) &&
          Boolean(skillPromptShellPendingApproval(output) ?? delegatedPendingApproval(output))));
      if (!waiting) return null;
      const pending = ["delegate_tasks", "skill"].includes(waiting.outcome.decision.name)
        ? skillPromptShellPendingApproval(waiting.output) ?? delegatedPendingApproval(waiting.output)
        : isAgentCommandRequest(waiting.output) && waiting.output.status === "proposed"
          ? { executionId: executionId ?? "", command: waiting.output }
          : null;
      if (!pending) return null;
      if (["delegate_tasks", "skill"].includes(waiting.outcome.decision.name)) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "approval",
          content: pending.command.reason,
          data: {
            status: "pending",
            executionId: pending.executionId,
            commandRequestId: pending.command.id,
            command: pending.command.command,
            executable: pending.command.executable,
            args: pending.command.args,
            cwd: pending.command.cwd,
            externalRoot: pending.command.externalRoot,
            sandboxMode: pending.command.sandboxMode,
            orchestrationId: isObject(waiting.output) ? waiting.output.orchestrationId : undefined,
          },
        }, dataDir);
      }
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "status",
        data: { stage: "waitingApproval" },
      }, dataDir);
      return {
        turnId,
        status: "waitingApproval" as const,
        executionId: pending.executionId || executionId,
        commandRequestId: pending.command.id,
      };
    };

    let maxOutputTokensOverride: number | undefined;
    let maxOutputTokensRecoveryCount = 0;
    let maxOutputTokensRecoveryInstruction: string | undefined;

    for (let iteration = 0; iteration < maxTurns; iteration += 1) {
      const activeJob = runtime.jobs.get(projectRuntimeKey);
      await activeJob?.pendingSteering;
      await drainProjectAgentQueuedMessages(input.projectId, turnId, dataDir);
      const steeringRevision = activeJob?.steeringRevision ?? 0;
      const pendingNativeDecision = pendingNativeDecisions.shift() ?? null;
      const browserActionApprovedForIteration = Boolean(
        approvedBrowserAction && pendingNativeDecision?.type === "tool" && pendingNativeDecision.name === "browser" &&
        JSON.stringify(pendingNativeDecision.arguments) === JSON.stringify(approvedBrowserAction),
      );
      if (browserActionApprovedForIteration) approvedBrowserAction = undefined;
      const workflowActionApprovedForIteration = Boolean(
        approvedWorkflowAction && pendingNativeDecision?.type === "tool" && pendingNativeDecision.name === "workflow" &&
        JSON.stringify(pendingNativeDecision.arguments) === JSON.stringify(approvedWorkflowAction),
      );
      if (workflowActionApprovedForIteration) approvedWorkflowAction = undefined;
      const mcpActionApprovedForIteration = Boolean(
        approvedMcpAction && pendingNativeDecision?.type === "tool" &&
        pendingNativeDecision.name === approvedMcpAction.name &&
        JSON.stringify(pendingNativeDecision.arguments) === JSON.stringify(approvedMcpAction.arguments),
      );
      if (mcpActionApprovedForIteration) approvedMcpAction = undefined;
      let modelContext = await getProjectAgentModelContext(input.projectId, dataDir, input.conversationId);
      if (modelContext.newlyClearedToolResultEventIds.length) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          conversationId: input.conversationId,
          type: "compact",
          content: `已清理 ${modelContext.newlyClearedToolResultEventIds.length} 个旧工具结果`,
          data: {
            kind: "microcompact",
            clearedToolResultEventIds: modelContext.newlyClearedToolResultEventIds,
            sourceTokenEstimate: modelContext.newMicrocompactTokensSaved,
          },
        }, dataDir);
        modelContext = await getProjectAgentModelContext(input.projectId, dataDir, input.conversationId);
      }
      const workspaceBinding = await getLocalWorkspaceBinding(input.projectId, dataDir);
      const projectInstructions = await loadProjectAgentInstructions({
        projectId: input.projectId,
        targetPaths: extractProjectInstructionTargetPaths(
          modelContext.events.flatMap((event) => event.data?.arguments ? [event.data.arguments] : []),
        ),
      }, dataDir).catch(() => []);
      for (const instruction of projectInstructions) {
        const identity = `${instruction.rootId}\u0000${instruction.relativePath}`;
        if (loadedInstructionPaths.has(identity)) continue;
        loadedInstructionPaths.add(identity);
        await runMainLifecycle("InstructionsLoaded", {
          file_path: instruction.relativePath,
          root_id: instruction.rootId,
        }, instruction.relativePath);
      }
      let response: ProjectAgentModelResponse | null = null;
      let answerDraftReporter: ReturnType<typeof createTurnAnswerDraftReporter> | null = null;
      let streamedToolExecutor: StreamingToolExecutor<StreamedToolOutcome> | null = null;
      if (!pendingNativeDecision) {
        const planMode = modelContext.interactionMode === "plan";
        const activeMcpTools = mcpDiscovery.tools.filter((tool) =>
          activeMcpToolNames.has(tool.name) && (!planMode || tool.readOnly) &&
          !isProjectToolBlanketDenied(tool.name, projectPermissionRules),
        );
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "status",
          data: { stage: "thinking" },
        }, dataDir);
        const thinkingReporter = createTurnThinkingReporter({
          dataDir,
          projectId: input.projectId,
          turnId,
        });
        answerDraftReporter = createTurnAnswerDraftReporter({
          dataDir,
          projectId: input.projectId,
          turnId,
        });
        let interruptedBySteering = false;
        let reactivelyCompacted = false;
        let recoveringMaxOutputTokens = false;
        const modelStep = beginProjectTurnStep(projectRuntimeKey, input.signal, "cancel");
        streamedToolExecutor = new StreamingToolExecutor<StreamedToolOutcome>(modelStep.signal);
        let streamedExecution: Promise<string> | null = null;
        const ensureStreamedExecution = () => {
          if (executionId) return Promise.resolve(executionId);
          streamedExecution ??= createAgentExecution({
            projectId: input.projectId,
            instruction: input.prompt,
            resultNodeId: turnId,
            triggerNodeId: turnId,
            canvasContext: input.canvasContext,
            currentNodeContext: input.currentNodeContext,
            connectedGraphContext: input.connectedGraphContext,
            conversationId: input.conversationId,
            selectedNodeIds: input.selectedNodeIds,
            fileDocumentIds: input.fileDocumentIds,
            permissionMode: modelInfo.permissionMode,
            allowWithoutWorkspace: true,
          }, dataDir).then(({ detail }) => {
            executionId ??= detail.id;
            return executionId;
          });
          return streamedExecution;
        };
        try {
          const observedImages = await collectTurnWorkspaceImages({
            projectId: input.projectId,
            events: modelContext.events,
            cache: observedImageCache,
            dataDir,
          });
          response = await callModel({
            context: [
              buildTurnContext(modelContext, memories, relevantKnowledge, input.canvasContext, modelInfo.permissionMode, [], availableSkills, availableAgents, projectInstructions, workspaceBinding, acceptedContinuousSuggestions, activeOutputStyle?.prompt, input.currentNodeContext, input.connectedGraphContext),
              formatMcpToolContext(mcpDiscovery.tools, activeMcpTools),
            ].filter(Boolean).join("\n\n"),
            imageDataUrls: mergeModelImageDataUrls(input.imageDataUrls, [
              ...observedImages,
              ...(browserScreenshot ? [browserScreenshot] : []),
            ]),
            fileAttachments: readingFileAttachments,
            model: input.model,
            messages: [
              ...projectAgentTranscript(projectConversationEvents(modelContext.events, input.conversationId, {
                compactedThroughSequence: modelContext.conversationCompactedThroughSequence,
              })),
              ...(maxOutputTokensRecoveryInstruction
                ? [{ role: "user" as const, content: maxOutputTokensRecoveryInstruction }]
                : []),
            ],
            prompt: buildTurnInstruction(
              input.prompt,
              research,
            ),
            signal: modelStep.signal,
            thinkingEnabled: modelInfo.thinkingEnabled,
            reasoningEffort: turnReasoningEffort,
            modelSpeed: turnModelSpeed,
            maxOutputTokens: maxOutputTokensOverride,
            onThinkingDelta: thinkingReporter.push,
            onTextDelta: answerDraftReporter.push,
            onTransientRetry: async ({ attempt, maxAttempts, delayMs }) => {
              await appendProjectAgentEvent({
                projectId: input.projectId,
                turnId,
                type: "thinking",
                content: `模型服务暂时繁忙，正在自动重试（${attempt}/${maxAttempts - 1}）${delayMs ? `，等待 ${Math.max(1, Math.ceil(delayMs / 1_000))} 秒` : ""}。`,
              }, dataDir);
            },
            onToolCallComplete: (toolCall, index) => {
              const decision = projectTurnDecisionFromNativeToolCall(toolCall, activeMcpTools);
              if (decision?.type !== "tool") return;
              const signature = streamedToolSignature(toolCall);
              if (isMcpToolName(decision.name)) {
                const mcpTool = activeMcpTools.find((tool) => tool.name === decision.name);
                if (!mcpTool) return;
                const permission = evaluateProjectToolPermission({
                  name: decision.name,
                  content: JSON.stringify(decision.arguments),
                  rules: projectPermissionRules,
                });
                // Ask/deny decisions must use the serialized native path so
                // execution cannot race ahead of the approval UI.
                // Configured hooks also use that path because PreToolUse may
                // rewrite input or request approval before execution starts.
                if (permission === "ask" || permission === "deny" || activeAgentHooks) return;
                streamedToolExecutor?.add({
                  index,
                  signature,
                  concurrencySafe: mcpTool.readOnly,
                  interruptBehavior: mcpTool.readOnly ? "cancel" : "block",
                  run: async (signal): Promise<StreamedToolOutcome> => {
                    const streamedExecutionId = await ensureStreamedExecution();
                    const event = await appendProjectAgentEvent({
                      projectId: input.projectId,
                      turnId,
                      type: "toolCall",
                      data: { status: "running", executionId: streamedExecutionId, name: decision.name, arguments: decision.arguments, streamed: true },
                    }, dataDir);
                    try {
                      const output = (await executeAgentToolPipeline({
                        projectId: input.projectId,
                        executionId: streamedExecutionId,
                        name: decision.name,
                        arguments: decision.arguments,
                        validate: () => true,
                        execute: () => callMcpTool({
                          projectId: input.projectId,
                          name: decision.name as McpToolName,
                          arguments: decision.arguments,
                          signal,
                          connectionScope: streamedExecutionId,
                          onElicitation: onMcpElicitation,
                          onElicitationComplete: onMcpElicitationComplete,
                        }, dataDir),
                      }, dataDir)).output;
                      return { decision, event, output };
                    } catch (error) {
                      return { decision, event, error: error instanceof Error ? error.message : "MCP 工具执行失败" };
                    }
                  },
                });
                return;
              }
              const definition = getAgentToolDefinition(decision.name);
              const streamableShell = decision.name === "shell_command";
              const streamableExclusiveTool = STREAMABLE_EXCLUSIVE_TOOLS.has(decision.name);
              const concurrencySafe = definition?.isConcurrencySafe(
                decision.arguments as AgentWorkspaceToolArguments[AgentWorkspaceToolName],
              ) === true;
              if (modelContext.interactionMode === "plan" && !isPlanModeToolAllowed(decision.name, activeMcpTools)) return;
              if (decision.name === "enter_plan_mode" && modelContext.interactionMode === "plan") return;
              if (decision.name === "exit_plan_mode" && modelContext.interactionMode !== "plan") return;
              if (decision.name === "browser" && modelInfo.permissionMode === "untrusted" && isBrowserInteraction(decision.arguments)) return;
              if (!streamableExclusiveTool && !streamableShell && definition?.permission !== "read") return;
              if (!streamableExclusiveTool && !concurrencySafe) return;
              const streamedDecision = { ...decision, name: decision.name as AgentWorkspaceToolName } satisfies WorkspaceToolDecision;
              streamedToolExecutor?.add({
                index,
                signature,
                concurrencySafe,
                interruptBehavior: streamableShell && concurrencySafe
                  ? "cancel"
                  : definition?.interruptBehavior ?? "block",
                run: async (signal): Promise<StreamedToolOutcome> => {
                  const streamedExecutionId = await ensureStreamedExecution();
                  let modelFacingOutput: unknown;
                  const event = await appendProjectAgentEvent({
                    projectId: input.projectId,
                    turnId,
                    type: "toolCall",
                    data: { status: "running", executionId: streamedExecutionId, name: streamedDecision.name, arguments: streamedDecision.arguments, streamed: true },
                  }, dataDir);
                  try {
                    const streamedArguments = ["web_fetch", "delegate_tasks", "agent_spawn", "send_message"].includes(streamedDecision.name)
                      ? { ...streamedDecision.arguments, model: input.model }
                      : streamedDecision.arguments;
                    const deferredToolSearchResults = streamedDecision.name === "tool_search"
                      ? searchProjectMcpTools(
                          mcpDiscovery.tools,
                          (streamedArguments as AgentWorkspaceToolArguments["tool_search"]).query,
                          (streamedArguments as AgentWorkspaceToolArguments["tool_search"]).maxResults,
                        )
                      : undefined;
                    const rawOutput = await executeTool({
                      projectId: input.projectId,
                      executionId: streamedExecutionId,
                      additionalAllowedTools: [...turnAdditionalAllowedTools],
                      name: streamedDecision.name,
                      arguments: streamedArguments as never,
                      deferredToolSearchResults,
                      signal,
                      turnId,
                      delegatedCallModel: callModel,
                      delegatedModel: input.model,
                      delegatedReasoningEffort: turnReasoningEffort,
                      delegatedModelSpeed: turnModelSpeed,
                      onAsyncHookRewake,
                      onHookFeedback,
                      onHookSuccess: consumeOnceHook,
                      onPersistedOutput: (output) => { modelFacingOutput = output; },
                      onCommandProgress: streamedDecision.name === "shell_command"
                        ? async (progress) => {
                            await updateProjectAgentEvent({
                              projectId: input.projectId,
                              eventId: event.id,
                              content: formatCommandProgress(progress.stdout, progress.stderr),
                              data: {
                                progress: true,
                                elapsedMs: progress.elapsedMs,
                                outputFilePath: progress.outputFilePath,
                                stdoutTail: tailText(progress.stdout, 4_000),
                                stderrTail: tailText(progress.stderr, 4_000),
                              },
                            }, dataDir);
                          }
                        : undefined,
                      onCommandStall: streamedDecision.name === "shell_command"
                        ? (stall) => notifyProjectAgentCommandStall({
                            projectId: input.projectId,
                            turnId,
                            executionId: streamedExecutionId,
                            stall,
                            dataDir,
                            callModel,
                          })
                        : undefined,
                    }, dataDir);
                    return {
                      decision: streamedDecision,
                      event,
                      output: modelFacingOutput ?? await persistAgentToolResultForModel({
                        dataDir,
                        name: streamedDecision.name,
                        output: persistedAgentWorkspaceToolOutput(streamedDecision.name, rawOutput as never),
                        projectId: input.projectId,
                        toolCallId: event.id,
                      }),
                    };
                  } catch (error) {
                    return { decision: streamedDecision, event, error: error instanceof Error ? error.message : "工具执行失败" };
                  }
                },
              });
            },
            allowedAgentTools: projectAgentToolsForMode(
              modelContext.interactionMode,
              activeBuiltInToolNames,
              projectPermissionRules,
            ),
            additionalAgentTools: activeMcpTools.map((tool) => ({
              name: tool.name,
              description: `${tool.description}（MCP 服务：${tool.serverName}；${tool.readOnly ? "只读" : "可产生外部变更"}）`,
              parameters: tool.parameters,
            })),
          });
        } catch (error) {
          const steered = !input.signal?.aborted && await steeringChanged(projectRuntimeKey, steeringRevision);
          if (steered) {
            streamedToolExecutor.cancelInterruptible("steered");
            const entries = streamedToolExecutor.list();
            const settled = await Promise.all(entries.map(async (entry) => ({
              entry,
              outcome: await entry.outcome,
            })));
            const cancelled = settled.flatMap(({ entry, outcome }) =>
              entry.interruptBehavior === "cancel" && outcome.status === "succeeded" ? [outcome.value] : [],
            );
            const blocking = settled.flatMap(({ entry, outcome }) =>
              entry.interruptBehavior === "block" && outcome.status === "succeeded" ? [outcome.value] : [],
            );
            await appendStreamedToolOutcomes({
              projectId: input.projectId,
              turnId,
              executionId,
              outcomes: cancelled,
              superseded: true,
              permissionMode: modelInfo.permissionMode,
              interruptedContent: "已被补充指令中断，结果未纳入上下文。",
              dataDir,
              onFilesChanged,
              callModel,
            });
            const finalizedBlocking = await appendStreamedToolOutcomes({
              projectId: input.projectId,
              turnId,
              executionId,
              outcomes: blocking,
              superseded: false,
              permissionMode: modelInfo.permissionMode,
              dataDir,
              onFilesChanged,
              callModel,
            });
            const waitingApproval = await streamedWaitingApprovalResult(finalizedBlocking);
            if (waitingApproval) return waitingApproval;
            const waitingInput = await streamedWaitingInputResult(finalizedBlocking);
            if (waitingInput) return waitingInput;
            await recordStreamedToolEffects(finalizedBlocking);
            interruptedBySteering = true;
          } else {
            streamedToolExecutor.discard("model_stream_failed");
            const streamedOutcomes = await settleStreamedToolOutcomes(streamedToolExecutor);
            await appendStreamedToolOutcomes({
              projectId: input.projectId,
              turnId,
              executionId,
              outcomes: streamedOutcomes,
              superseded: true,
              permissionMode: modelInfo.permissionMode,
              interruptedContent: "模型流式响应失败，本次提前启动的工具结果未纳入上下文。",
              dataDir,
              callModel,
            });
            if (isMaxOutputTokensModelError(error)) {
              if (maxOutputTokensOverride !== ESCALATED_MAX_OUTPUT_TOKENS) {
                maxOutputTokensOverride = ESCALATED_MAX_OUTPUT_TOKENS;
                recoveringMaxOutputTokens = true;
              } else if (maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
                const partialText = error instanceof ProjectAgentModelStreamError
                  ? error.partialText.trim()
                  : "";
                if (partialText) {
                  await appendProjectAgentEvent({
                    projectId: input.projectId,
                    turnId,
                    type: "assistant",
                    content: partialText,
                    data: {
                      checkpoint: true,
                      maxOutputTokensRecovery: true,
                      recoveryAttempt: maxOutputTokensRecoveryCount + 1,
                    },
                  }, dataDir);
                }
                maxOutputTokensRecoveryCount += 1;
                maxOutputTokensOverride = undefined;
                maxOutputTokensRecoveryInstruction =
                  "Output token limit hit. Resume directly — no apology and no recap. Continue from exactly where the previous assistant output was cut off, and break the remaining work into smaller pieces if needed.";
                recoveringMaxOutputTokens = true;
              } else {
                throw error;
              }
            } else if (isContextOverflowError(error)) {
              const compacted = await compactBeforeTurnIfNeeded({
                projectId: input.projectId,
                conversationId: input.conversationId,
                model: input.model,
                contextWindow: modelInfo.contextWindow,
                callModel,
                signal: input.signal,
                turnId,
                executionId,
                hooks: activeAgentHooks,
                reasoningEffort: turnReasoningEffort,
                modelSpeed: turnModelSpeed,
                trigger: "auto",
                force: true,
              }, dataDir);
              if (compacted.status === "compacted") {
                const compactSessionStart = await runMainLifecycle(
                  "SessionStart",
                  { source: "compact", trigger: "auto", reactive: true },
                  "compact",
                );
                if (compactSessionStart?.permission === "deny" || compactSessionStart?.preventContinuation) {
                  throw new ProjectAgentTurnError(
                    compactSessionStart.reason || "压缩后的 SessionStart Hook 已阻止继续",
                    "tool_failed",
                  );
                }
                reactivelyCompacted = true;
              } else {
                throw error;
              }
            } else {
              throw error;
            }
          }
        } finally {
          modelStep.finish();
          streamedToolExecutor.dispose();
          await thinkingReporter.flush();
          await answerDraftReporter.flush();
        }
        if (interruptedBySteering) {
          await answerDraftReporter.clear();
          continue;
        }
        if (reactivelyCompacted) {
          await answerDraftReporter.clear();
          continue;
        }
        if (recoveringMaxOutputTokens) {
          await answerDraftReporter.clear();
          continue;
        }
      }
      if (response) {
        maxOutputTokensOverride = undefined;
        maxOutputTokensRecoveryCount = 0;
        maxOutputTokensRecoveryInstruction = undefined;
        await recordUsage(input.projectId, input.model, modelInfo.contextWindow, response, dataDir);
      }
      if (await steeringChanged(projectRuntimeKey, steeringRevision)) {
        await answerDraftReporter?.clear();
        continue;
      }
      const nativeToolCalls = response?.toolCalls?.length
        ? response.toolCalls
        : response?.toolCall ? [response.toolCall] : [];
      const nativeDecisions = nativeToolCalls.map((toolCall) => ({
        toolCall,
        decision: projectTurnDecisionFromNativeToolCall(
          toolCall,
          mcpDiscovery.tools.filter((tool) => activeMcpToolNames.has(tool.name)),
        ),
      }));
      const assistantCheckpoint = response?.text.trim() ?? "";
      if (!pendingNativeDecision && nativeToolCalls.length > 0 && assistantCheckpoint) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "assistant",
          content: assistantCheckpoint,
          data: { checkpoint: true },
        }, dataDir);
        await answerDraftReporter?.clear();
      }
      const matchingStreamedTools = nativeDecisions.map((entry, index) => {
        return streamedToolExecutor?.get(index, streamedToolSignature(entry.toolCall)) ?? null;
      });
      const orphanedStreamedTools = streamedToolExecutor?.discardExcept(
        matchingStreamedTools.flatMap((entry) => entry ? [{ index: entry.index, signature: entry.signature }] : []),
        "provider_omitted_streamed_tool",
      ) ?? [];
      if (orphanedStreamedTools.length > 0) {
        const settledOrphans = await Promise.all(orphanedStreamedTools.map((entry) => entry.outcome));
        const orphanOutcomes = settledOrphans.flatMap((outcome) =>
          outcome.status === "succeeded" ? [outcome.value] : [],
        );
        await appendStreamedToolOutcomes({
          projectId: input.projectId,
          turnId,
          executionId,
          outcomes: orphanOutcomes,
          superseded: true,
          permissionMode: modelInfo.permissionMode,
          interruptedContent: "服务商最终响应未包含该工具调用，提前启动的结果已丢弃。",
          dataDir,
          onFilesChanged,
          callModel,
        });
      }
      const invalidNativeCalls = nativeDecisions.filter((entry) => !entry.decision);
      if (!pendingNativeDecision && invalidNativeCalls.length > 0) {
        await answerDraftReporter?.clear();
        const settledOutcomes = await Promise.all(matchingStreamedTools.flatMap((entry) => entry ? [entry.outcome] : []));
        const outcomes = settledOutcomes.flatMap((outcome) => outcome.status === "succeeded" ? [outcome.value] : []);
        if (input.signal?.aborted) throw new ProjectAgentTurnError("项目 Agent 已停止", "tool_failed");
        const superseded = await steeringChanged(projectRuntimeKey, steeringRevision);
        const finalized = await appendStreamedToolOutcomes({
          projectId: input.projectId,
          turnId,
          executionId,
          outcomes,
          superseded,
          permissionMode: modelInfo.permissionMode,
          dataDir,
          onFilesChanged,
          callModel,
        });
        const waitingApproval = await streamedWaitingApprovalResult(finalized);
        if (waitingApproval) return waitingApproval;
        await recordStreamedToolEffects(finalized);
        const waitingInput = await streamedWaitingInputResult(finalized);
        if (waitingInput) return waitingInput;
        executionId ??= (await createAgentExecution({
          projectId: input.projectId,
          instruction: input.prompt,
          resultNodeId: turnId,
          triggerNodeId: turnId,
          canvasContext: input.canvasContext,
          currentNodeContext: input.currentNodeContext,
          connectedGraphContext: input.connectedGraphContext,
          conversationId: input.conversationId,
          selectedNodeIds: input.selectedNodeIds,
          fileDocumentIds: input.fileDocumentIds,
          permissionMode: modelInfo.permissionMode,
          allowWithoutWorkspace: true,
        }, dataDir)).detail.id;
        for (const entry of invalidNativeCalls) {
          const invalidEvent = await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolCall",
            data: { status: "running", executionId, name: entry.toolCall.name, arguments: entry.toolCall.arguments },
          }, dataDir);
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolResult",
            content: describeAgentToolCallValidationError(entry.toolCall.name, entry.toolCall.arguments),
            data: { status: "failed", executionId, toolCallEventId: invalidEvent.id, name: entry.toolCall.name },
          }, dataDir);
        }
        for (const [index, entry] of nativeDecisions.entries()) {
          if (!matchingStreamedTools[index] && entry.decision) pendingNativeDecisions.push(entry.decision);
        }
        continue;
      }
      if (!pendingNativeDecision && matchingStreamedTools.some(Boolean)) {
        await answerDraftReporter?.clear();
        const settledOutcomes = await Promise.all(matchingStreamedTools.flatMap((entry) => entry ? [entry.outcome] : []));
        const outcomes = settledOutcomes.flatMap((outcome) => outcome.status === "succeeded" ? [outcome.value] : []);
        if (input.signal?.aborted) throw new ProjectAgentTurnError("项目 Agent 已停止", "tool_failed");
        const superseded = await steeringChanged(projectRuntimeKey, steeringRevision);
        const finalized = await appendStreamedToolOutcomes({
          projectId: input.projectId,
          turnId,
          executionId,
          outcomes,
          superseded,
          permissionMode: modelInfo.permissionMode,
          dataDir,
          onFilesChanged,
          callModel,
        });
        const waitingApproval = await streamedWaitingApprovalResult(finalized);
        if (waitingApproval) return waitingApproval;
        await recordStreamedToolEffects(finalized);
        const waitingInput = await streamedWaitingInputResult(finalized);
        if (waitingInput) return waitingInput;
        for (const [index, entry] of nativeDecisions.entries()) {
          if (!matchingStreamedTools[index] && entry.decision) pendingNativeDecisions.push(entry.decision);
        }
        continue;
      }
      const concurrentReadDecisions: WorkspaceToolDecision[] = nativeDecisions.flatMap((entry) =>
        entry.decision?.type === "tool" && !isMcpToolName(entry.decision.name) &&
        getAgentToolDefinition(entry.decision.name)?.isConcurrencySafe(
          entry.decision.arguments as AgentWorkspaceToolArguments[AgentWorkspaceToolName],
        ) === true &&
        !(entry.decision.name === "shell_command" && modelInfo.permissionMode === "untrusted")
          ? [{ ...entry.decision, name: entry.decision.name as AgentWorkspaceToolName }]
          : [],
      );
      if (!pendingNativeDecision && nativeDecisions.length > 1 && concurrentReadDecisions.length === nativeDecisions.length) {
        await answerDraftReporter?.clear();
        executionId ??= (await createAgentExecution({
          projectId: input.projectId,
          instruction: input.prompt,
          resultNodeId: turnId,
          triggerNodeId: turnId,
          canvasContext: input.canvasContext,
          currentNodeContext: input.currentNodeContext,
          connectedGraphContext: input.connectedGraphContext,
          conversationId: input.conversationId,
          selectedNodeIds: input.selectedNodeIds,
          fileDocumentIds: input.fileDocumentIds,
          allowWithoutWorkspace: concurrentReadDecisions.every((decision) =>
            !getAgentToolDefinition(decision.name)?.requiresWorkspace),
        }, dataDir)).detail.id;
        const toolEvents: ProjectAgentEvent[] = [];
        for (const decision of concurrentReadDecisions) {
          toolEvents.push(await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolCall",
            data: { status: "running", executionId, name: decision.name, arguments: decision.arguments },
          }, dataDir));
        }
        const readStep = beginProjectTurnStep(projectRuntimeKey, input.signal, "cancel");
        const siblingController = new AbortController();
        const abortSiblings = () => siblingController.abort(readStep.signal?.reason);
        readStep.signal?.addEventListener("abort", abortSiblings, { once: true });
        let outcomes: Array<
          | { readonly decision: WorkspaceToolDecision; readonly output: unknown }
          | { readonly decision: WorkspaceToolDecision; readonly error: string }
        >;
        try {
          outcomes = await Promise.all(concurrentReadDecisions.map(async (decision) => {
            try {
              let modelFacingOutput: unknown;
              const rawOutput = await executeTool({
                projectId: input.projectId,
                executionId: executionId!,
                additionalAllowedTools: [...turnAdditionalAllowedTools],
                name: decision.name,
                arguments: decision.arguments as never,
                signal: siblingController.signal,
                turnId,
                delegatedCallModel: callModel,
                delegatedModel: input.model,
                delegatedReasoningEffort: turnReasoningEffort,
                delegatedModelSpeed: turnModelSpeed,
                onAsyncHookRewake,
                onHookFeedback,
                onHookSuccess: consumeOnceHook,
                onPersistedOutput: (output) => { modelFacingOutput = output; },
                onCommandProgress: decision.name === "shell_command"
                  ? async (progress) => {
                      const eventIndex = concurrentReadDecisions.indexOf(decision);
                      const event = toolEvents[eventIndex];
                      if (!event) return;
                      await updateProjectAgentEvent({
                        projectId: input.projectId,
                        eventId: event.id,
                        content: formatCommandProgress(progress.stdout, progress.stderr),
                        data: {
                          progress: true,
                          elapsedMs: progress.elapsedMs,
                          outputFilePath: progress.outputFilePath,
                          stdoutTail: tailText(progress.stdout, 4_000),
                          stderrTail: tailText(progress.stderr, 4_000),
                        },
                      }, dataDir);
                    }
                  : undefined,
                onCommandStall: decision.name === "shell_command"
                  ? (stall) => notifyProjectAgentCommandStall({
                      projectId: input.projectId,
                      turnId,
                      executionId: executionId!,
                      stall,
                      dataDir,
                      callModel,
                    })
                  : undefined,
              }, dataDir);
              if (decision.name === "shell_command" && isAgentCommandRequest(rawOutput) &&
                !["succeeded", "running"].includes(rawOutput.status)) {
                siblingController.abort(new Error("并行只读 Shell 失败"));
              }
              return {
                decision,
                output: modelFacingOutput ?? await persistAgentToolResultForModel({
                  dataDir,
                  name: decision.name,
                  output: persistedAgentWorkspaceToolOutput(decision.name, rawOutput as never),
                  projectId: input.projectId,
                  toolCallId: toolEvents[concurrentReadDecisions.indexOf(decision)].id,
                }),
              } as const;
            } catch (error) {
              return {
                decision,
                error: error instanceof Error ? error.message : "工具执行失败",
              } as const;
            }
          }));
        } finally {
          readStep.signal?.removeEventListener("abort", abortSiblings);
          readStep.finish();
        }
        if (input.signal?.aborted) {
          throw new ProjectAgentTurnError("项目 Agent 已停止", "tool_failed");
        }
        if (await steeringChanged(projectRuntimeKey, steeringRevision)) {
          for (const [index, decision] of concurrentReadDecisions.entries()) {
            await appendProjectAgentEvent({
              projectId: input.projectId,
              turnId,
              type: "toolResult",
              content: "已被补充指令中断，结果未纳入上下文。",
              data: {
                status: "interrupted",
                executionId,
                toolCallEventId: toolEvents[index].id,
                name: decision.name,
              },
            }, dataDir);
          }
          continue;
        }
        for (const [index, outcome] of outcomes.entries()) {
          if ("error" in outcome) {
            await appendProjectAgentEvent({
              projectId: input.projectId,
              turnId,
              type: "toolResult",
              content: outcome.error,
              data: {
                status: "failed",
                executionId,
                toolCallEventId: toolEvents[index].id,
                name: outcome.decision.name,
              },
            }, dataDir);
            continue;
          }
          const toolSucceeded = !(outcome.decision.name === "shell_command" && isAgentCommandRequest(outcome.output))
            || ["succeeded", "running"].includes(outcome.output.status);
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolResult",
            content: summarizeToolResult(outcome.decision.name, outcome.output),
            data: {
              status: toolSucceeded ? "succeeded" : "failed",
              executionId,
              toolCallEventId: toolEvents[index].id,
              name: outcome.decision.name,
              output: outcome.output,
            },
          }, dataDir);
          if (outcome.decision.name === "shell_command" && isAgentCommandRequest(outcome.output) &&
            outcome.output.status === "running") {
            scheduleBackgroundTaskSettlement({
              projectId: input.projectId,
              turnId,
              executionId,
              commandId: outcome.output.id,
              executable: outcome.output.executable,
              args: outcome.output.args,
              command: outcome.output.command,
              dataDir,
              callModel,
            });
          }
        }
        continue;
      }
      const nativeDecision = nativeDecisions[0]?.decision ?? null;
      if (nativeDecisions.length > 1) {
        pendingNativeDecisions.push(...nativeDecisions.slice(1).map((entry) => entry.decision!));
      }
      const parsedDecision = pendingNativeDecision ?? nativeDecision ?? parseProjectTurnDecision(
          response?.text ?? "",
          mcpDiscovery.tools.filter((tool) => activeMcpToolNames.has(tool.name)),
        );
      const decision = parsedDecision;
      if (!decision) {
        let answer = response?.text ?? "";
        const researchIssue = validateResearchAnswer(answer, research);
        if (researchIssue && research.answerRetryCount < MAX_RESEARCH_ANSWER_RETRIES) {
          await answerDraftReporter?.clear();
          research.answerRetryCount += 1;
          research.correction = researchIssue;
          continue;
        }
        if (researchIssue) answer = removeUnverifiedResearchLinks(answer, research);
        if (!await prepareMainCompletion(answer)) {
          await answerDraftReporter?.clear();
          continue;
        }
        if (!claimProjectAgentTurnCompletion(projectRuntimeKey, steeringRevision)) {
          await answerDraftReporter?.clear();
          continue;
        }
        await runMainLifecycle("SessionEnd", { result: answer });
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
        await answerDraftReporter?.clear();
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
        await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
        await scheduleProjectAutoDream({ projectId: input.projectId, model: input.model, callModel, dataDir });
        return { turnId, status: "completed" as const, answer, executionId };
      }
      if (decision.type === "complete") {
        let answer = decision.summary;
        const researchIssue = validateResearchAnswer(answer, research);
        if (researchIssue && research.answerRetryCount < MAX_RESEARCH_ANSWER_RETRIES) {
          await answerDraftReporter?.clear();
          research.answerRetryCount += 1;
          research.correction = researchIssue;
          continue;
        }
        if (researchIssue) answer = removeUnverifiedResearchLinks(answer, research);
        if (!await prepareMainCompletion(answer)) {
          await answerDraftReporter?.clear();
          continue;
        }
        if (!claimProjectAgentTurnCompletion(projectRuntimeKey, steeringRevision)) {
          await answerDraftReporter?.clear();
          continue;
        }
        await runMainLifecycle("SessionEnd", { result: answer });
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: answer }, dataDir);
        await answerDraftReporter?.clear();
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed" } }, dataDir);
        await finishExecutionIfNeeded(input.projectId, executionId, answer, dataDir);
        await scheduleProjectAutoDream({ projectId: input.projectId, model: input.model, callModel, dataDir });
        return { turnId, status: "completed" as const, answer, executionId };
      }

      await answerDraftReporter?.clear();

      executionId ??= (await createAgentExecution({
        projectId: input.projectId,
        instruction: input.prompt,
        resultNodeId: turnId,
        triggerNodeId: turnId,
        canvasContext: input.canvasContext,
        currentNodeContext: input.currentNodeContext,
        connectedGraphContext: input.connectedGraphContext,
        conversationId: input.conversationId,
        selectedNodeIds: input.selectedNodeIds,
        fileDocumentIds: input.fileDocumentIds,
        permissionMode: modelInfo.permissionMode,
        allowWithoutWorkspace: decision.type === "tool" && !getAgentToolDefinition(decision.name)?.requiresWorkspace,
      }, dataDir)).detail.id;

      if (decision.name === "browser" && modelInfo.permissionMode === "untrusted" && !browserActionApprovedForIteration &&
          isBrowserInteraction(decision.arguments)) {
        const operation = String(decision.arguments.operation);
        const target = typeof decision.arguments.ref === "string" ? `元素 ${decision.arguments.ref}` : "当前页面";
        const question = `允许 Agent 在隔离的本地预览中${browserInteractionDescription(operation, target)}吗？`;
        const questionArguments = {
          question,
          options: [
            { label: "允许一次", description: "仅执行这一次精确的页面交互。" },
            { label: "拒绝", description: "不执行该页面交互，Agent 将继续处理。" },
          ],
        };
        const questionToolEvent = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolCall",
          data: { status: "running", executionId, name: "ask_user_question", arguments: questionArguments },
        }, dataDir);
        const questionOutput = await executeTool({
          projectId: input.projectId,
          executionId,
          additionalAllowedTools: [...turnAdditionalAllowedTools],
          name: "ask_user_question",
          arguments: questionArguments,
          signal: input.signal,
          turnId,
          delegatedCallModel: callModel,
          delegatedModel: input.model,
          delegatedReasoningEffort: turnReasoningEffort,
          delegatedModelSpeed: turnModelSpeed,
          onAsyncHookRewake,
          onHookFeedback,
          onHookSuccess: consumeOnceHook,
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: questionOutput.question,
          data: {
            status: "waitingInput",
            executionId,
            toolCallEventId: questionToolEvent.id,
            name: "ask_user_question",
            output: { ...questionOutput, pendingBrowserAction: decision.arguments },
          },
        }, dataDir);
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingInput" } }, dataDir);
        return { turnId, status: "waitingInput" as const, question, options: questionOutput.options, executionId };
      }

      if (decision.name === "workflow" && !workflowActionApprovedForIteration) {
        const blockedToolEvent = async (content: string) => {
          const event = await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolCall",
            data: { status: "running", executionId, name: decision.name, arguments: decision.arguments },
          }, dataDir);
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolResult",
            content,
            data: { status: "failed", executionId, toolCallEventId: event.id, name: decision.name },
          }, dataDir);
        };
        if (modelInfo.permissionMode === "neverAsk") {
          await blockedToolEvent("Workflow 会启动可修改项目的 Sub-agent，必须在启动前批准；当前会话设置为“从不请求审批”，因此已拒绝。 ");
          continue;
        }
        let preview: Awaited<ReturnType<typeof import("@/lib/agent/workflow-runner")["previewProjectAgentWorkflow"]>>;
        try {
          const { previewProjectAgentWorkflow } = await import("@/lib/agent/workflow-runner");
          preview = await previewProjectAgentWorkflow({
            projectId: input.projectId,
            ...(decision.arguments as AgentWorkspaceToolArguments["workflow"]),
          }, dataDir);
        } catch (error) {
          await blockedToolEvent(error instanceof Error ? error.message : "Workflow 定义无效");
          continue;
        }
        const phaseText = preview.phases.length
          ? `\n\n阶段：\n${preview.phases.map((phase, index) => `${index + 1}. ${phase.title}${phase.detail ? `：${phase.detail}` : ""}`).join("\n")}`
          : "";
        const question = `运行 Workflow“${preview.name}”吗？\n\n${preview.description}${phaseText}`;
        const questionArguments = {
          question,
          options: [
            { label: "运行 Workflow", description: "批准本次 Workflow；其内部 Sub-agent 按当前项目权限执行。" },
            { label: "拒绝", description: "不启动该 Workflow，Agent 将继续处理。" },
          ],
        };
        const questionToolEvent = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolCall",
          data: { status: "running", executionId, name: "ask_user_question", arguments: questionArguments },
        }, dataDir);
        const questionOutput = await executeTool({
          projectId: input.projectId,
          executionId,
          additionalAllowedTools: [...turnAdditionalAllowedTools],
          name: "ask_user_question",
          arguments: questionArguments,
          signal: input.signal,
          turnId,
          delegatedCallModel: callModel,
          delegatedModel: input.model,
          delegatedReasoningEffort: turnReasoningEffort,
          delegatedModelSpeed: turnModelSpeed,
          onAsyncHookRewake,
          onHookFeedback,
          onHookSuccess: consumeOnceHook,
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: questionOutput.question,
          data: {
            status: "waitingInput",
            executionId,
            toolCallEventId: questionToolEvent.id,
            name: "ask_user_question",
            output: { ...questionOutput, pendingWorkflowAction: decision.arguments, workflowPreview: preview },
          },
        }, dataDir);
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingInput" } }, dataDir);
        return { turnId, status: "waitingInput" as const, question, options: questionOutput.options, executionId };
      }

      if (modelContext.interactionMode === "plan" && !isPlanModeToolAllowed(decision.name, mcpDiscovery.tools)) {
        const blockedToolEvent = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolCall",
          data: { status: "running", executionId, name: decision.name, arguments: decision.arguments },
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: "规划模式仅允许只读探索、提问和计划工具；请先完成计划并调用 exit_plan_mode 请求用户批准。",
          data: { status: "failed", executionId, toolCallEventId: blockedToolEvent.id, name: decision.name },
        }, dataDir);
        continue;
      }

      if ((decision.name === "enter_plan_mode" && modelContext.interactionMode === "plan") ||
          (decision.name === "exit_plan_mode" && modelContext.interactionMode !== "plan")) {
        const invalidToolEvent = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolCall",
          data: { status: "running", executionId, name: decision.name, arguments: decision.arguments },
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: decision.name === "enter_plan_mode" ? "当前已经处于规划模式。" : "当前不在规划模式，不能提交退出计划。",
          data: { status: "failed", executionId, toolCallEventId: invalidToolEvent.id, name: decision.name },
        }, dataDir);
        continue;
      }

      let toolEvent = isMcpToolName(decision.name) ? undefined : await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId,
        type: "toolCall",
        data: { status: "running", executionId, name: decision.name, arguments: decision.arguments },
      }, dataDir);
      const ensureToolEvent = async (argumentsValue = decision.arguments) => {
        toolEvent ??= await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolCall",
          data: { status: "running", executionId, name: decision.name, arguments: argumentsValue },
        }, dataDir);
        return toolEvent;
      };
      const toolArguments = decision.name === "web_fetch" || decision.name === "delegate_tasks" || decision.name === "agent_spawn" || decision.name === "send_message"
        ? { ...decision.arguments, model: input.model }
        : decision.arguments;
      if (decision.name === "ask_user_question") {
        const output = await executeTool({
          projectId: input.projectId,
          executionId,
          additionalAllowedTools: [...turnAdditionalAllowedTools],
          name: decision.name,
          arguments: toolArguments as never,
          signal: input.signal,
          turnId,
          delegatedCallModel: callModel,
          delegatedModel: input.model,
          delegatedReasoningEffort: turnReasoningEffort,
          delegatedModelSpeed: turnModelSpeed,
          onAsyncHookRewake,
          onHookFeedback,
          onHookSuccess: consumeOnceHook,
        }, dataDir);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: output.question,
          data: { status: "waitingInput", executionId, toolCallEventId: toolEvent!.id, name: decision.name, output },
        }, dataDir);
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingInput" } }, dataDir);
        return { turnId, status: "waitingInput" as const, question: output.question, options: output.options, executionId };
      }
      if (decision.name === "enter_plan_mode") {
        const output = await executeTool({
          projectId: input.projectId,
          executionId,
          additionalAllowedTools: [...turnAdditionalAllowedTools],
          name: decision.name,
          arguments: toolArguments as never,
          signal: input.signal,
          turnId,
          delegatedCallModel: callModel,
          delegatedModel: input.model,
          delegatedReasoningEffort: turnReasoningEffort,
          delegatedModelSpeed: turnModelSpeed,
          onAsyncHookRewake,
          onHookFeedback,
          onHookSuccess: consumeOnceHook,
        }, dataDir) as AgentWorkspaceToolResult["enter_plan_mode"];
        await updateConversationSessionState({
          interactionMode: "plan",
          activePlan: null,
        });
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: output.message,
          data: { status: "succeeded", executionId, toolCallEventId: toolEvent!.id, name: decision.name, output },
        }, dataDir);
        continue;
      }
      if (decision.name === "exit_plan_mode") {
        const output = await executeTool({
          projectId: input.projectId,
          executionId,
          additionalAllowedTools: [...turnAdditionalAllowedTools],
          name: decision.name,
          arguments: toolArguments as never,
          signal: input.signal,
          turnId,
          delegatedCallModel: callModel,
          delegatedModel: input.model,
          delegatedReasoningEffort: turnReasoningEffort,
          delegatedModelSpeed: turnModelSpeed,
          onAsyncHookRewake,
          onHookFeedback,
          onHookSuccess: consumeOnceHook,
        }, dataDir) as AgentWorkspaceToolResult["exit_plan_mode"];
        await updateConversationSessionState({ activePlan: output.plan });
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: output.plan,
          data: { status: "waitingInput", executionId, toolCallEventId: toolEvent!.id, name: decision.name, output },
        }, dataDir);
        await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingInput" } }, dataDir);
        return { turnId, status: "waitingInput" as const, question: output.question, options: output.options, executionId };
      }
      const mcpTool = isMcpToolName(decision.name)
        ? mcpDiscovery.tools.find((tool) => tool.name === decision.name)
        : undefined;
      const mcpExecutionDetail = isMcpToolName(decision.name) && activeAgentHooks
        ? await getAgentExecution(input.projectId, executionId, dataDir)
        : undefined;
      const mcpConfiguredHooks = isMcpToolName(decision.name) && activeAgentHooks
        ? createProjectAgentToolHooks({
            projectId: input.projectId,
            executionId,
            name: decision.name,
            hooks: activeAgentHooks,
            rootId: mcpExecutionDetail?.context.workspaceRootId,
            model: input.model,
            reasoningEffort: turnReasoningEffort,
            modelSpeed: turnModelSpeed,
            callModel,
            signal: input.signal,
            onAsyncRewake: onAsyncHookRewake,
            onHookSuccess: consumeOnceHook,
            dataDir,
          })
        : undefined;
      const toolInterruptBehavior = isMcpToolName(decision.name)
        ? (mcpTool?.readOnly ? "cancel" : "block")
        : (getAgentToolDefinition(decision.name)?.interruptBehavior ?? "block");
      try {
        const deferredToolSearchResults = decision.name === "tool_search"
          ? searchProjectMcpTools(
              mcpDiscovery.tools,
              (toolArguments as AgentWorkspaceToolArguments["tool_search"]).query,
              (toolArguments as AgentWorkspaceToolArguments["tool_search"]).maxResults,
            )
          : undefined;
        const toolStep = beginProjectTurnStep(projectRuntimeKey, input.signal, toolInterruptBehavior);
        let rawOutput: unknown;
        let modelFacingOutput: unknown;
        try {
          rawOutput = isMcpToolName(decision.name)
            ? await (async () => {
              const pipelineResult = await executeAgentToolPipeline({
                projectId: input.projectId,
                executionId,
                name: decision.name,
                arguments: toolArguments,
                validate: () => Boolean(mcpTool),
                preHooks: mcpConfiguredHooks?.preHooks,
                authorize: ({ arguments: argumentsValue, hookPermission }) => {
                  const configuredPermission = evaluateProjectToolPermission({
                    name: decision.name as McpToolName,
                    content: JSON.stringify(argumentsValue),
                    rules: projectPermissionRules,
                  });
                  if (configuredPermission === "deny") {
                    return { decision: "deny" as const, reason: "MCP 工具调用已被项目权限规则拒绝。" };
                  }
                  if (configuredPermission === "ask") {
                    if (mcpActionApprovedForIteration) return "allow" as const;
                    if (modelInfo.permissionMode === "neverAsk") {
                      return {
                        decision: "deny" as const,
                        reason: "MCP 工具调用需要批准；当前会话设置为“从不请求审批”，因此已拒绝。",
                      };
                    }
                    return {
                      decision: "ask" as const,
                      detail: { name: decision.name, arguments: argumentsValue },
                      reason: `MCP 工具 ${decision.name} 需要用户批准。`,
                    };
                  }
                  if (hookPermission === "ask") {
                    return {
                      decision: "ask" as const,
                      detail: { name: decision.name, arguments: argumentsValue },
                      reason: `PreToolUse Hook 要求批准 MCP 工具 ${decision.name}。`,
                    };
                  }
                  return configuredPermission;
                },
                permissionRequestHooks: mcpConfiguredHooks?.permissionRequestHooks,
                permissionDeniedHooks: mcpConfiguredHooks?.permissionDeniedHooks,
                postSuccessHooks: mcpConfiguredHooks?.postSuccessHooks,
                postFailureHooks: mcpConfiguredHooks?.postFailureHooks,
                execute: async ({ arguments: argumentsValue }) => {
                  await ensureToolEvent(argumentsValue);
                  return callMcpTool({
                    projectId: input.projectId,
                    name: decision.name as McpToolName,
                    arguments: argumentsValue,
                    signal: toolStep.signal,
                    connectionScope: executionId,
                    onElicitation: onMcpElicitation,
                    onElicitationComplete: onMcpElicitationComplete,
                  }, dataDir);
                },
                persistOutput: (output, metadata) => persistAgentToolResultForModel({
                  dataDir,
                  name: decision.name,
                  output,
                  projectId: input.projectId,
                  toolCallId: metadata.toolCallId,
                }),
              }, dataDir);
              if (pipelineResult.additionalContext.length || pipelineResult.preventContinuation) {
                await onHookFeedback({
                  additionalContext: pipelineResult.additionalContext,
                  preventContinuation: pipelineResult.preventContinuation,
                });
              }
              if (pipelineResult.preventContinuation) {
                throw new AgentHookPreventContinuationError(pipelineResult.additionalContext);
              }
              return pipelineResult.persistedOutput;
            })()
            : await executeTool({
                projectId: input.projectId,
                executionId,
                additionalAllowedTools: [...turnAdditionalAllowedTools],
                name: decision.name,
                arguments: toolArguments as never,
                deferredToolSearchResults,
                delegatedCallModel: callModel,
                delegatedModel: input.model,
                delegatedReasoningEffort: turnReasoningEffort,
                delegatedModelSpeed: turnModelSpeed,
                onAsyncHookRewake,
                onHookFeedback,
                onHookSuccess: consumeOnceHook,
                onPersistedOutput: (output) => { modelFacingOutput = output; },
                onCommandProgress: decision.name === "shell_command"
                  ? async (progress) => {
                      await updateProjectAgentEvent({
                        projectId: input.projectId,
                        eventId: toolEvent!.id,
                        content: formatCommandProgress(progress.stdout, progress.stderr),
                        data: {
                          progress: true,
                          elapsedMs: progress.elapsedMs,
                          outputFilePath: progress.outputFilePath,
                          stdoutTail: tailText(progress.stdout, 4_000),
                          stderrTail: tailText(progress.stderr, 4_000),
                        },
                      }, dataDir);
                  }
                  : undefined,
                onCommandStall: decision.name === "shell_command"
                  ? (stall) => notifyProjectAgentCommandStall({
                      projectId: input.projectId,
                      turnId,
                      executionId: executionId!,
                      stall,
                      dataDir,
                      callModel,
                    })
                  : undefined,
                onWorkflowProgress: decision.name === "workflow"
                  ? async (progress, runId) => {
                      await updateProjectAgentEvent({
                        projectId: input.projectId,
                        eventId: toolEvent!.id,
                        content: formatWorkflowProgress(progress),
                        data: { progress: true, runId, workflowProgress: progress },
                      }, dataDir);
                    }
                  : undefined,
                signal: toolStep.signal,
                turnId,
              }, dataDir);
        } finally {
          toolStep.finish();
        }
        if (toolInterruptBehavior === "cancel" && await steeringChanged(projectRuntimeKey, steeringRevision)) {
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolResult",
            content: "已被补充指令中断，结果未纳入上下文。",
            data: { status: "interrupted", executionId, toolCallEventId: toolEvent!.id, name: decision.name },
          }, dataDir);
          continue;
        }
        if (decision.name === "browser") {
          browserScreenshot = browserScreenshotDataUrl(rawOutput) ?? browserScreenshot;
        }
        if (decision.name === "shell_command" && isAgentCommandRequest(rawOutput) && rawOutput.status === "proposed") {
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "approval",
            content: rawOutput.reason,
            data: {
              status: "pending",
              executionId,
              commandRequestId: rawOutput.id,
              command: rawOutput.command,
              executable: rawOutput.executable,
              args: rawOutput.args,
              cwd: rawOutput.cwd,
              rootId: rawOutput.rootId,
              externalRoot: rawOutput.externalRoot,
              sandboxMode: rawOutput.sandboxMode,
            },
          }, dataDir);
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "status",
            data: { stage: "waitingApproval" },
          }, dataDir);
          return {
            turnId,
            status: "waitingApproval" as const,
            executionId,
            commandRequestId: rawOutput.id,
          };
        }
        if (decision.name === "tool_search") {
          const availableMcpNames = new Set(mcpDiscovery.tools.map((tool) => tool.name));
          const rawOutputRecord: Record<string, unknown> | null = isObject(rawOutput)
            ? rawOutput as Record<string, unknown>
            : null;
          const returnedTools = (Array.isArray(rawOutputRecord?.tools) ? rawOutputRecord.tools : [])
            .filter(isToolSearchResultEntry);
          const returnedNames = new Set(returnedTools.flatMap((tool) =>
            isObject(tool) && typeof tool.name === "string" ? [tool.name] : []));
          const resultLimit = Math.max(
            1,
            Math.min(30, (toolArguments as AgentWorkspaceToolArguments["tool_search"]).maxResults ?? 10),
          );
          const mergedTools = [
            ...returnedTools,
            ...(deferredToolSearchResults ?? []).filter((tool) => !returnedNames.has(tool.name)),
          ].slice(0, resultLimit);
          for (const tool of mergedTools) {
            if (
              isObject(tool)
              && typeof tool.name === "string"
              && DEFERRED_MODEL_AGENT_TOOL_NAMES.has(tool.name as AgentWorkspaceToolName)
            ) {
              activeBuiltInToolNames.add(tool.name as AgentWorkspaceToolName);
            }
            if (isObject(tool) && typeof tool.name === "string" && availableMcpNames.has(tool.name as McpToolName)) {
              activeMcpToolNames.add(tool.name);
            }
          }
          rawOutput = { tools: mergedTools };
        }
        const normalizedOutput = modelFacingOutput ?? (isMcpToolName(decision.name)
          ? rawOutput
          : persistedAgentWorkspaceToolOutput(decision.name, rawOutput as never));
        const persistableOutput = await persistAgentToolResultForModel({
          dataDir,
          name: decision.name,
          output: normalizedOutput,
          projectId: input.projectId,
          toolCallId: toolEvent!.id,
        });
        const output = await applyAgentChangeSetIfAuthorized(
          input.projectId,
          persistableOutput,
          modelInfo.permissionMode,
          dataDir,
          onFilesChanged,
        );
        const resultSummary = summarizeToolResult(decision.name, output);
        const toolSucceeded = !(decision.name === "shell_command" && isAgentCommandRequest(output))
          || ["succeeded", "running"].includes(output.status);
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: resultSummary,
          data: { status: toolSucceeded ? "succeeded" : "failed", executionId, toolCallEventId: toolEvent!.id, name: decision.name, output },
        }, dataDir);
        if (decision.name === "shell_command") await recordAutoApprovedShell(output);
        if (decision.name === "shell_command" && isAgentCommandRequest(output) && output.status === "running") {
          scheduleBackgroundTaskSettlement({
            projectId: input.projectId,
            turnId,
            executionId,
            commandId: output.id,
            executable: output.executable,
            args: output.args,
            command: output.command,
            dataDir,
            callModel,
          });
        }
        if (decision.name === "workflow" && isObject(output) &&
          typeof output.runId === "string" && typeof output.taskId === "string") {
          scheduleWorkflowSettlement({
            projectId: input.projectId,
            turnId,
            executionId,
            runId: output.runId,
            taskId: output.taskId,
            name: typeof output.workflowName === "string" ? output.workflowName : "Workflow",
            dataDir,
            callModel,
          });
        }
        if (decision.name === "agent_spawn" && isObject(output) && output.background === true &&
          typeof output.teamId === "string" && typeof output.agentId === "string") {
          scheduleSubagentSettlement({
            projectId: input.projectId,
            turnId,
            executionId,
            teamId: output.teamId,
            agentId: output.agentId,
            name: typeof output.name === "string" ? output.name : output.agentId,
            dataDir,
            callModel,
          });
        }
        if (decision.name === "send_message" && isObject(output) &&
          typeof output.teamId === "string" && Array.isArray(output.reactivatedAgentIds)) {
          const agentIds = output.reactivatedAgentIds.filter((value): value is string => typeof value === "string");
          const deliveredAgentIds = Array.isArray(output.agentIds)
            ? output.agentIds.filter((value): value is string => typeof value === "string")
            : [];
          const recipientNames = Array.isArray(output.recipients)
            ? output.recipients.filter((value): value is string => typeof value === "string")
            : [];
          const recipientNameByAgentId = new Map(
            deliveredAgentIds.map((agentId, index) => [agentId, recipientNames[index] ?? agentId]),
          );
          for (const agentId of agentIds) {
            scheduleSubagentSettlement({
              projectId: input.projectId,
              turnId,
              executionId,
              teamId: output.teamId,
              agentId,
              name: recipientNameByAgentId.get(agentId) ?? agentId,
              dataDir,
              callModel,
            });
          }
        }
        if (decision.name === "delegate_tasks" || decision.name === "skill") {
          const pending = skillPromptShellPendingApproval(output) ?? delegatedPendingApproval(output);
          if (pending) {
            const session = await getProjectAgentSession(input.projectId, dataDir);
            const exists = session.events.some((event) =>
              event.turnId === turnId && event.type === "approval" &&
              event.data?.commandRequestId === pending.command.id);
            if (!exists) {
              await appendProjectAgentEvent({
                projectId: input.projectId,
                turnId,
                type: "approval",
                content: pending.command.reason,
                data: {
                  status: "pending",
                  executionId: pending.executionId,
                  commandRequestId: pending.command.id,
                  command: pending.command.command,
                  executable: pending.command.executable,
                  args: pending.command.args,
                  cwd: pending.command.cwd,
                  externalRoot: pending.command.externalRoot,
                  sandboxMode: pending.command.sandboxMode,
                  orchestrationId: isObject(output) ? output.orchestrationId : undefined,
                },
              }, dataDir);
            }
            await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingApproval" } }, dataDir);
            return {
              turnId,
              status: "waitingApproval" as const,
              executionId: pending.executionId,
              commandRequestId: pending.command.id,
            };
          }
        }
        if (!isMcpToolName(decision.name)) updateTurnResearchState(research, decision.name, toolArguments, output);
        if (decision.name === "skill") {
          mergeSkillAllowedTools(turnAdditionalAllowedTools, output);
          await registerSkillHooks(output);
        }
        if (decision.name === "web_fetch") {
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "thinking",
            content: "正在基于已读取的网页正文归纳、去重并形成回答。",
          }, dataDir);
        }
      } catch (toolError) {
        const message = toolError instanceof Error ? toolError.message : "工具执行失败";
        if (isMcpToolName(decision.name) && toolError instanceof AgentToolPipelineError &&
            toolError.code === "approval_required") {
          const detail = isObject(toolError.detail) ? toolError.detail : {};
          const approvedName = typeof detail.name === "string" && isMcpToolName(detail.name)
            ? detail.name
            : decision.name;
          const approvedArguments = isObject(detail.arguments) ? detail.arguments : decision.arguments;
          const question = `允许 Agent 调用 MCP 工具“${approvedName}”吗？`;
          const questionArguments = {
            question,
            options: [
              { label: "允许 MCP 工具一次", description: "仅执行这一次名称与参数完全相同的 MCP 调用。" },
              { label: "拒绝", description: "不执行该 MCP 调用，Agent 将继续处理。" },
            ],
          };
          const questionToolEvent = await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolCall",
            data: { status: "running", executionId, name: "ask_user_question", arguments: questionArguments },
          }, dataDir);
          const questionOutput = await executeTool({
            projectId: input.projectId,
            executionId,
            additionalAllowedTools: [...turnAdditionalAllowedTools],
            name: "ask_user_question",
            arguments: questionArguments,
            signal: input.signal,
            turnId,
            delegatedCallModel: callModel,
            delegatedModel: input.model,
            delegatedReasoningEffort: turnReasoningEffort,
            delegatedModelSpeed: turnModelSpeed,
            onAsyncHookRewake,
            onHookFeedback,
            onHookSuccess: consumeOnceHook,
          }, dataDir);
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolResult",
            content: questionOutput.question,
            data: {
              status: "waitingInput",
              executionId,
              toolCallEventId: questionToolEvent.id,
              name: "ask_user_question",
              output: {
                ...questionOutput,
                pendingMcpAction: { name: approvedName, arguments: approvedArguments },
              },
            },
          }, dataDir);
          await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "waitingInput" } }, dataDir);
          return { turnId, status: "waitingInput" as const, question, options: questionOutput.options, executionId };
        }
        if (toolError instanceof AgentHookPreventContinuationError) {
          if (!claimProjectAgentTurnCompletion(projectRuntimeKey, steeringRevision)) continue;
          await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "assistant", content: message }, dataDir);
          await appendProjectAgentEvent({ projectId: input.projectId, turnId, type: "status", data: { stage: "completed", stoppedByHook: true } }, dataDir);
          await finishExecutionIfNeeded(input.projectId, executionId, message, dataDir);
          return { turnId, status: "completed" as const, answer: message, executionId };
        }
        if (!input.signal?.aborted && toolInterruptBehavior === "cancel" &&
            await steeringChanged(projectRuntimeKey, steeringRevision)) {
          await appendProjectAgentEvent({
            projectId: input.projectId,
            turnId,
            type: "toolResult",
            content: "已被补充指令中断，结果未纳入上下文。",
            data: { status: "interrupted", executionId, toolCallEventId: (await ensureToolEvent()).id, name: decision.name },
          }, dataDir);
          continue;
        }
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId,
          type: "toolResult",
          content: message,
          data: { status: "failed", executionId, toolCallEventId: (await ensureToolEvent()).id, name: decision.name },
        }, dataDir);
        if (input.signal?.aborted) throw new ProjectAgentTurnError(message, "tool_failed");
        // Match cc-haha's Agent loop: an ordinary tool failure is a tool
        // result for the model to reason over, not a terminal Turn failure.
        continue;
      }
    }
    throw new ProjectAgentTurnError(`Agent Turn 达到 ${maxTurns} 轮安全上限`, "tool_failed");
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : "项目 Agent 执行失败";
    if (!input.signal?.aborted) {
      await runMainLifecycleForFailure?.("StopFailure", {
        error: failureMessage,
      }).catch(() => undefined);
    }
    await runMainLifecycleForFailure?.("SessionEnd", {
      reason: input.signal?.aborted ? "aborted" : "failed",
      error: failureMessage,
    }).catch(() => undefined);
    await clearProjectAgentAnswerDraft({ projectId: input.projectId, turnId }, dataDir).catch(() => undefined);
    if (input.signal?.aborted) {
      await stopDelegatedWorkForTurn(input.projectId, turnId, dataDir).catch(() => undefined);
      if (executionId) {
        await stopRunningAgentCommands(input.projectId, executionId).catch(() => undefined);
      }
    }
    await appendProjectAgentEvent({
      projectId: input.projectId,
      turnId,
      type: "status",
      data: { stage: input.signal?.aborted ? "stopped" : "failed", error: failureMessage },
    }, dataDir).catch(() => undefined);
    if (executionId) {
      if (input.signal?.aborted) {
        await stopExecutionIfNeeded(input.projectId, executionId, dataDir).catch(() => undefined);
      } else {
        await failExecutionIfNeeded(input.projectId, executionId, failureMessage, dataDir).catch(() => undefined);
      }
    }
    if (error instanceof ProjectAgentTurnError) throw error;
    if (error instanceof AgentCommandError) {
      throw new ProjectAgentTurnError(error.message, "tool_failed", error);
    }
    throw new ProjectAgentTurnError("项目 Agent 执行失败", "model_failed", error);
  } finally {
    runtime.activeProjects.delete(projectRuntimeKey);
  }
}

async function drainProjectAgentQueuedMessages(projectId: string, turnId: string, dataDir: string) {
  for (;;) {
    const message = await dequeueProjectAgentMessage(projectId, { turnId }, dataDir);
    if (!message) return;
    if (message.kind === "user") {
      await appendProjectAgentEvent({
        projectId,
        turnId,
        type: "user",
        content: message.content,
        data: {
          ...message.data,
          source: typeof message.data?.source === "string" ? message.data.source : "queue",
          queueMessageId: message.id,
          priority: message.priority,
        },
      }, dataDir);
      continue;
    }
    await appendProjectAgentEvent({
      projectId,
      turnId,
      type: "toolResult",
      content: message.content,
      data: {
        ...message.data,
        backgroundTaskNotification: true,
        queueMessageId: message.id,
        priority: message.priority,
      },
    }, dataDir);
  }
}

async function enqueueAsyncHookRewake(input: {
  projectId: string;
  turnId: string;
  executionId: string;
  prompt: string;
  model: string;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  permissionMode: ZenmeSessionPermissionMode;
  result: ProjectAgentHookRuntimeResult;
  dataDir: string;
  callModel: typeof callProjectAgentModel;
  executeTool: typeof executeAgentWorkspaceTool;
  listMcpTools: typeof listProjectMcpTools;
  callMcpTool: typeof callProjectMcpTool;
}) {
  const message = await enqueueProjectAgentMessage({
    projectId: input.projectId,
    turnId: input.turnId,
    kind: "task-notification",
    priority: "now",
    content: `异步 Hook 阻止了继续执行：${input.result.reason || input.result.additionalContext || "Hook 以退出码 2 结束"}`,
    data: {
      status: "failed",
      executionId: input.executionId,
      name: "async_hook",
      asyncRewake: true,
    },
  }, input.dataDir);
  const projectRuntimeKey = `${input.dataDir}\u0000${input.projectId}`;
  const activeJob = runtime.jobs.get(projectRuntimeKey);
  const wakeIfStillQueued = async () => {
    const queued = await listProjectAgentMessages(input.projectId, input.dataDir);
    if (!queued.some((candidate) => candidate.id === message.id)) return;
    await startProjectAgentTurnRun({
      projectId: input.projectId,
      prompt: input.prompt,
      model: input.model,
      turnId: input.turnId,
      resume: true,
      reasoningEffort: input.reasoningEffort,
      modelSpeed: input.modelSpeed,
      permissionMode: input.permissionMode,
    }, {
      dataDir: input.dataDir,
      callModel: input.callModel,
      executeTool: input.executeTool,
      listMcpTools: input.listMcpTools,
      callMcpTool: input.callMcpTool,
    }).catch(() => undefined);
  };
  if (activeJob) {
    void activeJob.promise.finally(wakeIfStillQueued);
  } else if (!runtime.activeProjects.has(projectRuntimeKey)) {
    void wakeIfStillQueued();
  }
}

function scheduleBackgroundTaskSettlement(input: {
  args: string[];
  commandId: string;
  dataDir: string;
  executable: string;
  command?: string;
  executionId: string;
  projectId: string;
  turnId: string;
  callModel?: typeof callProjectAgentModel;
}) {
  const monitorKey = backgroundMonitorKey(input.dataDir, input.projectId, input.commandId);
  if (runtime.backgroundMonitors.has(monitorKey)) return;
  runtime.backgroundMonitors.add(monitorKey);
  void (async () => {
    try {
      const task = await waitForAgentBackgroundTaskCompletion(
        input.projectId,
        input.commandId,
        input.dataDir,
      );
      const output = {
        id: task.id,
        status: task.status,
        exitCode: task.exitCode,
        error: task.error,
        stdout: tailText(task.stdout ?? "", 4_000),
        stderr: tailText(task.stderr ?? "", 4_000),
        completedAt: task.completedAt,
        outputFilePath: task.outputFilePath,
      };
      const notificationContent = `后台任务${backgroundSettlementLabel(task.status)}：${summarizeCommandResult(input.executable, input.args, output, input.command)}${task.outputFilePath ? `\n完整输出：${task.outputFilePath}` : ""}`;
      await enqueueProjectAgentMessage({
        projectId: input.projectId,
        turnId: input.turnId,
        kind: "task-notification",
        priority: "later",
        dedupeKey: `background:${input.commandId}`,
        content: notificationContent,
        data: {
          status: task.status === "succeeded" ? "succeeded" : "failed",
          executionId: input.executionId,
          name: "shell_command",
          output,
          backgroundTaskNotification: true,
        },
      }, input.dataDir);
      await dispatchProjectAgentNotificationHook({
        projectId: input.projectId,
        turnId: input.turnId,
        executionId: input.executionId,
        notificationType: "background_task",
        title: "后台任务已结束",
        message: notificationContent,
        dataDir: input.dataDir,
        callModel: input.callModel,
      }).catch(() => undefined);
      await wakeProjectAgentForQueuedNotification({
        projectId: input.projectId,
        turnId: input.turnId,
        dataDir: input.dataDir,
        callModel: input.callModel,
      });
    } catch {
      // The persisted task remains authoritative. A later session read can
      // reconcile it even if this best-effort notification cannot be written.
    } finally {
      runtime.backgroundMonitors.delete(monitorKey);
    }
  })();
}

async function notifyProjectAgentCommandStall(input: {
  projectId: string;
  turnId: string;
  executionId: string;
  stall: AgentCommandStall;
  dataDir: string;
  callModel?: typeof callProjectAgentModel;
}) {
  const tail = tailText(input.stall.tail, 1_024);
  const content = [
    "后台命令可能正在等待交互输入。请停止该任务，并使用管道输入或对应的非交互参数重新执行；不要轮询任务列表。",
    tail ? `最近输出：\n${tail}` : "",
    input.stall.outputFilePath ? `完整输出：${input.stall.outputFilePath}` : "",
  ].filter(Boolean).join("\n");
  await enqueueProjectAgentMessage({
    projectId: input.projectId,
    turnId: input.turnId,
    kind: "task-notification",
    priority: "next",
    dedupeKey: `background-stall:${input.stall.commandId}`,
    content,
    data: {
      status: "running",
      executionId: input.executionId,
      name: "shell_command",
      commandId: input.stall.commandId,
      outputFilePath: input.stall.outputFilePath,
      elapsedMs: input.stall.elapsedMs,
      backgroundTaskNotification: true,
      interactivePromptDetected: true,
    },
  }, input.dataDir);
  await dispatchProjectAgentNotificationHook({
    projectId: input.projectId,
    turnId: input.turnId,
    executionId: input.executionId,
    notificationType: "background_task",
    title: "后台命令等待交互输入",
    message: content,
    dataDir: input.dataDir,
    callModel: input.callModel,
  }).catch(() => undefined);
  void wakeProjectAgentForQueuedNotification({
    projectId: input.projectId,
    turnId: input.turnId,
    dataDir: input.dataDir,
    callModel: input.callModel,
  }).catch(() => undefined);
}

async function wakeProjectAgentForQueuedNotification(input: {
  projectId: string;
  turnId: string;
  dataDir: string;
  callModel?: typeof callProjectAgentModel;
}) {
  const projectRuntimeKey = `${input.dataDir}\u0000${input.projectId}`;
  const activeJob = runtime.jobs.get(projectRuntimeKey);
  if (activeJob) await activeJob.promise.catch(() => undefined);
  for (let attempt = 0; attempt < 600 && runtime.activeProjects.has(projectRuntimeKey); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  if (runtime.activeProjects.has(projectRuntimeKey)) return;
  const queued = await listProjectAgentMessages(input.projectId, input.dataDir);
  if (!queued.some((message) => message.turnId === input.turnId && message.kind === "task-notification")) return;
  const session = await getProjectAgentSession(input.projectId, input.dataDir);
  const userEvent = session.events.find((event) => event.turnId === input.turnId && event.type === "user");
  const contextSnapshot = parseAgentContextSnapshot(userEvent?.data?.contextSnapshot);
  const conversationId = userEvent?.conversationId;
  const conversationRuntimeState = getProjectAgentConversationRuntimeState(session, conversationId);
  const model = (typeof userEvent?.data?.model === "string" ? userEvent.data.model : undefined)
    || session.context.modelId;
  if (!model) return;
  await startProjectAgentTurnRun({
    projectId: input.projectId,
    turnId: input.turnId,
    prompt: userEvent?.content?.trim() || "继续处理后台任务通知",
    model,
    contextSnapshot,
    canvasContext: typeof userEvent?.data?.canvasContext === "string" ? userEvent.data.canvasContext : undefined,
    currentNodeContext: typeof userEvent?.data?.currentNodeContext === "string" ? userEvent.data.currentNodeContext : undefined,
    connectedGraphContext: typeof userEvent?.data?.connectedGraphContext === "string" ? userEvent.data.connectedGraphContext : undefined,
    conversationId,
    parentTurnId: userEvent?.parentTurnId,
    sourceNodeId: userEvent?.sourceNodeId,
    resultNodeId: userEvent?.resultNodeId,
    selectedNodeIds: Array.isArray(userEvent?.data?.selectedNodeIds)
      ? userEvent.data.selectedNodeIds.filter((value): value is string => typeof value === "string")
      : [],
    fileDocumentIds: Array.isArray(userEvent?.data?.fileDocumentIds)
      ? userEvent.data.fileDocumentIds.filter((value): value is string => typeof value === "string")
      : [],
    resume: true,
    reasoningEffort: optionalReasoningEffort(userEvent?.data?.reasoningEffort),
    modelSpeed: optionalModelSpeed(userEvent?.data?.modelSpeed),
    permissionMode: conversationRuntimeState.permissionMode,
  }, {
    dataDir: input.dataDir,
    callModel: input.callModel,
  });
}

function scheduleSubagentSettlement(input: {
  agentId: string;
  dataDir: string;
  executionId: string;
  name: string;
  projectId: string;
  teamId: string;
  turnId: string;
  callModel?: typeof callProjectAgentModel;
}) {
  const monitorKey = `${input.dataDir}\u0000${input.projectId}\u0000agent:${input.agentId}`;
  if (runtime.backgroundMonitors.has(monitorKey)) return;
  runtime.backgroundMonitors.add(monitorKey);
  void (async () => {
    try {
      const { waitForDelegatedOrchestrationRun } = await import("@/lib/global-agent/delegated-runtime");
      const orchestration = await waitForDelegatedOrchestrationRun(input.projectId, input.teamId, input.dataDir);
      const task = orchestration?.tasks.find((candidate) => candidate.id === input.agentId);
      if (!task || !["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status)) return;
      const succeeded = task.status === "succeeded";
      const content = succeeded
        ? `Sub-agent“${input.name}”已完成：${task.resultSummary?.trim() || "任务已完成，未提供摘要。"}`
        : `Sub-agent“${input.name}”${task.status}：${task.error?.trim() || task.resultSummary?.trim() || "未提供详情。"}`;
      await enqueueProjectAgentMessage({
        projectId: input.projectId,
        turnId: input.turnId,
        kind: "task-notification",
        priority: "later",
        dedupeKey: `subagent:${input.agentId}:${task.completedAt ?? task.updatedAt}`,
        content,
        data: {
          status: succeeded ? "succeeded" : "failed",
          executionId: input.executionId,
          name: "agent_spawn",
          output: {
            teamId: input.teamId,
            agentId: input.agentId,
            name: input.name,
            status: task.status,
            completedAt: task.completedAt,
            resultSummary: task.resultSummary,
            error: task.error,
            changeSetIds: task.changeSetIds,
          },
        },
      }, input.dataDir);
      await dispatchProjectAgentNotificationHook({
        projectId: input.projectId,
        turnId: input.turnId,
        executionId: input.executionId,
        notificationType: "subagent_task",
        title: `Sub-agent“${input.name}”${succeeded ? "已完成" : "已结束"}`,
        message: content,
        dataDir: input.dataDir,
        callModel: input.callModel,
      }).catch(() => undefined);
      const projectRuntimeKey = `${input.dataDir}\u0000${input.projectId}`;
      for (let attempt = 0; attempt < 20 && runtime.activeProjects.has(projectRuntimeKey); attempt += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      const session = await getProjectAgentSession(input.projectId, input.dataDir);
      const latestStatus = [...session.events].reverse().find((event) =>
        event.turnId === input.turnId && event.type === "status");
      await drainProjectAgentQueuedMessages(input.projectId, input.turnId, input.dataDir);
      if (latestStatus) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId: input.turnId,
          type: "status",
          data: { ...latestStatus.data },
        }, input.dataDir);
      }
    } catch {
      // Persisted Agent and Team state remains authoritative. Reconciliation
      // can surface it on the next session read if notification delivery fails.
    } finally {
      runtime.backgroundMonitors.delete(monitorKey);
    }
  })();
}

function scheduleWorkflowSettlement(input: {
  dataDir: string;
  executionId: string;
  name: string;
  projectId: string;
  runId: string;
  taskId: string;
  turnId: string;
  callModel?: typeof callProjectAgentModel;
}) {
  const monitorKey = `${input.dataDir}\u0000${input.projectId}\u0000workflow:${input.runId}`;
  if (runtime.backgroundMonitors.has(monitorKey)) return;
  runtime.backgroundMonitors.add(monitorKey);
  void (async () => {
    try {
      const { waitForProjectAgentWorkflow } = await import("@/lib/agent/workflow-runner");
      const run = await waitForProjectAgentWorkflow(input.projectId, input.runId, input.dataDir);
      if (!run.completedAt || !["succeeded", "failed", "stopped"].includes(run.status)) return;
      const succeeded = run.status === "succeeded";
      const outcome = run.outcome;
      const result = outcome?.result === undefined
        ? ""
        : typeof outcome.result === "string" ? outcome.result : JSON.stringify(outcome.result);
      const detail = succeeded
        ? (tailText(result, 4_000).trim() || `已完成 ${outcome?.agentCount ?? 0} 个 Agent 任务。`)
        : (run.error?.trim() || outcome?.error?.trim() || "未提供详情。");
      const notificationContent = `Workflow“${input.name}”${succeeded ? "已完成" : run.status === "stopped" ? "已停止" : "失败"}：${detail}`;
      await enqueueProjectAgentMessage({
        projectId: input.projectId,
        turnId: input.turnId,
        kind: "task-notification",
        priority: "later",
        dedupeKey: `workflow:${run.id}:${run.completedAt}`,
        content: notificationContent,
        data: {
          status: succeeded ? "succeeded" : "failed",
          executionId: input.executionId,
          name: "workflow",
          output: {
            runId: run.id,
            taskId: input.taskId,
            workflowName: run.name,
            status: run.status,
            completedAt: run.completedAt,
            outcome: run.outcome,
            error: run.error,
          },
        },
      }, input.dataDir);
      await dispatchProjectAgentNotificationHook({
        projectId: input.projectId,
        turnId: input.turnId,
        executionId: input.executionId,
        notificationType: "workflow_task",
        title: `Workflow“${input.name}”${succeeded ? "已完成" : "已结束"}`,
        message: notificationContent,
        dataDir: input.dataDir,
        callModel: input.callModel,
      }).catch(() => undefined);
      await drainNotificationAfterActiveTurn(input.projectId, input.turnId, input.dataDir);
    } catch {
      // Persisted Workflow state remains authoritative and is reconciled when
      // the project session is read again.
    } finally {
      runtime.backgroundMonitors.delete(monitorKey);
    }
  })();
}

async function dispatchProjectAgentNotificationHook(input: {
  projectId: string;
  turnId: string;
  executionId: string;
  notificationType: string;
  message: string;
  title?: string;
  dataDir: string;
  callModel?: typeof callProjectAgentModel;
}) {
  const detail = await getAgentExecution(input.projectId, input.executionId, input.dataDir);
  const hooks = detail?.context.agentHooks;
  if (!detail || !hooks?.Notification?.length) return;
  const session = await getProjectAgentSession(input.projectId, input.dataDir);
  const turnEvent = session.events.find((event) => event.turnId === input.turnId && event.type === "user");
  const eventModel = typeof turnEvent?.data?.model === "string" ? turnEvent.data.model : undefined;
  const model = eventModel || session.context.modelId || "";
  await runProjectAgentLifecycleHooks({
    projectId: input.projectId,
    executionId: input.executionId,
    event: "Notification",
    hooks,
    rootId: detail.context.workspaceRootId,
    model,
    reasoningEffort: optionalReasoningEffort(turnEvent?.data?.reasoningEffort),
    modelSpeed: optionalModelSpeed(turnEvent?.data?.modelSpeed),
    callModel: input.callModel ?? callProjectAgentModel,
    dataDir: input.dataDir,
    matchQuery: input.notificationType,
    payload: {
      message: input.message,
      ...(input.title ? { title: input.title } : {}),
      notification_type: input.notificationType,
    },
  });
}

async function drainNotificationAfterActiveTurn(projectId: string, turnId: string, dataDir: string) {
  const projectRuntimeKey = `${dataDir}\u0000${projectId}`;
  for (let attempt = 0; attempt < 20 && runtime.activeProjects.has(projectRuntimeKey); attempt += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  const session = await getProjectAgentSession(projectId, dataDir);
  const latestStatus = [...session.events].reverse().find((event) =>
    event.turnId === turnId && event.type === "status");
  await drainProjectAgentQueuedMessages(projectId, turnId, dataDir);
  if (latestStatus) {
    await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { ...latestStatus.data } }, dataDir);
  }
}

export async function reconcileProjectAgentBackgroundNotifications(
  projectId: string,
  dataDir = getZenmeDataDir(),
  _options: {
    callModel?: typeof callProjectAgentModel;
    executeTool?: typeof executeAgentWorkspaceTool;
  } = {},
) {
  await listAgentBackgroundTasks(projectId, dataDir);
  const [details, initialSession] = await Promise.all([
    listAgentExecutions(projectId, dataDir),
    getProjectAgentSession(projectId, dataDir),
  ]);
  const notifiedTaskKeys = new Set(initialSession.events.flatMap((event) => {
    if (event.data?.backgroundTaskNotification !== true || !event.data.output || typeof event.data.output !== "object") return [];
    const id = (event.data.output as { id?: unknown }).id;
    return typeof id === "string" ? [`${event.turnId}:${id}`] : [];
  }));
  const notifiedSubagentRuns = new Set(initialSession.events.flatMap((event) => {
    if (event.data?.backgroundTaskNotification !== true || event.data.name !== "agent_spawn" ||
      !event.data.output || typeof event.data.output !== "object") return [];
    const output = event.data.output as { agentId?: unknown; completedAt?: unknown };
    if (typeof output.agentId !== "string") return [];
    return [`${output.agentId}:${typeof output.completedAt === "string" ? output.completedAt : "legacy"}`];
  }));
  const notifiedWorkflowRuns = new Set(initialSession.events.flatMap((event) => {
    if (event.data?.backgroundTaskNotification !== true || event.data.name !== "workflow" ||
      !event.data.output || typeof event.data.output !== "object") return [];
    const output = event.data.output as { runId?: unknown; completedAt?: unknown };
    if (typeof output.runId !== "string") return [];
    return [`${output.runId}:${typeof output.completedAt === "string" ? output.completedAt : "legacy"}`];
  }));
  const backgroundTurnsByCommandId = new Map<string, Set<string>>();
  for (const event of initialSession.events) {
    if (event.type !== "toolResult" || !isProjectAgentShellCommandTool(event.data?.name) ||
      !event.data?.output || typeof event.data.output !== "object") continue;
    const output = event.data.output as { id?: unknown; status?: unknown };
    if (typeof output.id === "string" && output.status === "running") {
      const turnIds = backgroundTurnsByCommandId.get(output.id) ?? new Set<string>();
      turnIds.add(event.turnId);
      backgroundTurnsByCommandId.set(output.id, turnIds);
    }
  }
  const { listAgentWorkflowRuns } = await import("@/lib/agent/workflow-run-store");
  for (const run of await listAgentWorkflowRuns(projectId, dataDir)) {
    if (!run.turnId || !initialSession.events.some((event) => event.turnId === run.turnId)) continue;
    const runKey = `${run.id}:${run.completedAt ?? "legacy"}`;
    if (notifiedWorkflowRuns.has(runKey) || notifiedWorkflowRuns.has(`${run.id}:legacy`)) continue;
    scheduleWorkflowSettlement({
      projectId,
      turnId: run.turnId,
      executionId: run.executionId,
      runId: run.id,
      taskId: run.taskId,
      name: run.name,
      dataDir,
      callModel: _options.callModel,
    });
  }
  const { listGlobalOrchestrations, refreshGlobalOrchestration } = await import("@/lib/global-agent/orchestration-store");
  const orchestrations = await listGlobalOrchestrations(projectId, dataDir);
  for (const persistedOrchestration of orchestrations) {
    const orchestration = await refreshGlobalOrchestration(projectId, persistedOrchestration.id, dataDir);
    if (!orchestration.parentTurnId || !initialSession.events.some((event) => event.turnId === orchestration.parentTurnId)) continue;
    for (const task of orchestration.tasks) {
      if (!task.agentExecutionId || !["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status)) continue;
      const runKey = `${task.id}:${task.completedAt ?? task.updatedAt}`;
      if (notifiedSubagentRuns.has(runKey) || notifiedSubagentRuns.has(`${task.id}:legacy`)) continue;
      const succeeded = task.status === "succeeded";
      const notificationContent = succeeded
        ? `Sub-agent“${task.name ?? task.title}”已完成：${task.resultSummary?.trim() || "任务已完成，未提供摘要。"}`
        : `Sub-agent“${task.name ?? task.title}”${task.status}：${task.error?.trim() || task.resultSummary?.trim() || "未提供详情。"}`;
      await enqueueProjectAgentMessage({
        projectId,
        turnId: orchestration.parentTurnId,
        kind: "task-notification",
        priority: "later",
        dedupeKey: `subagent:${runKey}`,
        content: notificationContent,
        data: {
          status: succeeded ? "succeeded" : "failed",
          executionId: task.agentExecutionId,
          name: "agent_spawn",
          output: {
            teamId: orchestration.id,
            agentId: task.id,
            name: task.name ?? task.title,
            status: task.status,
            completedAt: task.completedAt,
            resultSummary: task.resultSummary,
            error: task.error,
            changeSetIds: task.changeSetIds,
          },
          reconciled: true,
        },
      }, dataDir);
      await dispatchProjectAgentNotificationHook({
        projectId,
        turnId: orchestration.parentTurnId,
        executionId: details.find((detail) =>
          detail.resultNodeId === orchestration.parentTurnId && !detail.context.orchestrationId)?.id ?? task.agentExecutionId,
        notificationType: "subagent_task",
        title: `Sub-agent“${task.name ?? task.title}”${succeeded ? "已完成" : "已结束"}`,
        message: notificationContent,
        dataDir,
        callModel: _options.callModel,
      }).catch(() => undefined);
      await drainProjectAgentQueuedMessages(projectId, orchestration.parentTurnId, dataDir);
      notifiedSubagentRuns.add(runKey);
    }
  }
  for (const detail of details) {
    for (const command of detail.commandRequests) {
      if (command.status === "approved" || command.status === "proposed") continue;
      const observedTurnIds = [...(backgroundTurnsByCommandId.get(command.id) ?? [])];
      if (!observedTurnIds.length && detail.resultNodeId) observedTurnIds.push(detail.resultNodeId);
      const validTurnIds = observedTurnIds.filter((turnId) =>
        initialSession.events.some((event) => event.turnId === turnId));
      if (!validTurnIds.length) continue;
      const hasStartedBackgroundEvent = backgroundTurnsByCommandId.has(command.id);
      // A foreground command can be converted in place to a background task
      // after the interaction budget expires. Older persisted records did not
      // always flip command.background to true or persist resultNodeId on the
      // owning Execution, so the durable Session result is the authority for
      // both background lifecycle and Turn ownership.
      if (!hasStartedBackgroundEvent) continue;
      if (command.status === "running") {
        if (runtime.backgroundMonitors.has(backgroundMonitorKey(dataDir, projectId, command.id))) continue;
        const turnId = validTurnIds.at(-1)!;
        scheduleBackgroundTaskSettlement({
          projectId,
          turnId,
          executionId: detail.id,
          commandId: command.id,
          executable: command.executable,
          args: command.args,
          command: command.command,
          dataDir,
          callModel: _options.callModel,
        });
        continue;
      }
      const output = {
        id: command.id,
        status: command.status,
        exitCode: command.exitCode,
        error: command.error,
        stdout: tailText(command.stdout ?? "", 4_000),
        stderr: tailText(command.stderr ?? "", 4_000),
        completedAt: command.completedAt,
        outputFilePath: command.outputFilePath,
      };
      const notificationContent = `后台任务${backgroundSettlementLabel(command.status)}：${summarizeCommandResult(command.executable, command.args, output, command.command)}${command.outputFilePath ? `\n完整输出：${command.outputFilePath}` : ""}`;
      for (const turnId of validTurnIds) {
        const taskKey = `${turnId}:${command.id}`;
        if (notifiedTaskKeys.has(taskKey)) continue;
        await enqueueProjectAgentMessage({
          projectId,
          turnId,
          kind: "task-notification",
          priority: "later",
          dedupeKey: `background:${turnId}:${command.id}`,
          content: notificationContent,
          data: {
            status: command.status === "succeeded" ? "succeeded" : "failed",
            executionId: detail.id,
            name: "shell_command",
            output,
            reconciled: true,
          },
        }, dataDir);
        await dispatchProjectAgentNotificationHook({
          projectId,
          turnId,
          executionId: detail.id,
          notificationType: "background_task",
          title: "后台任务已结束",
          message: notificationContent,
          dataDir,
          callModel: _options.callModel,
        }).catch(() => undefined);
        await drainProjectAgentQueuedMessages(projectId, turnId, dataDir);
        const refreshedSession = await getProjectAgentSession(projectId, dataDir);
        const notification = [...refreshedSession.events].reverse().find((event) =>
          event.turnId === turnId && event.data?.backgroundTaskNotification === true &&
          isObject(event.data.output) && event.data.output.id === command.id);
        const latestStatus = [...initialSession.events].reverse().find((event) => event.turnId === turnId && event.type === "status");
        if (notification && (latestStatus?.sequence ?? 0) < notification.sequence && latestStatus) {
          await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { ...latestStatus.data } }, dataDir);
        }
        notifiedTaskKeys.add(taskKey);
      }
    }
  }
}

function optionalReasoningEffort(value: unknown): ZenmeReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : undefined;
}

function optionalModelSpeed(value: unknown): ZenmeModelSpeed | undefined {
  return value === "standard" || value === "fast" ? value : undefined;
}

function backgroundMonitorKey(dataDir: string, projectId: string, commandId: string) {
  return `${dataDir}\u0000${projectId}\u0000${commandId}`;
}

function backgroundSettlementLabel(status: string) {
  if (status === "succeeded") return "已完成";
  if (status === "stopped") return "已停止";
  if (status === "timedOut") return "已超时";
  return "失败";
}

function createTurnThinkingReporter(input: {
  dataDir: string;
  projectId: string;
  turnId: string;
}) {
  let pending = "";
  let lastWriteAt = 0;
  let writeChain = Promise.resolve();

  const emit = async (force: boolean) => {
    const now = Date.now();
    if (!pending.trim()) return;
    if (!force && pending.length < 80 && !pending.includes("\n") && now - lastWriteAt < 750) return;
    const content = pending.trim();
    pending = "";
    lastWriteAt = now;
    writeChain = writeChain.then(async () => {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "thinking",
        content,
      }, input.dataDir);
    }).catch(() => undefined);
    await writeChain;
  };

  return {
    push: async (delta: string) => {
      pending += delta;
      await emit(false);
    },
    flush: async () => {
      await emit(true);
      await writeChain;
    },
  };
}

function createTurnAnswerDraftReporter(input: {
  dataDir: string;
  projectId: string;
  turnId: string;
}) {
  let content = "";
  let lastPersisted = "";
  let lastWriteAt = 0;
  let visible: boolean | null = null;
  let writeChain = Promise.resolve();

  const persist = async (force: boolean) => {
    const first = content.trimStart()[0];
    if (visible === null && first) visible = first !== "{" && first !== "[";
    if (!visible || !content.trim() || content === lastPersisted) return;
    const now = Date.now();
    if (!force && lastPersisted && content.length - lastPersisted.length < 48 && now - lastWriteAt < 250) return;
    const snapshot = content;
    lastPersisted = snapshot;
    lastWriteAt = now;
    writeChain = writeChain.then(async () => {
      await upsertProjectAgentAnswerDraft({
        projectId: input.projectId,
        turnId: input.turnId,
        content: snapshot,
      }, input.dataDir);
    }).catch(() => undefined);
    await writeChain;
  };

  return {
    push: async (delta: string) => {
      content += delta;
      await persist(false);
    },
    flush: async () => {
      await persist(true);
      await writeChain;
    },
    clear: async () => {
      await writeChain;
      await clearProjectAgentAnswerDraft({
        projectId: input.projectId,
        turnId: input.turnId,
      }, input.dataDir).catch(() => undefined);
    },
  };
}

async function applyAgentChangeSetIfAuthorized(
  projectId: string,
  output: unknown,
  permissionMode: ZenmeSessionPermissionMode,
  dataDir: string,
  onFilesChanged?: (paths: string[]) => Promise<void> | void,
) {
  if (permissionMode === "untrusted" || !isObject(output) || typeof output.changeSetId !== "string") return output;
  await approveWorkspaceChangeSet(projectId, output.changeSetId, dataDir);
  const applied = await applyWorkspaceChangeSet(projectId, output.changeSetId, dataDir);
  const changedPaths = [...new Set(applied.operations.flatMap((operation) => [
    operation.relativePath,
    ...(operation.targetRelativePath ? [operation.targetRelativePath] : []),
  ]))];
  if (changedPaths.length) await onFilesChanged?.(changedPaths);
  return { ...output, status: "applied" };
}

async function compactBeforeTurnIfNeeded(input: {
  projectId: string;
  conversationId?: string;
  model: string;
  contextWindow: number;
  callModel: typeof callProjectAgentModel;
  signal?: AbortSignal;
  turnId: string;
  executionId?: string;
  hooks?: ProjectAgentHooks;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  trigger?: "auto" | "manual";
  customInstructions?: string;
  force?: boolean;
}, dataDir: string) {
  const trigger = input.trigger ?? "auto";
  const session = await getProjectAgentSession(input.projectId, dataDir);
  const modelContext = await getProjectAgentModelContext(input.projectId, dataDir, input.conversationId);
  const effectiveTokens = Math.max(
    input.conversationId ? 0 : session.context.inputTokens,
    input.conversationId ? modelContext.estimatedConversationTokens : modelContext.estimatedTokens,
  );
  if (!input.force && trigger === "auto" && (
    !shouldCompactProjectAgentContext({ contextWindowTokens: input.contextWindow, effectiveTokens }) ||
    !canAttemptProjectAgentCompaction(session, input.conversationId)
  )) return { status: "not_needed" as const };
  const compactConfig = trigger === "manual" || input.force
    ? { minTokens: 1, minTextMessages: 1, maxTokens: 1 }
    : undefined;
  const plan = input.conversationId
    ? planProjectAgentConversationCompaction(session, input.conversationId, compactConfig)
    : planProjectAgentCompaction(session, compactConfig);
  if (!plan) return { status: "not_needed" as const };
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    conversationId: input.conversationId,
    type: "status",
    data: {
      stage: "compacting",
      sourceTokenEstimate: plan.sourceTokenEstimate,
    },
  }, dataDir);
  let checkpointId = "";
  try {
    if (input.executionId && input.hooks) {
      const preCompact = await runProjectAgentLifecycleHooks({
        projectId: input.projectId,
        executionId: input.executionId,
        event: "PreCompact",
        hooks: input.hooks,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        modelSpeed: input.modelSpeed,
        callModel: input.callModel,
        signal: input.signal,
        dataDir,
        payload: {
          trigger,
          customInstructions: input.customInstructions || null,
          sourceTokenEstimate: plan.sourceTokenEstimate,
          compactedThroughSequence: plan.compactedThroughSequence,
        },
      });
      if (preCompact?.permission === "deny" || preCompact?.preventContinuation) {
        throw new Error(preCompact.reason || "PreCompact Hook 已阻止上下文压缩");
      }
      if (preCompact?.additionalContext) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId: input.turnId,
          conversationId: input.conversationId,
          type: "toolResult",
          content: preCompact.additionalContext,
          data: { name: "PreCompact", hookLifecycle: true, status: "succeeded" },
        }, dataDir);
      }
    }
    const response = await input.callModel({
      context: serializeCompactionSource(plan.previousSummary, plan.eventsToSummarize),
      model: input.model,
      prompt: compactionPrompt(input.customInstructions),
      signal: input.signal,
    });
    if (!response.text.trim()) throw new Error("empty_summary");
    if (input.conversationId) {
      checkpointId = crypto.randomUUID();
      await updateProjectAgentConversationContext({
        projectId: input.projectId,
        conversationId: input.conversationId,
        summary: response.text,
        compactedThroughSequence: plan.compactedThroughSequence,
      }, dataDir);
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        conversationId: input.conversationId,
        type: "compact",
        content: response.text,
        data: {
          scope: "conversation",
          checkpointId,
          compactedThroughSequence: plan.compactedThroughSequence,
          sourceTokenEstimate: plan.sourceTokenEstimate,
        },
      }, dataDir);
    } else {
      const checkpoint = await createProjectAgentCompactCheckpoint({
        projectId: input.projectId,
        turnId: input.turnId,
        summary: response.text,
        compactedThroughSequence: plan.compactedThroughSequence,
        sourceTokenEstimate: plan.sourceTokenEstimate,
      }, dataDir);
      checkpointId = checkpoint.id;
    }
  } catch {
    await recordProjectAgentCompactionFailure({
      projectId: input.projectId,
      conversationId: input.conversationId,
      code: "summary_failed",
    }, dataDir);
    return { status: "failed" as const };
  }
  if (input.executionId && input.hooks) {
    const postCompact = await runProjectAgentLifecycleHooks({
      projectId: input.projectId,
      executionId: input.executionId,
      event: "PostCompact",
      hooks: input.hooks,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      modelSpeed: input.modelSpeed,
      callModel: input.callModel,
      signal: input.signal,
      dataDir,
      payload: {
        trigger,
        customInstructions: input.customInstructions || null,
        compactedThroughSequence: plan.compactedThroughSequence,
        sourceTokenEstimate: plan.sourceTokenEstimate,
        checkpointId,
      },
    });
    if (postCompact?.additionalContext) {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        conversationId: input.conversationId,
        type: "toolResult",
        content: postCompact.additionalContext,
        data: { name: "PostCompact", hookLifecycle: true, status: "succeeded" },
      }, dataDir);
    }
    if (postCompact?.permission === "deny" || postCompact?.preventContinuation) {
      throw new Error(postCompact.reason || "PostCompact Hook 要求停止继续处理");
    }
  }
  return { status: "compacted" as const, checkpointId };
}

export function parseProjectTurnDecision(value: string, mcpTools: readonly ProjectMcpTool[] = []): ProjectTurnDecision | null {
  const candidate = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!candidate.startsWith("{")) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return null; }
  if (!isObject(parsed) || typeof parsed.type !== "string") return null;
  if (parsed.type === "complete" && typeof parsed.summary === "string" && parsed.summary.trim()) {
    return { type: "complete", summary: parsed.summary.slice(0, 100_000) };
  }
  if (parsed.type === "tool") {
    const mcpCall = parseProjectMcpToolCall(mcpTools, parsed.name, parsed.arguments);
    if (mcpCall) return { type: "tool", name: mcpCall.name, arguments: mcpCall.arguments };
    const toolCall = parseAgentToolCall(parsed.name, parsed.arguments);
    if (toolCall) return { type: "tool", name: toolCall.name, arguments: toolCall.arguments };
  }
  if (parsed.type === "command" && typeof parsed.executable === "string" &&
    Array.isArray(parsed.args) && parsed.args.every((item) => typeof item === "string") && typeof parsed.reason === "string") {
    return {
      type: "tool",
      name: "shell_command",
      arguments: {
        executable: parsed.executable,
        args: parsed.args,
        cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
        rootId: typeof parsed.rootId === "string" ? parsed.rootId : undefined,
        timeoutMs: typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined,
        ...(parsed.run_in_background === true || parsed.background === true ? { run_in_background: true } : {}),
        reason: parsed.reason,
      },
    };
  }
  return null;
}

function formatMcpToolContext(
  availableTools: readonly ProjectMcpTool[],
  activeTools: readonly ProjectMcpTool[],
) {
  if (!availableTools.length) return "";
  if (!activeTools.length) {
    return `当前 Project 有 ${availableTools.length} 个 MCP 工具可通过 tool_search 按需发现；未发现前不要猜测或调用其内部名称。`;
  }
  return [
    `当前 Turn 已通过 tool_search 激活以下 MCP 工具（另有 ${Math.max(0, availableTools.length - activeTools.length)} 个仍延迟加载）：`,
    ...activeTools.map((tool) => `- ${tool.name}: ${tool.description}\n  JSON Schema：${JSON.stringify(tool.parameters)}`),
  ].join("\n");
}

export function restoreActiveMcpToolNames(
  events: ProjectAgentEvent[],
  turnId: string,
  availableTools: readonly ProjectMcpTool[],
) {
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const activeNames = new Set<string>();
  for (const event of events) {
    if (event.turnId !== turnId || event.type !== "toolResult" || event.data?.name !== "tool_search") continue;
    const output = event.data.output;
    if (!isObject(output) || !Array.isArray(output.tools)) continue;
    for (const tool of output.tools) {
      if (!isObject(tool) || typeof tool.name !== "string" || !availableNames.has(tool.name as McpToolName)) continue;
      activeNames.add(tool.name);
    }
  }
  return activeNames;
}

export function restoreActiveBuiltInToolNames(
  events: ProjectAgentEvent[],
  turnId: string,
) {
  const activeNames = new Set<AgentWorkspaceToolName>();
  for (const event of events) {
    if (event.turnId !== turnId || event.type !== "toolResult" || event.data?.name !== "tool_search") continue;
    const output = event.data.output;
    if (!isObject(output) || !Array.isArray(output.tools)) continue;
    for (const tool of output.tools) {
      if (
        !isObject(tool)
        || typeof tool.name !== "string"
        || !DEFERRED_MODEL_AGENT_TOOL_NAMES.has(tool.name as AgentWorkspaceToolName)
      ) continue;
      activeNames.add(tool.name as AgentWorkspaceToolName);
    }
  }
  return activeNames;
}

export function projectTurnDecisionFromNativeToolCall(
  toolCall: { name: string; arguments: unknown } | undefined,
  mcpTools: readonly ProjectMcpTool[] = [],
): ProjectTurnDecision | null {
  if (!toolCall) return null;
  const mcpCall = parseProjectMcpToolCall(mcpTools, toolCall.name, toolCall.arguments);
  if (mcpCall) return { type: "tool", name: mcpCall.name, arguments: mcpCall.arguments };
  const parsed = parseAgentToolCall(toolCall.name, toolCall.arguments);
  if (!parsed) return null;
  return { type: "tool", name: parsed.name, arguments: parsed.arguments };
}

function streamedToolSignature(toolCall: { name: string; arguments: unknown }) {
  return `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
}

async function appendStreamedToolOutcomes(input: {
  projectId: string;
  turnId: string;
  executionId?: string;
  outcomes: StreamedToolOutcome[];
  superseded: boolean;
  permissionMode: ZenmeSessionPermissionMode;
  interruptedContent?: string;
  dataDir: string;
  onFilesChanged?: (paths: string[]) => Promise<void> | void;
  callModel?: typeof callProjectAgentModel;
}) {
  const finalized: FinalizedStreamedToolOutcome[] = [];
  for (const outcome of input.outcomes) {
    if (input.superseded) {
      if (isObject(outcome.output) && typeof outcome.output.changeSetId === "string") {
        await rejectWorkspaceChangeSet(input.projectId, outcome.output.changeSetId, input.dataDir).catch(() => undefined);
      }
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "toolResult",
        content: input.interruptedContent ?? "已被补充指令中断，结果未纳入上下文。",
        data: {
          status: "interrupted",
          executionId: input.executionId,
          toolCallEventId: outcome.event.id,
          name: outcome.decision.name,
        },
      }, input.dataDir);
    } else if (outcome.error) {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "toolResult",
        content: outcome.error,
        data: {
          status: "failed",
          executionId: input.executionId,
          toolCallEventId: outcome.event.id,
          name: outcome.decision.name,
        },
      }, input.dataDir);
    } else {
      const output = await applyAgentChangeSetIfAuthorized(
        input.projectId,
        outcome.output,
        input.permissionMode,
        input.dataDir,
        input.onFilesChanged,
      );
      if (outcome.decision.name === "shell_command" && isAgentCommandRequest(output) && output.status === "proposed") {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId: input.turnId,
          type: "approval",
          content: output.reason,
          data: {
            status: "pending",
            executionId: input.executionId,
            commandRequestId: output.id,
            command: output.command,
            executable: output.executable,
            args: output.args,
            cwd: output.cwd,
            rootId: output.rootId,
            externalRoot: output.externalRoot,
            sandboxMode: output.sandboxMode,
          },
        }, input.dataDir);
        finalized.push({ outcome, output });
        continue;
      }
      const waitingInput = outcome.decision.name === "ask_user_question" || outcome.decision.name === "exit_plan_mode";
      const toolSucceeded = !(outcome.decision.name === "shell_command" && isAgentCommandRequest(output))
        || ["succeeded", "running"].includes(output.status);
      const content = waitingInput && isObject(output)
        ? outcome.decision.name === "exit_plan_mode" && typeof output.plan === "string"
          ? output.plan
          : typeof output.question === "string" ? output.question : summarizeToolResult(outcome.decision.name, output)
        : summarizeToolResult(outcome.decision.name, output);
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "toolResult",
        content,
        data: {
          status: waitingInput ? "waitingInput" : toolSucceeded ? "succeeded" : "failed",
          executionId: input.executionId,
          toolCallEventId: outcome.event.id,
          name: outcome.decision.name,
          output,
        },
      }, input.dataDir);
      finalized.push({ outcome, output });
      if (outcome.decision.name === "shell_command" && isAgentCommandRequest(output)
          && output.status === "running" && input.executionId) {
        scheduleBackgroundTaskSettlement({
          projectId: input.projectId,
          turnId: input.turnId,
          executionId: input.executionId,
          commandId: output.id,
          executable: output.executable,
          args: output.args,
          command: output.command,
          dataDir: input.dataDir,
          callModel: input.callModel,
        });
      }
    }
  }
  return finalized;
}

async function settleStreamedToolOutcomes(
  executor: StreamingToolExecutor<StreamedToolOutcome>,
) {
  const settled = await Promise.all(executor.list().map((entry) => entry.outcome));
  return settled.flatMap((outcome) => outcome.status === "succeeded" ? [outcome.value] : []);
}

async function resolveTurnModel(
  projectId: string,
  model: string,
  permissionMode: ZenmeSessionPermissionMode | undefined,
  dataDir: string,
  conversationId?: string,
) {
  const settings = await getLocalSettings(dataDir);
  const session = await getProjectAgentSession(projectId, dataDir);
  const conversationRuntimeState = getProjectAgentConversationRuntimeState(session, conversationId);
  const selection = resolveProviderModelSelection(model, settings.modelProviders, "text");
  if (!selection) throw new ProjectAgentTurnError("模型不可用", "invalid_input");
  const config = selection.provider.models.find((item) => item.id === selection.modelId);
  return {
    contextWindow: config?.contextWindow || selection.provider.contextWindows[selection.modelId] || DEFAULT_CONTEXT_WINDOW,
    permissionMode: permissionMode ?? conversationRuntimeState.permissionMode ?? settings.defaultSessionPermissionMode,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.defaultReasoningEffort,
    modelSpeed: settings.defaultModelSpeed,
  };
}

async function recordUsage(projectId: string, model: string, contextWindow: number, response: ProjectAgentModelResponse, dataDir: string) {
  const usage = response.usage;
  const estimatedTokens = usage?.totalTokens ??
    (await getProjectAgentModelContext(projectId, dataDir)).estimatedTokens;
  await updateProjectAgentContext({
    projectId,
    modelId: model,
    contextWindowTokens: contextWindow,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    estimatedEffectiveTokens: estimatedTokens,
  }, dataDir);
}

function buildTurnContext(
  context: Awaited<ReturnType<typeof getProjectAgentModelContext>>,
  memories: Awaited<ReturnType<typeof getRelevantConfirmedMemoryContext>>,
  relevantKnowledge: KnowledgeSearchResult[],
  canvasContext?: string,
  permissionMode: ZenmeSessionPermissionMode = "onRequest",
  _activeBackgroundTasks: Awaited<ReturnType<typeof listAgentBackgroundTasks>> = [],
  availableSkills: Awaited<ReturnType<typeof listProjectSkills>> = [],
  availableAgents: Awaited<ReturnType<typeof listProjectAgentDefinitions>> = [],
  projectInstructions: Awaited<ReturnType<typeof loadProjectAgentInstructions>> = [],
  workspaceBinding: Awaited<ReturnType<typeof getLocalWorkspaceBinding>> = null,
  acceptedContinuousSuggestions: ContinuousAgentSuggestion[] = [],
  outputStylePrompt?: string,
  currentNodeContext?: string,
  connectedGraphContext?: string,
) {
  void _activeBackgroundTasks;
  const contextLayers = createAgentContextLayers({
    projectSummary: context.summary,
    conversationSummary: context.conversationSummary,
    conversationEvents: context.events,
    currentNodeContext,
    connectedGraphContext,
    prompt: [...context.events].reverse().find((event) => event.type === "user")?.content ?? "",
  });
  return [
    `默认会话权限：${permissionMode}。${permissionMode === "untrusted" ? "允许安全读取和生成待审阅 ChangeSet；执行命令必须逐次批准。" : permissionMode === "neverAsk" ? "禁止请求审批；受阻动作直接失败。" : "需要提升权限时请求用户批准。"} Zenme 的 ChangeSet 与命令审批硬边界始终有效。`,
    context.interactionMode === "plan"
      ? `当前处于规划模式。只允许读取、搜索、观察、提问、维护计划以及只读 MCP 工具；除 @plan/PLAN.md 外禁止修改文件，禁止执行 Shell、启动 Sub-agent 或调用有外部副作用的工具。使用 write_file/edit_file 持续维护 @plan/PLAN.md；彻底探索现有实现和同类模式，形成具体且可验证的实施计划。存在关键歧义时调用 ask_user_question；计划完成后调用 exit_plan_mode，并把文件中的最终计划放入 plan 参数请求用户批准。批准前不得开始实施。${context.activePlan ? `\n当前待修订计划：\n${context.activePlan}` : ""}`
      : "当前处于普通执行模式。enter_plan_mode 会切换到受限的只读规划状态；是否需要进入规划模式由你根据当前目标、风险和已有信息自行判断。",
    workspaceBinding ? `当前项目 Workspace 根目录（工具参数中的 rootId 必须使用这里的稳定 ID；未传 rootId 的精确读写默认主根，glob_files/search_files 默认跨全部可读根）：\n${JSON.stringify(listWorkspaceRoots(workspaceBinding).map((root) => ({
      rootId: root.id,
      primary: root.primary,
      displayName: root.displayName,
      status: root.status,
      permissions: root.permissions,
      git: root.git,
    })))}` : "当前项目尚未绑定 Workspace。",
    contextLayers.project.summary ? `Project 背景摘要（跨 Conversation，仅作长期背景）：\n${contextLayers.project.summary}` : "",
    contextLayers.conversation.summary
      ? `当前 Conversation 摘要（当前分支的连续对话历史）：\n${contextLayers.conversation.summary}`
      : "",
    context.clearedToolResultEventIds.length
      ? `Microcompact 边界：已将 ${context.clearedToolResultEventIds.length} 个旧的、可重建工具结果替换为占位符，约节省 ${context.microcompactTokensSaved} tokens；最近工具结果及审批、任务、记忆等状态仍完整保留。`
      : "",
    context.taskPlan.length ? `当前 Agent 任务计划（跨 Turn、跨上下文压缩保留）：\n${JSON.stringify(context.taskPlan)}` : "",
    acceptedContinuousSuggestions.length ? `已由用户采纳的 Continuous Global Agent 建议（这是基于项目事件的工作提示，不代表已经执行；仅在与当前请求相关且确实需要结构化协作时纳入共享项目任务。任何文件修改、命令和外部动作仍必须使用工具并遵守当前权限、审批与 Workspace 范围）：\n${JSON.stringify(acceptedContinuousSuggestions.map((suggestion) => ({
      id: suggestion.id,
      kind: suggestion.kind,
      title: suggestion.title,
      summary: suggestion.summary,
      rationale: suggestion.rationale,
      sourceEventIds: suggestion.sourceEventIds,
      acceptedAt: suggestion.updatedAt,
    })))}` : "",
    memories.length ? `与当前请求相关的已确认 Project Memory：\n${JSON.stringify(memories)}` : "",
    relevantKnowledge.length ? `自动召回的相关 Project Knowledge（需要更多细节时调用 search_knowledge）：\n${formatRelevantProjectKnowledge(relevantKnowledge)}` : "",
    availableSkills.length ? `当前可用技能（需要其专门指令时调用 skill 加载）：\n${formatProjectSkillListing(availableSkills)}` : "",
    availableAgents.length ? `当前可用自定义 Agent（调用 agent_spawn 时用 agentType 选择；其系统提示、工具边界和模型配置由运行时加载，不要复述定义正文）：\n${formatProjectAgentDefinitionListing(availableAgents)}` : "",
    outputStylePrompt ? `当前输出风格指令（只影响回答表达，不得覆盖工具、权限、安全或验证协议）：\n${outputStylePrompt}` : "",
    formatProjectAgentInstructions(projectInstructions),
    formatAgentCanvasContext({
      currentNodeContext: contextLayers.currentNode?.content,
      connectedGraphContext: contextLayers.graph.connectedContext,
      legacyCanvasContext: canvasContext,
    }),
    contextLayers.conversation.events.some((event) => ["approval", "compact"].includes(event.type))
      ? `当前运行时状态事件：\n${JSON.stringify(contextLayers.conversation.events.filter((event) => ["approval", "compact"].includes(event.type)))}`
      : "",
  ].filter(Boolean).join("\n\n");
}

function projectAgentToolsForMode(
  mode: "default" | "plan",
  activeBuiltInToolNames: ReadonlySet<AgentWorkspaceToolName> = new Set(),
  permissionRules: readonly ProjectPermissionRule[] = [],
) {
  return MODEL_AGENT_TOOL_DEFINITIONS
    .map((definition) => definition.name)
    .filter((name) => !DEFERRED_MODEL_AGENT_TOOL_NAMES.has(name) || activeBuiltInToolNames.has(name))
    .filter((name) => !isProjectToolBlanketDenied(name, permissionRules))
    .filter((name) => mode === "plan"
      ? PLAN_MODE_ALLOWED_TOOLS.has(name)
      : name !== "exit_plan_mode");
}

function isPlanModeToolAllowed(name: AgentWorkspaceToolName | McpToolName, mcpTools: readonly ProjectMcpTool[]) {
  if (isMcpToolName(name)) return Boolean(mcpTools.find((tool) => tool.name === name)?.readOnly);
  return PLAN_MODE_ALLOWED_TOOLS.has(name);
}

function formatRelevantProjectKnowledge(results: readonly KnowledgeSearchResult[]) {
  return JSON.stringify(results.map((result) => ({
    id: result.entity.id,
    kind: result.entity.kind,
    title: result.entity.title,
    relativePath: result.entity.relativePath,
    score: Number(result.score.toFixed(4)),
    evidence: result.evidence,
    excerpt: result.matchedChunk?.text ?? result.entity.text.slice(0, 1_600),
  })));
}

function buildTurnInstruction(
  prompt: string,
  research: TurnResearchState,
) {
  const backgroundInstruction = "Shell 默认前台执行；run_in_background=true 会立即返回 taskId 与 outputFilePath，前台长命令也可能由运行时把同一进程转为后台。后台终态会主动通知；task_list 是项目工作项列表，不是 Shell 进程列表。";
  const teamInstruction = "team_create + agent_spawn 可建立持续存在、可寻址的具名成员；delegate_tasks 提供一次性并行 Sub-agent。根据当前协作目标自行选择。agent_spawn mode='plan' 会让成员先进入只读计划协议：成员返回 teammateName、requestId 与 plan 后，负责人必须用 send_message 的 plan_approval_response 明确批准或拒绝；拒绝时 feedback 必填，批准后成员才获得写入和执行工具。后台成员完成时会主动通知。send_message 可按成员名称定向，to='*' 只广播纯文本；结构化消息不能广播；存在活跃、待审批或等待输入的成员时不得 team_delete。";
  const browserInstruction = "Browser 只操作用户提供或工具输出中真实出现的 URL；不得扫描端口、猜测 localhost 地址或用 Browser 代替 Shell 管理开发服务。";
  const workflowInstruction = "只有用户明确要求运行 Workflow、多 Agent 编排，或已加载的 Skill 明确要求时，才可调用 workflow；普通开发、启动服务、检查状态和单次委派不得自行升级为 Workflow。Workflow 启动前只批准一次，运行期间不要轮询，结束后会主动通知。";
  return [
    `当前用户请求：${prompt}`,
    "如果可以直接回答，返回普通文本，或返回 {\"type\":\"complete\",\"summary\":\"...\"}。",
    "web_search 用于发现未知候选 URL；若已经有明确 URL，可直接用 web_fetch 读取。web_search 返回的来源可以作为引用候选，但搜索摘要不等于已读取页面正文。",
    research.usedSearch
      ? `本轮已搜索 ${research.searchQueries.size} 个查询并读取 ${research.fetchedEvidence.length} 个页面。把这些数据视为当前 observation，自行判断下一步。`
      : "本轮尚未使用网页工具。",
    "web_search 只发现候选 URL，web_fetch 才读取页面正文。自行根据问题风险、证据质量和冲突情况决定是否继续检索，不按固定来源数或关键词规则停止。",
    "必须用 web_fetch 阅读实际采用的页面。读取完成后，基于正文进行综合总结：直接回答用户问题，提炼共同事实，合并重复信息，区分时间与事件，并在来源冲突时明确说明。",
    "最终回答不得复述 web_search 列表、工具输出或逐条摘抄网页。来源链接不是回答主体；可以不附链接。若附链接，只能引用本轮 web_search 或 web_fetch 实际返回的 URL。",
    research.correction ? `上一次完成回答被运行时拒绝：${research.correction} 请继续调用必要工具后重新作答。` : "",
    "workspace_status 提供 Workspace/Git 状态摘要；git_diff 读取 Git 变更正文。根据当前问题选择需要的观察工具，不要把其中一个当成另一个的固定前置步骤。",
    "仅当缺少的信息会显著改变结果且不能通过工具发现时，调用 ask_user_question；当前 Turn 会暂停，用户回答后会作为工具结果写回并继续同一 Turn。",
    "需要真实执行命令时调用 shell_command；Workspace 外绝对 cwd 会触发目录授权。",
    backgroundInstruction,
    browserInstruction,
    teamInstruction,
    workflowInstruction,
    "当独立并行工作能显著帮助完成目标时可调用 delegate_tasks；给每个 Sub-agent 清晰目标和最小必要范围。Sub-agent 不得递归委派。",
    "task_create/task_list/task_get/task_update 管理共享项目工作项；它们不查询后台进程，也不代替实际执行。是否需要任务结构由你根据当前目标决定。",
    "上下文中若存在已采纳的 Continuous Global Agent 建议，只在它与当前请求相关且需要结构化协作时才创建项目任务，并把它视为待验证的工作提示；不得把建议描述当作已完成事实，也不得绕过工具、权限或审批直接执行。",
    "工具通过服务商原生 function/tool calling 提供；必须使用原生工具调用，不要输出工具 JSON、伪造工具结果或把命令写成教程。",
  ].filter(Boolean).join("\n");
}

type TurnResearchState = {
  usedSearch: boolean;
  searchQueries: Set<string>;
  citationUrls: Set<string>;
  fetchedEvidence: Array<{
    url: string;
    title?: string;
    summary: string;
    claims: unknown[];
  }>;
  correction: string;
  answerRetryCount: number;
};

function createTurnResearchState(): TurnResearchState {
  return {
    usedSearch: false,
    searchQueries: new Set<string>(),
    citationUrls: new Set<string>(),
    fetchedEvidence: [],
    correction: "",
    answerRetryCount: 0,
  };
}

function updateTurnResearchState(
  state: TurnResearchState,
  name: AgentWorkspaceToolName,
  argumentsValue: Record<string, unknown>,
  output: unknown,
) {
  state.correction = "";
  if (name === "web_search") {
    state.usedSearch = true;
    const query = typeof argumentsValue.query === "string" ? argumentsValue.query.trim().toLocaleLowerCase() : "";
    if (query) state.searchQueries.add(query);
    if (isObject(output) && Array.isArray(output.sources)) {
      for (const source of output.sources) {
        const url = typeof source === "string"
          ? source
          : isObject(source) && typeof source.url === "string"
            ? source.url
            : "";
        if (url) state.citationUrls.add(normalizeCitationUrl(url));
      }
    }
    return;
  }
  if (name !== "web_fetch" || !isObject(output)) return;
  const requestedUrl = typeof argumentsValue.url === "string" ? argumentsValue.url : "";
  const finalUrl = typeof output.finalUrl === "string" ? output.finalUrl : "";
  if (requestedUrl) state.citationUrls.add(normalizeCitationUrl(requestedUrl));
  if (finalUrl) state.citationUrls.add(normalizeCitationUrl(finalUrl));
  state.fetchedEvidence.push({
    url: finalUrl || requestedUrl,
    ...(typeof output.title === "string" ? { title: output.title } : {}),
    summary: typeof output.summary === "string" ? output.summary : "",
    claims: Array.isArray(output.claims) ? output.claims : [],
  });
}

function validateResearchAnswer(answer: string, state: TurnResearchState) {
  if (!state.usedSearch && state.citationUrls.size === 0) return "";
  const unverified = unverifiedResearchUrls(answer, state);
  if (unverified.length) return `最终答案引用了本轮网页工具未返回的来源：${unverified.slice(0, 3).join("、")}`;
  return "";
}

function unverifiedResearchUrls(answer: string, state: TurnResearchState) {
  const citedUrls = [...new Set(answer.match(/https?:\/\/[^\s<>)\]}"']+/g) ?? [])]
    .map((url) => normalizeCitationUrl(url));
  return citedUrls.filter((url) => !state.citationUrls.has(url));
}

function removeUnverifiedResearchLinks(answer: string, state: TurnResearchState) {
  const unverified = new Set(unverifiedResearchUrls(answer, state));
  if (!unverified.size) return answer;
  return answer
    .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, (match, label: string, url: string) =>
      unverified.has(normalizeCitationUrl(url)) ? label : match)
    .replace(/<?https?:\/\/[^\s<>)\]}"']+>?/g, (url) => {
      const bareUrl = url.startsWith("<") && url.endsWith(">") ? url.slice(1, -1) : url;
      return unverified.has(normalizeCitationUrl(bareUrl)) ? "" : url;
    })
    .replace(/[ \t]+([，。；：！？,.!?;:])/g, "$1")
    .trim();
}

function normalizeCitationUrl(value: string) {
  try {
    const url = new URL(value.replace(/[.,;:!?，。；：！？]+$/, ""));
    url.hash = "";
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/, "");
    return url.toString();
  } catch {
    return value;
  }
}

function serializeCompactionSource(summary: string, events: unknown[]) {
  const projectedEvents = events.flatMap((event) => {
    if (!event || typeof event !== "object") return [];
    const projected = projectAgentEventForCompaction(event as ProjectAgentEvent);
    return projected ? [projected] : [];
  });
  return `${summary ? `旧摘要：\n${summary}\n\n` : ""}待压缩事件：\n${JSON.stringify(projectedEvents)}`;
}

const COMPACTION_PROMPT = [
  "请把上下文整理为可继续执行项目工作的结构化摘要，只返回摘要正文。",
  "必须保留：用户明确要求、关键决策、已修改或读取的文件、工具结果结论、错误与修复、待审批事项、未完成任务、当前工作和下一步。",
  "不要把未经确认的推断写成事实，不要调用工具。",
].join("\n");

function compactionPrompt(customInstructions?: string) {
  const instructions = customInstructions?.trim();
  if (!instructions) return COMPACTION_PROMPT;
  return `${COMPACTION_PROMPT}\n\n用户本次压缩的附加要求：\n${instructions.slice(0, 20_000)}`;
}

function formatContextUsage(input: {
  scope: "project" | "conversation";
  model: string;
  contextWindow: number;
  effectiveTokens: number;
  estimatedProjectionTokens: number;
  providerReportedInputTokens: number;
  compactAtTokens: number;
  reservedOutputTokens: number;
  compactBufferTokens: number;
  checkpointCount: number;
  hasActiveSummary: boolean;
  activeEventCount: number;
  microcompactTokensSaved: number;
}) {
  const remaining = Math.max(0, input.contextWindow - input.effectiveTokens);
  const untilCompact = Math.max(0, input.compactAtTokens - input.effectiveTokens);
  const percentage = input.contextWindow > 0
    ? ((input.effectiveTokens / input.contextWindow) * 100).toFixed(1)
    : "0.0";
  return [
    "## 上下文使用情况",
    "",
    `- 范围：${input.scope === "conversation" ? "当前 Conversation" : "整个 Project Session"}`,
    `- 模型：${input.model}`,
    `- 有效上下文：约 ${formatTokenCount(input.effectiveTokens)} / ${formatTokenCount(input.contextWindow)} tokens（${percentage}%）`,
    `- 模型投影估算：约 ${formatTokenCount(input.estimatedProjectionTokens)} tokens`,
    `- 服务商最近报告输入：${formatTokenCount(input.providerReportedInputTokens)} tokens`,
    `- 距自动压缩阈值：约 ${formatTokenCount(untilCompact)} tokens`,
    `- 上下文剩余空间：约 ${formatTokenCount(remaining)} tokens`,
    `- 输出预留：${formatTokenCount(input.reservedOutputTokens)} tokens；压缩缓冲：${formatTokenCount(input.compactBufferTokens)} tokens`,
    `- 当前有效事件：${input.activeEventCount}；压缩检查点：${input.checkpointCount}；活动摘要：${input.hasActiveSummary ? "有" : "无"}`,
    `- Microcompact 已节省：约 ${formatTokenCount(input.microcompactTokensSaved)} tokens`,
  ].join("\n");
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("zh-CN").format(Math.max(0, Math.round(value)));
}

function isContextOverflowError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /context[_ -]?length[_ -]?exceeded|prompt (?:is )?too long|上下文过长|超过.{0,12}上下文|context window/i.test(message);
}

function isMaxOutputTokensModelError(error: unknown) {
  if (error instanceof ProjectAgentModelStreamError) return error.code === "max_output_tokens";
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /max[_ -]?output[_ -]?tokens|output token limit|输出.{0,12}(?:长度|token).{0,12}(?:上限|限制)/i.test(message);
}

function summarizeToolResult(name: string, output: unknown) {
  if (name === "shell_command" && isAgentCommandRequest(output)) {
    return summarizeCommandResult(output.executable, output.args, output, output.command);
  }
  if (name === "view_image" && isObject(output)) {
    const relativePath = typeof output.relativePath === "string" ? output.relativePath : "图片";
    const dimensions = typeof output.width === "number" && typeof output.height === "number"
      ? `（${output.width}×${output.height}）`
      : "";
    return `已观察图片：${relativePath}${dimensions}`;
  }
  if (name === "code_diagnostics" && isObject(output)) {
    if (output.available === false) return `代码诊断不可用：${String(output.reason ?? "未找到支持的项目配置")}`;
    const errors = typeof output.errorCount === "number" ? output.errorCount : 0;
    const warnings = typeof output.warningCount === "number" ? output.warningCount : 0;
    const diagnostics = Array.isArray(output.diagnostics) ? output.diagnostics : [];
    return `代码诊断完成：${errors} 个错误，${warnings} 个警告${diagnostics.length ? `。${JSON.stringify(diagnostics).slice(0, 3_500)}` : ""}`;
  }
  if (name === "code_intelligence" && isObject(output)) {
    if (output.available === false) return `代码语义导航不可用：${String(output.reason ?? "项目暂不支持语义分析")}`;
    const items = Array.isArray(output.items) ? output.items : [];
    return `代码语义导航完成：${String(output.operation ?? "查询")} 返回 ${items.length} 项${items.length ? `。${JSON.stringify(items).slice(0, 3_500)}` : ""}`;
  }
  if (name === "web_search" && isObject(output)) {
    const sources = Array.isArray(output.sources) ? output.sources : [];
    return `网页搜索完成，发现 ${sources.length} 个候选来源；重要事实仍需读取正文验证。`;
  }
  if (name === "web_fetch" && isObject(output)) {
    const title = typeof output.title === "string" ? output.title : "网页";
    const finalUrl = typeof output.finalUrl === "string" ? output.finalUrl : "";
    return `已读取：${title}${finalUrl ? `（${finalUrl}）` : ""}`;
  }
  if (name === "browser" && isObject(output)) {
    if (output.closed === true) return "浏览器验证会话已关闭";
    const title = typeof output.title === "string" && output.title ? output.title : "本地预览";
    const url = typeof output.url === "string" ? output.url : "";
    const elementCount = Array.isArray(output.elements) ? output.elements.length : 0;
    return `已观察页面：${title}${url ? `（${url}）` : ""}，可交互元素 ${elementCount} 个`;
  }
  if (name === "delegate_tasks" && isObject(output) && Array.isArray(output.tasks)) {
    return `并行 Sub-agent 已返回：${output.tasks.map((task) => isObject(task) ? `${String(task.title ?? "任务")}=${String(task.status ?? "unknown")}` : "任务=unknown").join("；")}`;
  }
  if (name === "team_create" && isObject(output)) {
    return `已创建 Agent Team：${String(output.teamName ?? output.teamId ?? "未命名")}`;
  }
  if (name === "agent_spawn" && isObject(output)) {
    return `Sub-agent 已在后台启动：${String(output.name ?? output.agentId ?? "未命名")}`;
  }
  if (name === "send_message" && isObject(output)) {
    const recipients = Array.isArray(output.recipients) ? output.recipients.join("、") : "";
    return recipients ? `团队消息已送达：${recipients}` : "团队消息未送达";
  }
  if (name === "team_delete" && isObject(output)) {
    return String(output.message ?? (output.success ? "Agent Team 已关闭" : "Agent Team 尚未关闭"));
  }
  const serialized = JSON.stringify(output);
  return `${name} 完成：${serialized.slice(0, 4_000)}`;
}

function projectPromptShellFailure(command: AgentCommandRequest, pattern: string) {
  if (command.status === "stopped") return `Skill 嵌入命令已中断（${pattern}）：[Command interrupted]`;
  const output = formatProjectPromptShellOutput(command);
  return `Skill 嵌入命令失败（${pattern}）${output ? `：${output}` : command.error ? `：${command.error}` : ""}`;
}

async function collectTurnWorkspaceImages(input: {
  cache: Map<string, string>;
  dataDir: string;
  events: readonly ProjectAgentEvent[];
  projectId: string;
}) {
  const paths = input.events.flatMap((event) => {
    if (event.type !== "toolResult" || event.data?.name !== "view_image" || event.data.status !== "succeeded") return [];
    const output = isObject(event.data.output) ? event.data.output : null;
    return typeof output?.relativePath === "string" ? [output.relativePath] : [];
  });
  const uniqueLatest = [...new Set(paths.reverse())].slice(0, 4).reverse();
  const dataUrls: string[] = [];
  for (const relativePath of uniqueLatest) {
    let dataUrl = input.cache.get(relativePath);
    if (!dataUrl) {
      dataUrl = await readWorkspaceImage(input.projectId, relativePath, input.dataDir)
        .then((image) => image.dataUrl)
        .catch(() => undefined);
      if (dataUrl) input.cache.set(relativePath, dataUrl);
    }
    if (dataUrl) dataUrls.push(dataUrl);
  }
  return dataUrls;
}

function summarizeCommandResult(executable: string, args: string[], output: { status: string; stdout?: string; stderr?: string }, command?: string) {
  const detail = output.status === "succeeded" || output.status === "running"
    ? output.stdout?.trim() || output.stderr?.trim() || output.status
    : output.stderr?.trim() || output.stdout?.trim() || output.status;
  return tailText(`${formatCommand(executable, args, command)}\n${detail}`, 4_000);
}

export function formatCommandProgress(stdout: string, stderr: string) {
  const content = [stdout.trim(), stderr.trim() ? `[stderr]\n${stderr.trim()}` : ""].filter(Boolean).join("\n");
  return content ? tailText(content, 4_000) : "命令仍在运行，暂无输出";
}

function formatWorkflowProgress(event: AgentWorkflowProgressEvent) {
  if (event.type === "workflow_phase") return `Workflow 阶段：${event.title}`;
  if (event.type === "workflow_log") return tailText(event.message, 4_000);
  const phase = event.phase ? `（${event.phase}）` : "";
  const state = event.state === "queued" ? "等待中"
    : event.state === "running" ? "运行中"
      : event.state === "succeeded" ? "已完成" : "失败";
  const detail = event.error || event.resultPreview;
  return `${event.label}${phase}：${state}${detail ? `\n${tailText(detail, 4_000)}` : ""}`;
}

function tailText(value: string, limit: number) {
  return value.length <= limit ? value : `…${value.slice(-(limit - 1))}`;
}

function formatCommand(executable: string, args: string[], command?: string) {
  return command ?? [executable, ...args].join(" ");
}

async function finishExecutionIfNeeded(projectId: string, executionId: string | undefined, summary: string, dataDir: string) {
  if (!executionId) return;
  await completeAgentExecution({ projectId, executionId, status: "succeeded", resultSummary: summary }, dataDir);
}

async function failExecutionIfNeeded(
  projectId: string,
  executionId: string | undefined,
  error: string,
  dataDir: string,
  status: "failed" | "timedOut" = "failed",
) {
  if (!executionId) return;
  const current = await getAgentExecution(projectId, executionId, dataDir);
  if (!current || current.status !== "running") return;
  await completeAgentExecution({
    projectId,
    executionId,
    status,
    error,
    resultSummary: error,
  }, dataDir);
}

async function stopExecutionIfNeeded(projectId: string, executionId: string, dataDir: string) {
  const current = await getAgentExecution(projectId, executionId, dataDir);
  if (!current || current.status !== "running") return;
  await stopAgentExecution(projectId, executionId, dataDir);
}

async function recoverRunningParentExecutionId(projectId: string, turnId: string, dataDir: string) {
  const executions = await listAgentExecutions(projectId, dataDir);
  return executions.find((execution) =>
    execution.resultNodeId === turnId &&
    execution.status === "running" &&
    !execution.context.orchestrationId
  )?.id;
}

async function stopDelegatedWorkForTurn(projectId: string, turnId: string, dataDir: string) {
  const session = await getProjectAgentSession(projectId, dataDir);
  const [{ listAgentWorkflowRuns }, { stopProjectAgentWorkflowTask }] = await Promise.all([
    import("@/lib/agent/workflow-run-store"),
    import("@/lib/agent/workflow-runner"),
  ]);
  const workflowRuns = await listAgentWorkflowRuns(projectId, dataDir);
  await Promise.all(workflowRuns
    .filter((run) => run.turnId === turnId && (run.status === "queued" || run.status === "running"))
    .map((run) => stopProjectAgentWorkflowTask(projectId, run.taskId, dataDir)));
  const orchestrationIds = new Set(session.events.flatMap((event) => {
    if (event.turnId !== turnId) return [];
    const statusId = typeof event.data?.orchestrationId === "string" ? event.data.orchestrationId : undefined;
    const output = isObject(event.data?.output) ? event.data.output : undefined;
    const outputId = typeof output?.orchestrationId === "string" ? output.orchestrationId : undefined;
    return [statusId, outputId].filter((value): value is string => Boolean(value));
  }));
  if (!orchestrationIds.size) return;
  const [{ stopDelegatedOrchestrationRun }, { getGlobalOrchestration, stopGlobalOrchestration }] = await Promise.all([
    import("@/lib/global-agent/delegated-runtime"),
    import("@/lib/global-agent/orchestration-store"),
  ]);
  await Promise.all([...orchestrationIds].map(async (orchestrationId) => {
    stopDelegatedOrchestrationRun(projectId, orchestrationId, dataDir);
    const current = await getGlobalOrchestration(projectId, orchestrationId, dataDir);
    // Parent cancellation is authoritative. A child can race the abort and
    // briefly aggregate its AbortError as a failed orchestration; normalize
    // that transient state to stopped as part of the same cancellation.
    if (current && !["completed", "stopped"].includes(current.status)) {
      await stopGlobalOrchestration(projectId, orchestrationId, dataDir);
    }
  }));
}

async function appendProjectAgentQuestionAnswer(input: {
  eventId: string;
  projectId: string;
  turnId: string;
  value?: string;
  answers?: Record<string, string>;
  annotations?: ProjectAgentQuestionAnswer["annotations"];
}, dataDir: string): Promise<{
  browserAction?: Record<string, unknown>;
  workflowAction?: Record<string, unknown>;
  mcpAction?: { name: McpToolName; arguments: Record<string, unknown> };
}> {
  const legacyAnswer = input.value?.trim() ?? "";
  if (!input.eventId.trim() || input.eventId.length > 200) {
    throw new ProjectAgentTurnError("用户回答无效", "invalid_input");
  }
  const session = await getProjectAgentSession(input.projectId, dataDir);
  const conversationId = session.events.find((event) =>
    event.turnId === input.turnId && event.type === "user" && event.conversationId,
  )?.conversationId;
  const latestStage = [...session.events].reverse().find((event) => event.turnId === input.turnId && event.type === "status")?.data?.stage;
  const questionEvent = session.events.find((event) =>
    event.id === input.eventId && event.turnId === input.turnId && event.type === "toolResult" &&
    ["ask_user_question", "exit_plan_mode"].includes(String(event.data?.name)) &&
    event.data?.status === "waitingInput",
  );
  const livePending = runtime.pendingElicitations.has(
    pendingElicitationKey(dataDir, input.projectId, input.turnId, input.eventId),
  );
  if ((!livePending && latestStage !== "waitingInput") || !questionEvent) {
    throw new ProjectAgentTurnError("当前 Turn 没有等待回答的问题", "invalid_input");
  }
  const questionOutput = isObject(questionEvent.data?.output) ? questionEvent.data.output : {};
  const toolName = String(questionEvent.data?.name) as "ask_user_question" | "exit_plan_mode";
  const question = typeof questionOutput.question === "string" ? questionOutput.question : questionEvent.content ?? "";
  const questions = Array.isArray(questionOutput.questions)
    ? questionOutput.questions.filter(isObject).flatMap((item) => typeof item.question === "string" ? [item.question] : [])
    : question ? [question] : [];
  const suppliedAnswers = input.answers && isStringRecord(input.answers) ? input.answers : undefined;
  const answers = suppliedAnswers ?? (legacyAnswer && question ? { [question]: legacyAnswer } : {});
  const annotations = input.annotations && isQuestionAnnotationRecord(input.annotations) ? input.annotations : undefined;
  if (!Object.keys(answers).length || Object.entries(answers).some(([key, value]) =>
    !key.trim() || !value.trim() || key.length > 20_000 || value.length > 20_000) ||
    questions.some((item) => !answers[item]?.trim())) {
    throw new ProjectAgentTurnError("用户回答无效", "invalid_input");
  }
  const answer = question ? answers[question] ?? legacyAnswer : legacyAnswer || Object.values(answers)[0] || "";
  const answerSummary = Object.entries(answers).map(([questionText, value]) => `${questionText} → ${value}`).join("\n");
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    type: "toolResult",
    content: `用户回答：\n${answerSummary}`,
    data: {
      executionId: questionEvent.data?.executionId,
      name: toolName,
      questionEventId: questionEvent.id,
      status: "succeeded",
      toolCallEventId: questionEvent.data?.toolCallEventId,
      output: {
        ...questionOutput,
        answer,
        answers,
        ...(annotations ? { annotations } : {}),
        status: "answered",
      },
    },
  }, dataDir);
  if (toolName === "exit_plan_mode") {
    if (conversationId) {
      await updateProjectAgentConversationContext({
        projectId: input.projectId,
        conversationId,
        interactionMode: answer === "批准并开始实施" ? "default" : "plan",
      }, dataDir);
    } else {
      await updateProjectAgentContext({
        projectId: input.projectId,
        interactionMode: answer === "批准并开始实施" ? "default" : "plan",
      }, dataDir);
    }
    return {};
  }
  if (answer === "允许一次") {
    const parsed = parseAgentToolCall("browser", questionOutput.pendingBrowserAction);
    return parsed && isBrowserInteraction(parsed.arguments) ? { browserAction: parsed.arguments } : {};
  }
  if (answer === "运行 Workflow") {
    const parsed = parseAgentToolCall("workflow", questionOutput.pendingWorkflowAction);
    return parsed ? { workflowAction: parsed.arguments } : {};
  }
  if (answer === "允许 MCP 工具一次" && isObject(questionOutput.pendingMcpAction)) {
    const name = questionOutput.pendingMcpAction.name;
    const argumentsValue = questionOutput.pendingMcpAction.arguments;
    if (typeof name === "string" && isMcpToolName(name) && isObject(argumentsValue)) {
      return { mcpAction: { name, arguments: argumentsValue } };
    }
  }
  return {};
}

async function waitForProjectMcpElicitation(input: {
  projectId: string;
  turnId: string;
  executionId: string;
  request: ProjectMcpElicitationRequest;
  signal?: AbortSignal;
  dataDir: string;
}): Promise<ElicitResult> {
  if (input.signal?.aborted) return { action: "cancel" };
  const params = input.request.params;
  const mode = params.mode === "url" ? "url" : "form";
  const output = {
    question: params.message,
    options: mode === "url"
      ? [
          { label: "已完成", description: "已在网页中完成 MCP 服务要求的操作" },
          { label: "取消", description: "取消本次 MCP 请求" },
        ]
      : [],
    mcpElicitation: {
      serverId: input.request.serverId,
      serverName: input.request.serverName,
      mode,
      ...(mcpElicitationId(params) ? { elicitationId: mcpElicitationId(params) } : {}),
      ...(mcpElicitationUrl(params) ? { url: mcpElicitationUrl(params) } : {}),
      ...(mcpElicitationSchema(params) ? { requestedSchema: mcpElicitationSchema(params) } : {}),
    },
  };
  const event = await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    type: "toolResult",
    content: params.message,
    data: {
      executionId: input.executionId,
      name: "ask_user_question",
      status: "waitingInput",
      output,
    },
  }, input.dataDir);
  const key = pendingElicitationKey(input.dataDir, input.projectId, input.turnId, event.id);
  const resultPromise = new Promise<ElicitResult>((resolve) => {
    const abortListener = () => {
      runtime.pendingElicitations.delete(key);
      resolve({ action: "cancel" });
    };
    runtime.pendingElicitations.set(key, { resolve, signal: input.signal, abortListener });
    if (input.signal?.aborted) abortListener();
    else input.signal?.addEventListener("abort", abortListener, { once: true });
  });
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    type: "status",
    data: { stage: "waitingInput", elicitationEventId: event.id },
  }, input.dataDir);
  const result = await resultPromise;
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    type: "status",
    data: { stage: "thinking" },
  }, input.dataDir);
  return result;
}

function pendingElicitationKey(dataDir: string, projectId: string, turnId: string, eventId: string) {
  return `${dataDir}\u0000${projectId}\u0000${turnId}\u0000${eventId}`;
}

function projectSetupTrigger(prompt: string): "init" | "maintenance" | undefined {
  const command = prompt.trim().toLowerCase();
  if (command === "/init") return "init";
  if (command === "/maintenance") return "maintenance";
  return undefined;
}

function isReservedLocalSlashCommand(prompt: string) {
  const command = prompt.trim().split(/\s+/, 1)[0]?.toLowerCase();
  return command === "/compact" || command === "/context" || command === "/init" || command === "/maintenance";
}

function projectCompactInstructions(prompt: string) {
  const match = prompt.trim().match(/^\/compact(?:\s+([\s\S]*))?$/i);
  return match ? (match[1]?.trim() ?? "") : undefined;
}

function parseMcpElicitationAnswer(value: string): ElicitResult {
  const answer = value.trim();
  if (answer === "取消") return { action: "cancel" };
  if (answer === "拒绝") return { action: "decline" };
  if (answer === "已完成") return { action: "accept" };
  try {
    const content = JSON.parse(answer) as unknown;
    return isMcpElicitationContent(content)
      ? { action: "accept", content }
      : { action: "accept", content: { value: String(content) } };
  } catch {
    return { action: "accept", content: { value: answer } };
  }
}

function mcpElicitationId(params: ProjectMcpElicitationRequest["params"]) {
  return params.mode === "url" ? params.elicitationId : undefined;
}

function mcpElicitationUrl(params: ProjectMcpElicitationRequest["params"]) {
  return params.mode === "url" ? params.url : undefined;
}

function mcpElicitationSchema(params: ProjectMcpElicitationRequest["params"]) {
  return params.mode === "url" ? undefined : params.requestedSchema;
}

function isMcpElicitationContent(value: unknown): value is Record<string, string | number | boolean | string[]> {
  return isObject(value) && Object.values(value).every((item) =>
    typeof item === "string" || typeof item === "number" || typeof item === "boolean" ||
    (Array.isArray(item) && item.every((entry) => typeof entry === "string")));
}

function isBrowserInteraction(argumentsValue: Record<string, unknown>) {
  return argumentsValue.operation === "click" || argumentsValue.operation === "type" || argumentsValue.operation === "press";
}

function browserInteractionDescription(operation: string, target: string) {
  if (operation === "click") return `点击${target}`;
  if (operation === "type") return `向${target}输入内容`;
  return `向${target}发送按键`;
}

function validateTurnInput(input: { imageDataUrls?: string[]; readingAssetIds?: string[]; projectId: string; prompt: string; model: string; turnId?: string; questionAnswer?: ProjectAgentQuestionAnswer }) {
  if (!input.projectId || !input.prompt?.trim() || input.prompt.length > 200_000 || !input.model?.trim()) {
    throw new ProjectAgentTurnError("项目 Agent Turn 参数无效", "invalid_input");
  }
  if (input.turnId !== undefined && (!input.turnId.trim() || input.turnId.length > 200)) {
    throw new ProjectAgentTurnError("项目 Agent Turn 标识无效", "invalid_input");
  }
  if (
    input.readingAssetIds &&
    (input.readingAssetIds.length > MAX_AGENT_READING_ATTACHMENTS ||
      input.readingAssetIds.some((value) =>
        typeof value !== "string" || !value.trim() || value.length > 200
      ))
  ) {
    throw new ProjectAgentTurnError("项目 Agent 阅读资料上下文无效", "invalid_input");
  }
  if (input.questionAnswer && (
    typeof input.questionAnswer.eventId !== "string" || !input.questionAnswer.eventId.trim() ||
    (input.questionAnswer.value !== undefined && (typeof input.questionAnswer.value !== "string" || !input.questionAnswer.value.trim())) ||
    (input.questionAnswer.answers !== undefined && !isStringRecord(input.questionAnswer.answers)) ||
    (input.questionAnswer.annotations !== undefined && !isQuestionAnnotationRecord(input.questionAnswer.annotations)) ||
    (!input.questionAnswer.value?.trim() && !Object.keys(input.questionAnswer.answers ?? {}).length)
  )) {
    throw new ProjectAgentTurnError("用户回答无效", "invalid_input");
  }
  if (
    input.imageDataUrls &&
    (input.imageDataUrls.length > 4 ||
      input.imageDataUrls.some((value) =>
        typeof value !== "string" ||
        !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value) ||
        value.length > 12_000_000
      ) ||
      input.imageDataUrls.reduce((total, value) => total + value.length, 0) > 32_000_000)
  ) {
    throw new ProjectAgentTurnError("项目 Agent 图片上下文无效", "invalid_input");
  }
}

function isQuestionAnnotationRecord(value: unknown): value is Record<string, { notes?: string; preview?: string }> {
  return isObject(value) && Object.entries(value).every(([question, annotation]) =>
    Boolean(question.trim()) && question.length <= 20_000 && isObject(annotation) &&
    (annotation.notes === undefined || (typeof annotation.notes === "string" && annotation.notes.length <= 20_000)) &&
    (annotation.preview === undefined || (typeof annotation.preview === "string" && annotation.preview.length <= 100_000)));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObject(value) && Object.values(value).every((item) => typeof item === "string");
}

function dedupeStrings(value: string[] | undefined) {
  return [...new Set((value ?? []).filter((item) => typeof item === "string" && item.length <= 1_000))].slice(0, 1_000);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isAgentCommandRequest(value: unknown): value is AgentCommandRequest {
  return isObject(value) &&
    typeof value.id === "string" &&
    typeof value.executable === "string" &&
    Array.isArray(value.args) &&
    value.args.every((item) => typeof item === "string") &&
    typeof value.cwd === "string" &&
    typeof value.reason === "string" &&
    typeof value.status === "string";
}

function isToolSearchResultEntry(
  value: unknown,
): value is AgentWorkspaceToolResult["tool_search"]["tools"][number] {
  return isObject(value) && typeof value.name === "string" && typeof value.description === "string" &&
    ["read", "write", "execute", "interact"].includes(String(value.permission)) &&
    typeof value.requiresWorkspace === "boolean";
}

function mergeSkillAllowedTools(target: Set<string>, output: unknown) {
  if (!isObject(output) || !Array.isArray(output.allowedTools)) return;
  for (const rule of output.allowedTools) {
    if (typeof rule === "string" && rule.trim()) target.add(rule.trim());
  }
}

function delegatedPendingApproval(output: unknown) {
  if (!isObject(output)) return null;
  const candidates = Array.isArray(output.tasks)
    ? output.tasks
    : typeof output.agentId === "string" && isObject(output.pendingCommand)
      ? [{ agentExecutionId: output.agentId, pendingCommand: output.pendingCommand }]
      : [];
  for (const task of candidates) {
    if (!isObject(task) || typeof task.agentExecutionId !== "string" || !isObject(task.pendingCommand)) continue;
    const command = task.pendingCommand;
    if (typeof command.id !== "string" || typeof command.executable !== "string" ||
      !Array.isArray(command.args) || !command.args.every((arg) => typeof arg === "string") ||
      typeof command.cwd !== "string" || typeof command.reason !== "string") continue;
    return {
      executionId: task.agentExecutionId,
      command: {
        id: command.id,
        command: typeof command.command === "string" ? command.command : undefined,
        executable: command.executable,
        args: command.args as string[],
        cwd: command.cwd,
        rootId: typeof command.rootId === "string" ? command.rootId : undefined,
        reason: command.reason,
        externalRoot: command.externalRoot,
        sandboxMode: command.sandboxMode,
      },
    };
  }
  return null;
}

function skillPromptShellPendingApproval(output: unknown) {
  if (!isObject(output) || !isObject(output.promptShellState) || !isObject(output.pendingCommand)) return null;
  const state = output.promptShellState;
  const command = output.pendingCommand;
  if (typeof state.executionId !== "string" || typeof state.pendingCommandId !== "string" ||
    state.pendingCommandId !== command.id || typeof command.id !== "string" ||
    typeof command.executable !== "string" || !Array.isArray(command.args) ||
    !command.args.every((arg) => typeof arg === "string") || typeof command.cwd !== "string" ||
    typeof command.reason !== "string") return null;
  return {
    executionId: state.executionId,
    command: {
      id: command.id,
      command: typeof command.command === "string" ? command.command : undefined,
      executable: command.executable,
      args: command.args as string[],
      cwd: command.cwd,
      rootId: typeof command.rootId === "string" ? command.rootId : undefined,
      reason: command.reason,
      externalRoot: command.externalRoot,
      sandboxMode: command.sandboxMode,
    },
  };
}

async function resumeDelegatedOrchestrationForTurn(input: {
  projectId: string;
  turnId: string;
  model: string;
  reasoningEffort: ZenmeReasoningEffort;
  modelSpeed: ZenmeModelSpeed;
  signal?: AbortSignal;
  callModel: typeof callProjectAgentModel;
  dataDir: string;
}) {
  const session = await getProjectAgentSession(input.projectId, input.dataDir);
  const priorResult = [...session.events].reverse().find((event) =>
    event.turnId === input.turnId && event.type === "toolResult" &&
    (event.data?.name === "delegate_tasks" || (event.data?.name === "skill" && event.data?.forked === true)) &&
    isObject(event.data.output) &&
    typeof event.data.output.orchestrationId === "string");
  const priorOutput = priorResult?.data?.output;
  if (!isObject(priorOutput) || typeof priorOutput.orchestrationId !== "string") {
    return { parentExecutionId: undefined, pendingApproval: null, forkedSkillAnswer: undefined };
  }
  const resumedToolName = priorResult?.data?.name === "skill" ? "skill" : "delegate_tasks";
  const parentExecutionId = typeof priorResult?.data?.executionId === "string"
    ? priorResult.data.executionId
    : undefined;
  const [{ getGlobalOrchestration }, { runDelegatedOrchestration }] = await Promise.all([
    import("@/lib/global-agent/orchestration-store"),
    import("@/lib/global-agent/delegated-runtime"),
  ]);
  const existing = await getGlobalOrchestration(input.projectId, priorOutput.orchestrationId, input.dataDir);
  if (!existing || existing.tasks.every((task) =>
    ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status))) {
    const forkedSkillAnswer = resumedToolName === "skill" && existing
      ? existing.tasks[0]?.resultSummary || existing.tasks[0]?.error || existing.resultSummary || existing.error || "Skill execution completed"
      : undefined;
    return { parentExecutionId, pendingApproval: null, forkedSkillAnswer };
  }
  const completed = await runDelegatedOrchestration({
    projectId: input.projectId,
    orchestrationId: existing.id,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    modelSpeed: input.modelSpeed,
    signal: input.signal,
  }, {
    callModel: input.callModel,
    dataDir: input.dataDir,
    onProgress: async (current) => {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "status",
        data: {
          stage: "delegating",
          orchestrationId: current.id,
          completedCount: current.tasks.filter((task) =>
            ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status)).length,
          totalCount: current.tasks.length,
          runningTitles: current.tasks.filter((task) =>
            task.status === "running" || task.status === "dispatching").map((task) => task.title),
        },
      }, input.dataDir);
    },
  });
  const tasks = await Promise.all(completed.tasks.map(async (task) => {
    const detail = task.agentExecutionId
      ? await getAgentExecution(input.projectId, task.agentExecutionId, input.dataDir)
      : null;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      resultSummary: task.resultSummary,
      error: task.error,
      changeSetIds: task.changeSetIds,
      agentExecutionId: task.agentExecutionId,
      messages: task.messages.filter((message) => message.from === "subagent")
        .map(({ id, from, kind, summary, text, createdAt }) => ({ id, from, kind, summary, text, createdAt })),
      pendingCommand: [...(detail?.commandRequests ?? [])].reverse().find((command) => command.status === "proposed"),
    };
  }));
  const forkedSkillAnswer = resumedToolName === "skill"
    ? tasks[0]?.resultSummary || tasks[0]?.error || completed.resultSummary || completed.error || "Skill execution completed"
    : undefined;
  const output = resumedToolName === "skill"
    ? {
        ...priorOutput,
        forked: true,
        orchestrationId: completed.id,
        agentId: tasks[0]?.agentExecutionId,
        status: tasks[0]?.status ?? completed.status,
        result: forkedSkillAnswer,
        pendingCommand: tasks[0]?.pendingCommand,
      }
    : { orchestrationId: completed.id, status: completed.status, tasks };
  const toolEvent = await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    type: "toolCall",
    data: {
      status: "running",
      executionId: parentExecutionId,
      name: resumedToolName,
      arguments: { orchestrationId: completed.id, resume: true },
      ...(resumedToolName === "skill" ? { forked: true } : {}),
    },
  }, input.dataDir);
  await appendProjectAgentEvent({
    projectId: input.projectId,
    turnId: input.turnId,
    type: "toolResult",
    content: resumedToolName === "skill" ? forkedSkillAnswer : summarizeToolResult("delegate_tasks", output),
    data: {
      status: "succeeded",
      executionId: parentExecutionId,
      toolCallEventId: toolEvent.id,
      name: resumedToolName,
      output,
      ...(resumedToolName === "skill" ? { forked: true } : {}),
    },
  }, input.dataDir);
  const pendingApproval = delegatedPendingApproval(output);
  if (pendingApproval) {
    const latestSession = await getProjectAgentSession(input.projectId, input.dataDir);
    if (!latestSession.events.some((event) =>
      event.turnId === input.turnId && event.type === "approval" &&
      event.data?.commandRequestId === pendingApproval.command.id)) {
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "approval",
        content: pendingApproval.command.reason,
        data: {
          status: "pending",
          executionId: pendingApproval.executionId,
          commandRequestId: pendingApproval.command.id,
          command: pendingApproval.command.command,
          executable: pendingApproval.command.executable,
          args: pendingApproval.command.args,
          cwd: pendingApproval.command.cwd,
          rootId: pendingApproval.command.rootId,
          externalRoot: pendingApproval.command.externalRoot,
          sandboxMode: pendingApproval.command.sandboxMode,
          orchestrationId: completed.id,
        },
      }, input.dataDir);
    }
  }
  return {
    parentExecutionId,
    pendingApproval,
    forkedSkillAnswer: pendingApproval ? undefined : forkedSkillAnswer,
  };
}
