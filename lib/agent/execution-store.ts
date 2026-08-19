import fs from "node:fs/promises";
import path from "node:path";

import {
  AGENT_EXECUTION_DETAIL_VERSION,
  type AgentCommandRequest,
  type AgentContextSelection,
  type AgentExecutionDetail,
  type AgentExecutionStage,
  type AgentToolCall,
  type AgentCallableToolName,
  type AgentWorkspaceToolName,
} from "@/lib/agent/types";
import type { ExecutionStatus } from "@/lib/execution/types";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import {
  createLocalExecution,
  retryLocalNodeRun,
  stopLocalExecution,
  updateLocalExecutionAttempt,
} from "@/lib/local/execution-repository";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import {
  canUseWorkspaceCapability,
  canUseWorkspaceRootCapability,
  resolveWorkspaceRoot,
} from "@/lib/workspace/types";
import { getConfirmedMemoryContext } from "@/lib/memory/repository";
import type { ProjectMemoryContextItem } from "@/lib/memory/types";
import { searchProjectKnowledge } from "@/lib/knowledge/index-store";
import type { KnowledgeSearchResult } from "@/lib/knowledge/types";
import { AGENT_TOOL_NAMES } from "@/lib/agent/tool-registry";
import { appendContinuousProjectEvent } from "@/lib/global-agent/continuous-store";
import { normalizeProjectAgentHooks, type ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";

type AgentRuntimeState = {
  activeExecutions: Set<string>;
  mutationLocks: Map<string, Promise<unknown>>;
};

const runtimeStateKey = Symbol.for("zenme.agent-runtime-state");
const existingRuntimeState = Reflect.get(globalThis, runtimeStateKey) as AgentRuntimeState | undefined;
const runtimeState = existingRuntimeState ?? {
  activeExecutions: new Set<string>(),
  mutationLocks: new Map<string, Promise<unknown>>(),
};
if (!existingRuntimeState) Reflect.set(globalThis, runtimeStateKey, runtimeState);

// Next.js may load the same repository into separate route bundles. Keeping the
// registry on globalThis lets retry/dispatch and polling routes share liveness.
const { activeExecutions, mutationLocks } = runtimeState;
const MAX_TOOL_CALLS = 2_000;

export class AgentExecutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_unavailable"
      | "invalid_input"
      | "execution_not_found"
      | "invalid_status",
  ) {
    super(message);
    this.name = "AgentExecutionError";
  }
}

export async function createAgentExecution(input: {
  agentId?: string;
  agentMemory?: AgentContextSelection["agentMemory"];
  agentHooks?: AgentContextSelection["agentHooks"];
  agentMcpServers?: AgentContextSelection["agentMcpServers"];
  agentCustomizationSource?: AgentContextSelection["agentCustomizationSource"];
  structuredResultSchema?: AgentContextSelection["structuredResultSchema"];
  allowedPathPrefixes?: string[];
  allowedTools?: AgentWorkspaceToolName[];
  additionalAllowedTools?: string[];
  canvasContext?: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  fileDocumentIds?: string[];
  instruction: string;
  orchestrationId?: string;
  permissionMode?: AgentContextSelection["permissionMode"];
  projectId: string;
  resultNodeId: string;
  selectedNodeIds?: string[];
  subtaskId?: string;
  triggerNodeId: string;
  workspaceRootId?: string;
  allowWithoutWorkspace?: boolean;
}, dataDir = getZenmeDataDir()) {
  validateCreateInput(input);
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if ((!binding || !canUseWorkspaceCapability(binding, "read")) && !input.allowWithoutWorkspace) {
    throw new AgentExecutionError("Workspace 未绑定或未授权读取", "workspace_unavailable");
  }
  const workspaceRoot = binding && input.workspaceRootId
    ? resolveWorkspaceRoot(binding, input.workspaceRootId)
    : null;
  if (input.workspaceRootId && (!workspaceRoot || !canUseWorkspaceRootCapability(workspaceRoot, "read"))) {
    throw new AgentExecutionError("指定的 Workspace Root 不存在或未授权读取", "workspace_unavailable");
  }

  const executionId = crypto.randomUUID();
  const nodeRunId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const now = new Date().toISOString();
  const projectMemories = limitMemoryContext(await getConfirmedMemoryContext(input.projectId, dataDir));
  const knowledgeContext = await resolveKnowledgeContext(input.projectId, input.instruction, dataDir);
  const detail: AgentExecutionDetail = {
    version: AGENT_EXECUTION_DETAIL_VERSION,
    id: executionId,
    projectId: input.projectId,
    nodeRunId,
    attemptId,
    agentId: input.agentId?.trim() || "global-agent",
    instruction: input.instruction.trim(),
    resultNodeId: input.resultNodeId,
    triggerNodeId: input.triggerNodeId,
    context: {
      selectedNodeIds: dedupeStrings(input.selectedNodeIds),
      fileDocumentIds: dedupeStrings(input.fileDocumentIds),
      canvasContext: (input.canvasContext ?? "").slice(0, 2_000_000),
      currentNodeContext: input.currentNodeContext?.slice(0, 2_000_000) || undefined,
      connectedGraphContext: input.connectedGraphContext?.slice(0, 2_000_000) || undefined,
      conversationId: input.conversationId?.trim() || undefined,
      projectMemories,
      knowledgeContext,
      allowedPathPrefixes: dedupeStrings(input.allowedPathPrefixes),
      allowedTools: dedupeTools(input.allowedTools),
      additionalAllowedTools: dedupeStrings(input.additionalAllowedTools),
      workspaceRootId: workspaceRoot?.id,
      orchestrationId: input.orchestrationId,
      subtaskId: input.subtaskId,
      agentMemory: input.agentMemory,
      agentHooks: input.agentHooks,
      agentMcpServers: input.agentMcpServers,
      agentCustomizationSource: input.agentCustomizationSource,
      structuredResultSchema: input.structuredResultSchema,
      permissionMode: input.permissionMode,
    },
    stage: "planning",
    status: "running",
    toolCalls: [],
    commandRequests: [],
    changeSetIds: [],
    createdAt: now,
    updatedAt: now,
  };

  await writeDetail(detail, dataDir);
  try {
    const execution = await createLocalExecution({
      projectId: input.projectId,
      executionId,
      nodeRunId,
      attemptId,
      nodeId: input.resultNodeId,
      triggerNodeId: input.triggerNodeId,
      kind: "agent",
      input: {
        prompt: detail.instruction,
        context: detail.context.canvasContext || undefined,
        parameters: {
          selectedNodeCount: detail.context.selectedNodeIds.length,
          fileDocumentCount: detail.context.fileDocumentIds.length,
          ...(detail.context.orchestrationId ? { orchestrationId: detail.context.orchestrationId } : {}),
          ...(detail.context.subtaskId ? { subtaskId: detail.context.subtaskId } : {}),
        },
      },
      providerId: "zenme-agent-runtime",
      startedAt: now,
    }, dataDir);
    activeExecutions.add(runtimeKey(input.projectId, executionId));
    await recordExecutionEvent(detail, dataDir);
    return { detail, execution };
  } catch (error) {
    await fs.rm(getDetailPath(input.projectId, executionId, dataDir), { force: true });
    throw error;
  }
}

function dedupeTools(values?: AgentWorkspaceToolName[]) {
  if (values === undefined) return undefined;
  return Array.from(new Set(values.filter((value) => AGENT_TOOL_NAMES.includes(value))));
}

export async function listAgentExecutions(projectId: string, dataDir = getZenmeDataDir()) {
  const details = await readAgentExecutionDetails(projectId, dataDir);
  const recovered = await Promise.all(details.map((detail) => recoverInterruptedAgentExecution(detail, dataDir)));
  return recovered.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function readAgentExecutionDetails(projectId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  const directory = getDetailsDirectory(projectId, dataDir);
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const details = (await Promise.all(names
    .filter((name) => name.endsWith(".json"))
    .map((name) => readDetail(projectId, name.slice(0, -5), dataDir))))
    .filter((detail): detail is AgentExecutionDetail => Boolean(detail));
  return details;
}

export async function reconcileAgentExecutionsForTurn(input: {
  projectId: string;
  turnId: string;
  status: "succeeded" | "failed" | "stopped";
  summary?: string;
  error?: string;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  if (!input.turnId.trim()) throw new AgentExecutionError("Turn ID 无效", "invalid_input");
  const details = await readAgentExecutionDetails(input.projectId, dataDir);
  const running = details.filter((detail) =>
    detail.resultNodeId === input.turnId && detail.status === "running");
  const reconciled: AgentExecutionDetail[] = [];
  for (const detail of running) {
    reconciled.push(input.status === "stopped"
      ? await stopAgentExecution(input.projectId, detail.id, dataDir)
      : await completeAgentExecution({
          projectId: input.projectId,
          executionId: detail.id,
          status: input.status,
          resultSummary: input.summary,
          error: input.error,
        }, dataDir));
  }
  return reconciled;
}

export async function getAgentExecution(
  projectId: string,
  executionId: string,
  dataDir = getZenmeDataDir(),
) {
  const detail = await readDetail(projectId, executionId, dataDir);
  return detail ? recoverInterruptedAgentExecution(detail, dataDir) : null;
}

export async function setAgentExecutionStage(
  projectId: string,
  executionId: string,
  stage: AgentExecutionStage,
  dataDir = getZenmeDataDir(),
) {
  if (isFinalStage(stage) || stage === "interrupted") {
    throw new AgentExecutionError(
      "结束状态必须通过完成、失败、停止或恢复流程写入",
      "invalid_status",
    );
  }
  return mutateDetail(projectId, executionId, dataDir, (detail) => {
    if (isFinalStage(detail.stage)) {
      throw new AgentExecutionError("执行已经结束", "invalid_status");
    }
    detail.stage = stage;
    detail.updatedAt = new Date().toISOString();
    return detail;
  });
}

export async function setAgentExecutionWorkspaceRoot(
  projectId: string,
  executionId: string,
  workspaceRootId: string | undefined,
  dataDir = getZenmeDataDir(),
) {
  return mutateDetail(projectId, executionId, dataDir, (detail) => {
    assertRunnable(detail);
    detail.context.workspaceRootId = workspaceRootId;
    detail.updatedAt = new Date().toISOString();
    return detail;
  });
}

export async function setAgentExecutionHooks(
  projectId: string,
  executionId: string,
  hooks: ProjectAgentHooks | undefined,
  dataDir = getZenmeDataDir(),
) {
  return mutateDetail(projectId, executionId, dataDir, (detail) => {
    assertRunnable(detail);
    detail.context.agentHooks = normalizeProjectAgentHooks(hooks, { preserveRuntimeMetadata: true });
    detail.updatedAt = new Date().toISOString();
    return detail;
  });
}

export async function startAgentToolCall(input: {
  arguments: Record<string, unknown>;
  executionId: string;
  name: AgentCallableToolName;
  projectId: string;
}, dataDir = getZenmeDataDir()) {
  const call: AgentToolCall = {
    id: crypto.randomUUID(),
    name: input.name,
    arguments: limitArguments(input.arguments),
    status: "running",
    startedAt: new Date().toISOString(),
  };
  await mutateDetail(input.projectId, input.executionId, dataDir, (detail) => {
    assertRunnable(detail);
    detail.stage = stageForTool(input.name);
    detail.toolCalls.push(call);
    if (detail.toolCalls.length > MAX_TOOL_CALLS) {
      detail.toolCalls.splice(0, detail.toolCalls.length - MAX_TOOL_CALLS);
    }
    detail.updatedAt = call.startedAt;
    return detail;
  });
  return call;
}

export async function finishAgentToolCall(input: {
  changeSetId?: string;
  error?: string;
  executionId: string;
  output?: unknown;
  projectId: string;
  toolCallId: string;
}, dataDir = getZenmeDataDir()) {
  return mutateDetail(input.projectId, input.executionId, dataDir, (detail) => {
    const call = detail.toolCalls.find((candidate) => candidate.id === input.toolCallId);
    if (!call) throw new AgentExecutionError("工具调用不存在", "invalid_input");
    const now = new Date().toISOString();
    call.status = input.error ? "failed" : "succeeded";
    call.completedAt = now;
    if (input.error) call.error = input.error.slice(0, 4_000);
    else call.output = limitOutput(input.output);
    if (input.changeSetId && !detail.changeSetIds.includes(input.changeSetId)) {
      detail.changeSetIds.push(input.changeSetId);
    }
    detail.updatedAt = now;
    return detail;
  });
}

export async function addAgentCommandRequest(
  projectId: string,
  executionId: string,
  command: AgentCommandRequest,
  dataDir = getZenmeDataDir(),
) {
  return mutateDetail(projectId, executionId, dataDir, (detail) => {
    assertRunnable(detail);
    detail.commandRequests.push(command);
    detail.stage = "waitingApproval";
    detail.updatedAt = command.updatedAt;
    return detail;
  });
}

export async function updateAgentCommandRequest(
  projectId: string,
  executionId: string,
  commandId: string,
  update: (command: AgentCommandRequest) => void,
  dataDir = getZenmeDataDir(),
) {
  return mutateDetail(projectId, executionId, dataDir, (detail) => {
    const command = detail.commandRequests.find((candidate) => candidate.id === commandId);
    if (!command) throw new AgentExecutionError("命令请求不存在", "invalid_input");
    update(command);
    detail.stage = command.status === "running" ? "testing" :
      command.status === "proposed" || command.status === "approved" ? "waitingApproval" :
      command.status === "rejected" ? "planning" : detail.stage;
    detail.updatedAt = command.updatedAt;
    return detail;
  });
}

export async function completeAgentExecution(input: {
  error?: string;
  executionId: string;
  projectId: string;
  resultSummary?: string;
  status: "succeeded" | "failed" | "timedOut";
}, dataDir = getZenmeDataDir()) {
  const detail = await mutateDetail(input.projectId, input.executionId, dataDir, (current) => {
    const now = new Date().toISOString();
    current.status = input.status;
    current.stage = input.status === "succeeded" ? "completed" : "failed";
    current.resultSummary = input.resultSummary?.slice(0, 100_000);
    current.error = input.error?.slice(0, 4_000);
    current.updatedAt = now;
    current.completedAt = now;
    return current;
  });
  activeExecutions.delete(runtimeKey(input.projectId, input.executionId));
  await updateLocalExecutionAttempt({
    projectId: input.projectId,
    executionId: input.executionId,
    nodeRunId: detail.nodeRunId,
    attemptId: detail.attemptId,
    status: input.status,
    outputText: detail.resultSummary,
    error: detail.error ? { code: "agent_failed", message: detail.error, retryable: true, stage: "persist" } : null,
  }, dataDir);
  await recordExecutionEvent(detail, dataDir);
  return detail;
}

export async function stopAgentExecution(projectId: string, executionId: string, dataDir = getZenmeDataDir()) {
  const detail = await mutateDetail(projectId, executionId, dataDir, (current) => {
    const now = new Date().toISOString();
    current.status = "stopped";
    current.stage = "stopped";
    current.updatedAt = now;
    current.completedAt = now;
    for (const command of current.commandRequests) {
      if (command.status === "running") {
        command.status = "stopped";
        command.completedAt = now;
        command.updatedAt = now;
      }
    }
    return current;
  });
  activeExecutions.delete(runtimeKey(projectId, executionId));
  await stopLocalExecution({ projectId, executionId }, dataDir);
  await recordExecutionEvent(detail, dataDir);
  return detail;
}

export async function retryAgentExecution(projectId: string, executionId: string, dataDir = getZenmeDataDir()) {
  const current = await requireDetail(projectId, executionId, dataDir);
  if (!isFinalStage(current.stage) && current.stage !== "interrupted") {
    throw new AgentExecutionError("只有结束或中断的执行可以重试", "invalid_status");
  }
  const retried = await retryLocalNodeRun({
    projectId,
    executionId,
    nodeRunId: current.nodeRunId,
    providerId: "zenme-agent-runtime",
  }, dataDir);
  const detail = await mutateDetail(projectId, executionId, dataDir, (next) => {
    const now = new Date().toISOString();
    next.attemptId = retried.attempt.id;
    next.status = "running";
    next.stage = "planning";
    next.updatedAt = now;
    delete next.completedAt;
    delete next.error;
    delete next.resultSummary;
    return next;
  });
  activeExecutions.add(runtimeKey(projectId, executionId));
  await recordExecutionEvent(detail, dataDir);
  return { detail, execution: retried.execution };
}

async function recoverInterruptedAgentExecution(detail: AgentExecutionDetail, dataDir: string) {
  const key = runtimeKey(detail.projectId, detail.id);
  if (
    activeExecutions.has(key) ||
    isDurableWaitingStage(detail.stage) ||
    detail.status !== "running"
  ) return detail;
  const recovered = await mutateDetail(detail.projectId, detail.id, dataDir, (current) => {
    if (current.status !== "running" || isDurableWaitingStage(current.stage)) return current;
    const now = new Date().toISOString();
    current.status = "interrupted";
    current.stage = "interrupted";
    current.error = "应用已重启，当前 Agent 工具调用无法续接；可以安全重试。";
    current.updatedAt = now;
    current.completedAt = now;
    for (const command of current.commandRequests) {
      if (command.status === "running") {
        command.status = "stopped";
        command.error = "应用重启时命令已终止";
        command.completedAt = now;
        command.updatedAt = now;
      }
    }
    return current;
  });
  await updateLocalExecutionAttempt({
    projectId: recovered.projectId,
    executionId: recovered.id,
    nodeRunId: recovered.nodeRunId,
    attemptId: recovered.attemptId,
    status: "interrupted",
    error: { code: "agent_interrupted", message: recovered.error!, retryable: true, stage: "recovery" },
  }, dataDir);
  await recordExecutionEvent(recovered, dataDir);
  return recovered;
}

function isDurableWaitingStage(stage: AgentExecutionDetail["stage"]) {
  return stage === "waitingApproval" || stage === "waitingInput";
}

async function recordExecutionEvent(detail: AgentExecutionDetail, dataDir: string) {
  await appendContinuousProjectEvent({
    projectId: detail.projectId,
    type: "execution.changed",
    source: "execution",
    sourceId: detail.id,
    idempotencyKey: `execution:${detail.id}:${detail.status}:${detail.stage}:${detail.updatedAt}`,
    data: {
      status: detail.status,
      stage: detail.stage,
      agentId: detail.agentId,
      resultNodeId: detail.resultNodeId,
      changeSetIds: detail.changeSetIds.slice(0, 100),
      ...(detail.resultSummary ? { resultSummary: detail.resultSummary.slice(0, 20_000) } : {}),
      ...(detail.error ? { error: detail.error.slice(0, 4_000) } : {}),
    },
  }, dataDir).catch(() => undefined);
}

async function mutateDetail<T>(
  projectId: string,
  executionId: string,
  dataDir: string,
  mutate: (detail: AgentExecutionDetail) => T,
) {
  const filePath = getDetailPath(projectId, executionId, dataDir);
  const previous = mutationLocks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const detail = await requireDetail(projectId, executionId, dataDir);
    const result = mutate(detail);
    await writeJsonFile(filePath, detail);
    return result;
  });
  mutationLocks.set(filePath, next);
  try {
    return await next;
  } finally {
    if (mutationLocks.get(filePath) === next) mutationLocks.delete(filePath);
  }
}

async function requireDetail(projectId: string, executionId: string, dataDir: string) {
  const detail = await readDetail(projectId, executionId, dataDir);
  if (!detail) throw new AgentExecutionError("Agent Execution 不存在", "execution_not_found");
  return detail;
}

function readDetail(projectId: string, executionId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  assertSafePathSegment(executionId, "executionId");
  return readJsonFile<AgentExecutionDetail | null>(getDetailPath(projectId, executionId, dataDir), {
    defaultValue: null,
    normalize: normalizeDetail,
  });
}

async function writeDetail(detail: AgentExecutionDetail, dataDir: string) {
  const filePath = getDetailPath(detail.projectId, detail.id, dataDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonFile(filePath, detail);
}

function getDetailsDirectory(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "executions", "agent");
}

function getDetailPath(projectId: string, executionId: string, dataDir: string) {
  return resolveInside(getDetailsDirectory(projectId, dataDir), `${executionId}.json`);
}

function normalizeDetail(value: unknown): AgentExecutionDetail | null {
  if (!isObject(value) || value.version !== AGENT_EXECUTION_DETAIL_VERSION) return null;
  if (
    typeof value.id !== "string" || typeof value.projectId !== "string" ||
    typeof value.nodeRunId !== "string" || typeof value.attemptId !== "string" ||
    typeof value.agentId !== "string" || typeof value.instruction !== "string" ||
    !isStage(value.stage) || !isExecutionStatus(value.status) ||
    !isObject(value.context) || !Array.isArray(value.toolCalls) ||
    !Array.isArray(value.commandRequests) || !Array.isArray(value.changeSetIds) ||
    typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
  ) return null;
  const context: AgentContextSelection = {
    selectedNodeIds: stringArray(value.context.selectedNodeIds),
    fileDocumentIds: stringArray(value.context.fileDocumentIds),
    canvasContext: typeof value.context.canvasContext === "string" ? value.context.canvasContext : "",
    currentNodeContext: typeof value.context.currentNodeContext === "string" ? value.context.currentNodeContext : undefined,
    connectedGraphContext: typeof value.context.connectedGraphContext === "string" ? value.context.connectedGraphContext : undefined,
    conversationId: typeof value.context.conversationId === "string" ? value.context.conversationId : undefined,
    projectMemories: Array.isArray(value.context.projectMemories)
      ? value.context.projectMemories.filter(isProjectMemoryContextItem).slice(0, 100)
      : [],
    knowledgeContext: Array.isArray(value.context.knowledgeContext)
      ? value.context.knowledgeContext.filter(isKnowledgeSearchResult).slice(0, 50)
      : [],
    allowedPathPrefixes: stringArray(value.context.allowedPathPrefixes),
    allowedTools: Array.isArray(value.context.allowedTools)
      ? value.context.allowedTools.filter(isWorkspaceToolName)
      : undefined,
    additionalAllowedTools: stringArray(value.context.additionalAllowedTools),
    workspaceRootId: typeof value.context.workspaceRootId === "string" ? value.context.workspaceRootId : undefined,
    orchestrationId: typeof value.context.orchestrationId === "string" ? value.context.orchestrationId : undefined,
    subtaskId: typeof value.context.subtaskId === "string" ? value.context.subtaskId : undefined,
    agentMemory: normalizeAgentMemory(value.context.agentMemory),
    agentHooks: normalizeProjectAgentHooks(value.context.agentHooks, { preserveRuntimeMetadata: true }),
    permissionMode: normalizePermissionMode(value.context.permissionMode),
  };
  return {
    ...value,
    version: AGENT_EXECUTION_DETAIL_VERSION,
    id: value.id,
    projectId: value.projectId,
    nodeRunId: value.nodeRunId,
    attemptId: value.attemptId,
    agentId: value.agentId,
    instruction: value.instruction,
    resultNodeId: typeof value.resultNodeId === "string" ? value.resultNodeId : undefined,
    triggerNodeId: typeof value.triggerNodeId === "string" ? value.triggerNodeId : undefined,
    context: { ...value.context, ...context },
    stage: value.stage,
    status: value.status,
    toolCalls: value.toolCalls.filter(isToolCall),
    commandRequests: value.commandRequests.filter(isCommandRequest),
    changeSetIds: stringArray(value.changeSetIds),
    resultSummary: typeof value.resultSummary === "string" ? value.resultSummary : undefined,
    error: typeof value.error === "string" ? value.error : undefined,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: typeof value.completedAt === "string" ? value.completedAt : undefined,
  };
}

function normalizeAgentMemory(value: unknown): AgentContextSelection["agentMemory"] {
  if (!isObject(value) || typeof value.agentType !== "string" || !["user", "project", "local"].includes(String(value.scope))) return undefined;
  return { agentType: value.agentType, scope: value.scope as "user" | "project" | "local" };
}

function normalizePermissionMode(value: unknown): AgentContextSelection["permissionMode"] {
  return value === "untrusted" || value === "onRequest" || value === "neverAsk" ? value : undefined;
}

function limitMemoryContext(memories: ProjectMemoryContextItem[]) {
  let chars = 0;
  return memories.slice(0, 100).filter((memory) => {
    chars += memory.title.length + memory.content.length + JSON.stringify(memory.sources).length;
    return chars <= 200_000;
  });
}

function isProjectMemoryContextItem(value: unknown): value is ProjectMemoryContextItem {
  if (!isObject(value)) return false;
  return typeof value.id === "string" && typeof value.title === "string" && typeof value.content === "string" &&
    typeof value.revision === "number" && value.status === "confirmed" && Array.isArray(value.sources);
}

async function resolveKnowledgeContext(projectId: string, query: string, dataDir: string) {
  try { return (await searchProjectKnowledge({ projectId, query, limit: 20, budgetCharacters: 80_000 }, dataDir)).results; }
  catch { return [] as KnowledgeSearchResult[]; }
}

function isKnowledgeSearchResult(value: unknown): value is KnowledgeSearchResult {
  return isObject(value) && isObject(value.entity) && typeof value.entity.id === "string" && typeof value.score === "number" && Array.isArray(value.evidence);
}

function validateCreateInput(input: { instruction: string; projectId: string; resultNodeId: string; triggerNodeId: string }) {
  assertSafePathSegment(input.projectId, "projectId");
  if (!input.instruction.trim() || input.instruction.length > 100_000 || !input.resultNodeId || !input.triggerNodeId) {
    throw new AgentExecutionError("Agent 任务参数无效", "invalid_input");
  }
}

function assertRunnable(detail: AgentExecutionDetail) {
  if (detail.status !== "running" || isFinalStage(detail.stage)) {
    throw new AgentExecutionError("Agent Execution 不可继续运行", "invalid_status");
  }
}

function stageForTool(name: AgentCallableToolName): AgentExecutionStage {
  if (name === "send_message") return "planning";
  if (name === "list_directory" || name === "glob_files" || name === "search_files" || name === "skill" || name === "tool_search" || name === "list_mcp_resources" || name === "web_search" || name === "web_fetch" || name === "task_output" || name === "task_get" || name === "task_list" || name === "project_task_list") return "searching";
  if (name === "ask_user_question") return "waitingInput";
  if (name === "workspace_status" || name === "read_file" || name === "view_image" || name === "read_mcp_resource" || name === "git_diff" || name === "code_diagnostics") return "reading";
  if (name === "write_file" || name === "edit_file" || name === "notebook_edit" || name === "todo_write" || name === "task_create" || name === "task_update" || name === "propose_patch" || name === "propose_memory" || name === "enter_worktree" || name === "exit_worktree") return "editing";
  return "testing";
}

function isFinalStage(stage: AgentExecutionStage) {
  return stage === "completed" || stage === "failed" || stage === "stopped";
}

function runtimeKey(projectId: string, executionId: string) {
  return `${projectId}:${executionId}`;
}

function dedupeStrings(value: string[] | undefined) {
  return [...new Set((value ?? []).filter((entry) => typeof entry === "string" && entry.length <= 200))].slice(0, 1_000);
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function limitArguments(value: Record<string, unknown>) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= 100_000) return value;
  return { truncated: true, preview: serialized.slice(0, 100_000) };
}

function limitOutput(value: unknown) {
  if (value === undefined) return undefined;
  const serialized = JSON.stringify(value);
  if (serialized.length <= 200_000) return value;
  return { truncated: true, preview: serialized.slice(0, 200_000) };
}

function isStage(value: unknown): value is AgentExecutionStage {
  return typeof value === "string" && ["planning", "searching", "reading", "editing", "waitingApproval", "waitingInput", "testing", "completed", "failed", "stopped", "interrupted"].includes(value);
}

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === "string" && ["queued", "running", "polling", "succeeded", "failed", "stopped", "timedOut", "interrupted"].includes(value);
}

function isToolCall(value: unknown): value is AgentToolCall {
  return isObject(value) && typeof value.id === "string" && isToolName(value.name) && isObject(value.arguments) && (value.status === "running" || value.status === "succeeded" || value.status === "failed" || value.status === "stopped") && typeof value.startedAt === "string";
}

function isCommandRequest(value: unknown): value is AgentCommandRequest {
  return isObject(value) && typeof value.id === "string" && typeof value.executable === "string" && Array.isArray(value.args) && value.args.every((entry) => typeof entry === "string") && (value.command === undefined || typeof value.command === "string") && typeof value.cwd === "string" && typeof value.timeoutMs === "number" && typeof value.reason === "string" && isCommandStatus(value.status) && typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function isToolName(value: unknown): value is AgentCallableToolName {
  return typeof value === "string" && (
    value === "send_message" ||
    AGENT_TOOL_NAMES.includes(value as AgentWorkspaceToolName) ||
    /^mcp__[a-z0-9_]{1,100}__[a-z0-9_]{1,100}$/i.test(value)
  );
}

function isWorkspaceToolName(value: unknown): value is AgentWorkspaceToolName {
  return typeof value === "string" && AGENT_TOOL_NAMES.includes(value as AgentWorkspaceToolName);
}

function isCommandStatus(value: unknown): value is AgentCommandRequest["status"] {
  return typeof value === "string" && ["proposed", "approved", "rejected", "running", "succeeded", "failed", "stopped", "timedOut"].includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
