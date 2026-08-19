import crypto from "node:crypto";

import {
  stopRunningAgentCommands,
} from "@/lib/agent/command-runtime";
import {
  completeAgentExecution,
  finishAgentToolCall,
  getAgentExecution,
  startAgentToolCall,
  stopAgentExecution,
} from "@/lib/agent/execution-store";
import { formatAgentCanvasContext } from "@/lib/agent/context-router";
import { executeAgentToolPipeline } from "@/lib/agent/tool-execution-pipeline";
import {
  callProjectAgentModel,
  type ProjectAgentModelResponse,
} from "@/lib/agent/project-agent-model";
import {
  DEFERRED_MODEL_AGENT_TOOL_NAMES,
  describeAgentToolCallValidationError,
  formatAgentToolProtocol,
  MODEL_AGENT_TOOL_DEFINITIONS,
  getAgentToolDefinition,
  parseAgentToolCall,
  type NativeAgentTool,
} from "@/lib/agent/tool-registry";
import type {
  AgentExecutionDetail,
  AgentWorkspaceToolArguments,
  AgentWorkspaceToolName,
} from "@/lib/agent/types";
import { executeAgentWorkspaceTool } from "@/lib/agent/workspace-tools";
import { mergeModelImageDataUrls, readWorkspaceImage } from "@/lib/agent/workspace-images";
import { browserScreenshotDataUrl } from "@/lib/agent/browser-control";
import {
  claimGlobalSubtaskMessages,
  dispatchGlobalSubtasks,
  failGlobalOrchestration,
  getGlobalOrchestration,
  refreshGlobalOrchestration,
  requestGlobalTeamPlanApproval,
  sendGlobalTeamMessage,
  sendGlobalSubtaskReport,
} from "@/lib/global-agent/orchestration-store";
import type { GlobalOrchestration, GlobalSubtaskMessage } from "@/lib/global-agent/types";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalSettings, type ZenmeModelSpeed, type ZenmeReasoningEffort, type ZenmeSessionPermissionMode } from "@/lib/local/settings";
import {
  extractProjectInstructionTargetPaths,
  formatProjectAgentInstructions,
  loadProjectAgentInstructions,
  type ProjectAgentInstruction,
} from "@/lib/agent/project-instructions";
import { formatProjectSkillListing, listProjectSkills, type ProjectSkillSummary } from "@/lib/agent/project-skills";
import {
  callProjectMcpTool,
  closeAgentMcpConnections,
  isMcpToolName,
  listProjectMcpTools,
  parseProjectMcpToolCall,
  searchProjectMcpTools,
  type McpToolName,
  type ProjectMcpTool,
} from "@/lib/agent/mcp-runtime";
import { persistAgentToolResultForModel } from "@/lib/agent/tool-result-storage";
import { enqueueProjectAgentMessage } from "@/lib/agent/project-message-queue";
import { runProjectAgentLifecycleHooks } from "@/lib/agent/project-agent-hook-runtime";
import { parseWorkflowStructuredResult } from "@/lib/agent/workflow-result-schema";
import { projectAgentToolCallForModel } from "@/lib/agent/project-context-policy";

const MAX_SUBAGENT_TURNS = 32;
const MAX_ORCHESTRATION_BATCHES = 32;
const ORCHESTRATION_PROGRESS_INTERVAL_MS = 300;
const MAX_STRUCTURED_RESULT_CORRECTIONS = 2;

type DelegatedRuntimeJob = { controller: AbortController; promise: Promise<unknown> };
type DelegatedRuntimeState = {
  orchestrations: Map<string, DelegatedRuntimeJob>;
  subagents: Map<string, DelegatedRuntimeJob>;
};
const delegatedRuntimeKey = Symbol.for("zenme.delegated-server-runtime");
const existingDelegatedRuntime = Reflect.get(globalThis, delegatedRuntimeKey) as DelegatedRuntimeState | undefined;
const delegatedRuntime = existingDelegatedRuntime ?? {
  orchestrations: new Map<string, DelegatedRuntimeJob>(),
  subagents: new Map<string, DelegatedRuntimeJob>(),
};
if (!existingDelegatedRuntime) Reflect.set(globalThis, delegatedRuntimeKey, delegatedRuntime);

type SubagentDecision =
  | { type: "tool"; name: AgentWorkspaceToolName | McpToolName; arguments: Record<string, unknown> }
  | { type: "invalidTool"; name: string; arguments: unknown; error: string }
  | {
      type: "message";
      to: string;
      summary?: string;
      legacyKind?: "progress" | "question" | "blocked";
      message: string | {
        type: "shutdown_request";
        reason?: string;
      } | {
        type: "shutdown_response";
        request_id: string;
        approve: boolean;
        reason?: string;
      };
    }
  | { type: "complete"; summary: string };

const SUBAGENT_SEND_MESSAGE_TOOL: NativeAgentTool = {
  name: "send_message",
  description: "向 team-lead、具名队友或 *（纯文本广播）发送持久 Team 消息。关闭协议必须使用结构化 shutdown_request/shutdown_response。停止的具名队友收到新消息后会在原会话恢复。",
  parameters: {
    type: "object",
    properties: {
      to: { type: "string", description: "team-lead、队友名称，或 *" },
      summary: { type: "string", description: "用于瀑布流预览的简短摘要" },
      message: {
        anyOf: [
          { type: "string" },
          {
            type: "object",
            properties: { type: { type: "string", enum: ["shutdown_request"] }, reason: { type: "string" } },
            required: ["type"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { type: "string", enum: ["shutdown_response"] },
              request_id: { type: "string" },
              approve: { type: "boolean" },
              reason: { type: "string" },
            },
            required: ["type", "request_id", "approve"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: ["to", "message"],
    additionalProperties: false,
  },
};

export async function startDelegatedSubagentRun(input: {
  executionId: string;
  maxTurns?: number;
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
  signal?: AbortSignal;
}, options: {
  callModel?: typeof callProjectAgentModel;
  callMcpTool?: typeof callProjectMcpTool;
  dataDir?: string;
  listMcpTools?: typeof listProjectMcpTools;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const key = `${dataDir}\u0000${input.projectId}\u0000${input.executionId}`;
  const existing = delegatedRuntime.subagents.get(key);
  if (existing) return { started: false, detail: await getAgentExecution(input.projectId, input.executionId, dataDir) };
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) abortFromParent();
  else input.signal?.addEventListener("abort", abortFromParent, { once: true });
  const promise = runDelegatedSubagent({ ...input, signal: controller.signal }, { ...options, dataDir })
    .catch(async (error) => {
      if (controller.signal.aborted) return;
      const detail = await getAgentExecution(input.projectId, input.executionId, dataDir).catch(() => null);
      if (detail?.status === "running") {
        await completeAgentExecution({
          projectId: input.projectId,
          executionId: input.executionId,
          status: "failed",
          error: safeRuntimeError(error, "Agent 执行失败"),
        }, dataDir).catch(() => undefined);
      }
    })
    .finally(() => {
      input.signal?.removeEventListener("abort", abortFromParent);
      if (delegatedRuntime.subagents.get(key)?.controller === controller) delegatedRuntime.subagents.delete(key);
    });
  delegatedRuntime.subagents.set(key, { controller, promise });
  return { started: true, detail: await getAgentExecution(input.projectId, input.executionId, dataDir) };
}

export async function startDelegatedOrchestrationRun(input: {
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  orchestrationId: string;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
}, options: {
  callModel?: typeof callProjectAgentModel;
  callMcpTool?: typeof callProjectMcpTool;
  dataDir?: string;
  listMcpTools?: typeof listProjectMcpTools;
  onProgress?: (orchestration: GlobalOrchestration) => void | Promise<void>;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const key = `${dataDir}\u0000${input.projectId}\u0000${input.orchestrationId}`;
  const existing = delegatedRuntime.orchestrations.get(key);
  if (existing) return { started: false, orchestration: await getDelegatedOrchestrationResult(input.projectId, input.orchestrationId, dataDir) };
  const controller = new AbortController();
  const promise = runDelegatedOrchestration({ ...input, signal: controller.signal }, { ...options, dataDir })
    .catch(async (error) => {
      if (controller.signal.aborted) return;
      await failGlobalOrchestration(
        input.projectId,
        input.orchestrationId,
        safeRuntimeError(error, "Global Agent 调度失败"),
        dataDir,
      ).catch(() => undefined);
    })
    .finally(() => {
      if (delegatedRuntime.orchestrations.get(key)?.controller === controller) delegatedRuntime.orchestrations.delete(key);
    });
  delegatedRuntime.orchestrations.set(key, { controller, promise });
  return { started: true, orchestration: await getDelegatedOrchestrationResult(input.projectId, input.orchestrationId, dataDir) };
}

export function stopDelegatedSubagentRun(projectId: string, executionId: string, dataDir = getZenmeDataDir()) {
  const job = delegatedRuntime.subagents.get(`${dataDir}\u0000${projectId}\u0000${executionId}`);
  job?.controller.abort();
  return Boolean(job);
}

export async function waitForDelegatedSubagentRun(
  projectId: string,
  executionId: string,
  dataDir = getZenmeDataDir(),
) {
  const job = delegatedRuntime.subagents.get(`${dataDir}\u0000${projectId}\u0000${executionId}`);
  if (job) await job.promise;
  return getAgentExecution(projectId, executionId, dataDir);
}

export function stopDelegatedOrchestrationRun(projectId: string, orchestrationId: string, dataDir = getZenmeDataDir()) {
  const job = delegatedRuntime.orchestrations.get(`${dataDir}\u0000${projectId}\u0000${orchestrationId}`);
  job?.controller.abort();
  return Boolean(job);
}

/**
 * Wait for the runtime-owned orchestration job without exposing a polling tool
 * to the model. If the job already settled, the persisted orchestration is the
 * authoritative result. This mirrors cc-haha's task-notification boundary:
 * background agents finish independently and notify the parent turn.
 */
export async function waitForDelegatedOrchestrationRun(
  projectId: string,
  orchestrationId: string,
  dataDir = getZenmeDataDir(),
) {
  const job = delegatedRuntime.orchestrations.get(`${dataDir}\u0000${projectId}\u0000${orchestrationId}`);
  if (job) await job.promise;
  return getDelegatedOrchestrationResult(projectId, orchestrationId, dataDir);
}

export async function runDelegatedOrchestration(input: {
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  orchestrationId: string;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
  signal?: AbortSignal;
}, options: {
  callModel?: typeof callProjectAgentModel;
  callMcpTool?: typeof callProjectMcpTool;
  dataDir?: string;
  listMcpTools?: typeof listProjectMcpTools;
  onProgress?: (orchestration: GlobalOrchestration) => void | Promise<void>;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const callModel = options.callModel ?? callProjectAgentModel;
  for (let batch = 0; batch < MAX_ORCHESTRATION_BATCHES; batch += 1) {
    input.signal?.throwIfAborted();
    const { dispatched } = await dispatchGlobalSubtasks(input.projectId, input.orchestrationId, dataDir);
    const afterDispatch = await getGlobalOrchestration(input.projectId, input.orchestrationId, dataDir);
    if (afterDispatch) await options.onProgress?.(afterDispatch);
    const runnableExecutionIds = new Set([
      ...dispatched.flatMap((task) => task.agentExecutionId ? [task.agentExecutionId] : []),
      ...(afterDispatch?.tasks ?? []).flatMap((task) =>
        task.agentExecutionId && (task.status === "running" || task.status === "waitingApproval")
          ? [task.agentExecutionId]
          : []),
    ]);
    const taskByExecutionId = new Map((afterDispatch?.tasks ?? []).flatMap((task) =>
      task.agentExecutionId ? [[task.agentExecutionId, task] as const] : []));
    const runs = Promise.all([...runnableExecutionIds].map(async (executionId) => {
      const task = taskByExecutionId.get(executionId);
      await startDelegatedSubagentRun({
          executionId,
          model: task?.model || input.model,
          modelSpeed: input.modelSpeed,
          projectId: input.projectId,
          reasoningEffort: task?.reasoningEffort ?? input.reasoningEffort,
          maxTurns: task?.maxTurns,
          signal: input.signal,
        }, {
          callModel,
          callMcpTool: options.callMcpTool,
          dataDir,
          listMcpTools: options.listMcpTools,
        });
      return waitForDelegatedSubagentRun(input.projectId, executionId, dataDir);
    }));
    let runsSettled = false;
    void runs.finally(() => { runsSettled = true; }).catch(() => undefined);
    while (!runsSettled) {
      await Promise.race([
        runs,
        new Promise<void>((resolve) => setTimeout(resolve, ORCHESTRATION_PROGRESS_INTERVAL_MS)),
      ]);
      if (!runsSettled) {
        const progress = await refreshGlobalOrchestration(input.projectId, input.orchestrationId, dataDir);
        await options.onProgress?.(progress);
      }
    }
    await runs;
    const current = await refreshGlobalOrchestration(input.projectId, input.orchestrationId, dataDir);
    await options.onProgress?.(current);
    if (orchestrationSettled(current)) return current;
    if (current.tasks.some((task) => task.status === "waitingApproval" || task.status === "waitingInput")) return current;
    if (!dispatched.length && !current.tasks.some((task) => task.status === "running" || task.status === "dispatching")) return current;
  }
  throw new Error("并行 Sub-agent 调度超过安全轮数");
}

export async function runDelegatedSubagent(input: {
  executionId: string;
  maxTurns?: number;
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
  signal?: AbortSignal;
}, options: {
  callModel?: typeof callProjectAgentModel;
  callMcpTool?: typeof callProjectMcpTool;
  dataDir?: string;
  listMcpTools?: typeof listProjectMcpTools;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  try {
    return await runDelegatedSubagentCore(input, { ...options, dataDir });
  } finally {
    await closeAgentMcpConnections(input.projectId, input.executionId, dataDir);
  }
}

async function runDelegatedSubagentCore(input: {
  executionId: string;
  maxTurns?: number;
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
  signal?: AbortSignal;
}, options: {
  callModel?: typeof callProjectAgentModel;
  callMcpTool?: typeof callProjectMcpTool;
  dataDir?: string;
  listMcpTools?: typeof listProjectMcpTools;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const callModel = options.callModel ?? callProjectAgentModel;
  const callMcpTool = options.callMcpTool ?? callProjectMcpTool;
  const listMcpTools = options.listMcpTools ?? listProjectMcpTools;
  const settings = await getLocalSettings(dataDir);
  const pendingDecisions: SubagentDecision[] = [];
  const initialDetail = await getAgentExecution(input.projectId, input.executionId, dataDir);
  if (!initialDetail) throw new Error("Sub-agent Execution 不存在");
  const parentOrchestration = initialDetail.context.orchestrationId
    ? await getGlobalOrchestration(input.projectId, initialDetail.context.orchestrationId, dataDir)
    : null;
  const isTeamTeammate = parentOrchestration?.kind === "team";
  const permissionMode = initialDetail.context.permissionMode ?? settings.defaultSessionPermissionMode;
  const mcpDiscovery = delegatedAllowedTools(initialDetail).includes("tool_search")
    ? await listMcpTools(input.projectId, dataDir, initialDetail.context.workspaceRootId, {
        specs: initialDetail.context.agentMcpServers,
        ...(initialDetail.context.agentCustomizationSource
          ? { customizationSource: initialDetail.context.agentCustomizationSource }
          : {}),
        connectionScope: input.executionId,
      }).catch(() => ({ tools: [], failures: [] }))
    : { tools: [], failures: [] };
  const activeMcpToolNames = restoreDelegatedMcpToolNames(initialDetail, mcpDiscovery.tools);
  const activeBuiltInToolNames = restoreDelegatedBuiltInToolNames(initialDetail);
  const queuedParentMessages: GlobalSubtaskMessage[] = [];
  const runLifecycle = (event: "SessionStart" | "SessionEnd" | "Stop" | "SubagentStart" | "SubagentStop" | "TaskCompleted" | "TeammateIdle", payload?: Record<string, unknown>) =>
    initialDetail.context.agentHooks ? runProjectAgentLifecycleHooks({
      projectId: input.projectId,
      executionId: input.executionId,
      event,
      hooks: initialDetail.context.agentHooks,
      rootId: initialDetail.context.workspaceRootId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      modelSpeed: input.modelSpeed,
      callModel,
      signal: input.signal,
      dataDir,
      payload,
    }) : Promise.resolve(undefined);
  const runStopLifecycle = async (summary: string) => {
    for (const event of ["Stop", "SubagentStop"] as const) {
      const result = await runLifecycle(event, { result: summary });
      if (result?.permission === "deny" || result?.preventContinuation) {
        return result.reason || result.additionalContext || `${event} Hook 要求继续处理`;
      }
    }
    if (initialDetail.context.orchestrationId && initialDetail.context.subtaskId) {
      const orchestration = await getGlobalOrchestration(
        input.projectId,
        initialDetail.context.orchestrationId,
        dataDir,
      );
      const task = orchestration?.tasks.find((candidate) => candidate.id === initialDetail.context.subtaskId);
      if (orchestration?.kind === "team" && task) {
        const teammateName = task.name ?? task.title;
        const teamName = orchestration.teamName ?? orchestration.id;
        for (const [event, payload] of [
          ["TaskCompleted", {
            task_id: task.id,
            task_subject: task.title,
            task_description: task.instruction,
            teammate_name: teammateName,
            team_name: teamName,
          }],
          ["TeammateIdle", {
            teammate_name: teammateName,
            team_name: teamName,
          }],
        ] as const) {
          const result = await runLifecycle(event, payload);
          if (result?.permission === "deny" || result?.preventContinuation) {
            return result.reason || result.additionalContext || `${event} Hook 要求继续处理`;
          }
        }
      }
    }
    return "";
  };
  if (initialDetail.toolCalls.length === 0 && initialDetail.commandRequests.length === 0) {
    for (const event of ["SessionStart", "SubagentStart"] as const) {
      const result = await runLifecycle(event, { instruction: initialDetail.instruction });
      if (result?.permission === "deny" || result?.preventContinuation) {
        return completeAgentExecution({
          projectId: input.projectId,
          executionId: input.executionId,
          status: "failed",
          error: result.reason || `${event} Hook 已阻止 Sub-agent 启动`,
          resultSummary: "Sub-agent 未绕过 Agent Hook 生命周期边界。",
        }, dataDir);
      }
      if (result?.additionalContext) queuedParentMessages.push(hookFeedbackMessage(result.additionalContext, `${event} Hook 上下文`));
    }
  }
  const observedImageCache = new Map<string, string>();
  let browserScreenshot: string | undefined;
  let structuredResultCorrections = 0;
  const maxTurns = Math.min(MAX_SUBAGENT_TURNS, Math.max(1, input.maxTurns ?? MAX_SUBAGENT_TURNS));
  for (let turn = 0; turn < maxTurns; turn += 1) {
    input.signal?.throwIfAborted();
    const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
    if (!detail) throw new Error("Sub-agent Execution 不存在");
    if (detail.status !== "running" || detail.stage === "waitingApproval" || detail.stage === "waitingInput") return detail;

    const currentOrchestration = detail.context.orchestrationId
      ? await getGlobalOrchestration(input.projectId, detail.context.orchestrationId, dataDir)
      : null;
    const currentTask = currentOrchestration?.tasks.find((task) => task.id === detail.context.subtaskId);
    const planApprovalRequired = currentOrchestration?.kind === "team" && currentTask?.planModeRequired === true &&
      currentTask.planApproval?.status !== "approved";
    const allowedTools = delegatedAllowedTools(detail).filter((name) =>
      !planApprovalRequired || isPlanModeSubagentTool(name));
    const canDiscoverTools = allowedTools.includes("tool_search");
    const exposedTools = allowedTools.filter((name) =>
      !canDiscoverTools || !DEFERRED_MODEL_AGENT_TOOL_NAMES.has(name) || activeBuiltInToolNames.has(name));
    const parentMessages = queuedParentMessages.splice(0);
    if (detail.context.orchestrationId && detail.context.subtaskId) {
      parentMessages.push(...await claimGlobalSubtaskMessages(
        input.projectId,
        detail.context.orchestrationId,
        detail.context.subtaskId,
        dataDir,
      ));
    }
    const projectInstructions = await loadProjectAgentInstructions({
      projectId: input.projectId,
      targetPaths: [
        ...(detail.context.allowedPathPrefixes ?? []).map((relativePath) => ({
          rootId: detail.context.workspaceRootId,
          relativePath,
        })),
        ...extractProjectInstructionTargetPaths(detail.toolCalls.map((call) => call.arguments)),
      ],
    }, dataDir).catch(() => []);
    const availableSkills = allowedTools.includes("skill")
      ? await listProjectSkills(input.projectId, dataDir, detail.context.workspaceRootId).catch(() => [])
      : [];
    const activeMcpTools = mcpDiscovery.tools.filter((tool) =>
      activeMcpToolNames.has(tool.name) && (!planApprovalRequired || tool.readOnly));
    const response = pendingDecisions.length ? null : await callModel({
      context: buildDelegatedSubagentContext(
        detail,
        permissionMode,
        [],
        projectInstructions,
        mcpDiscovery.tools,
        activeMcpTools,
        mcpDiscovery.failures,
        parentMessages,
        availableSkills,
        exposedTools,
        isTeamTeammate,
        planApprovalRequired ? {
          feedback: currentTask?.planApproval?.status === "rejected" ? currentTask.planApproval.feedback : undefined,
        } : undefined,
      ),
      imageDataUrls: mergeModelImageDataUrls([], [
        ...await collectDelegatedWorkspaceImages({
          projectId: input.projectId,
          detail,
          cache: observedImageCache,
          dataDir,
        }),
        ...(browserScreenshot ? [browserScreenshot] : []),
      ]),
      model: input.model,
      prompt: "继续执行被委派任务。可以在一次响应中调用多个相互独立的读取工具；写入、命令和交互动作必须逐次调用。完成后返回最终结果摘要。",
      signal: input.signal,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: input.reasoningEffort ?? settings.defaultReasoningEffort,
      modelSpeed: input.modelSpeed ?? settings.defaultModelSpeed,
      allowedAgentTools: exposedTools,
      additionalAgentTools: [
        ...(isTeamTeammate ? [SUBAGENT_SEND_MESSAGE_TOOL] : []),
        ...activeMcpTools.map((tool) => ({
          name: tool.name,
          description: `${tool.description}（MCP 服务：${tool.serverName}；${tool.readOnly ? "只读" : "可产生外部变更"}）`,
          parameters: tool.parameters,
        })),
      ],
    });
    const afterModel = await getAgentExecution(input.projectId, input.executionId, dataDir);
    if (!afterModel) throw new Error("Sub-agent Execution 不存在");
    if (afterModel.status !== "running" || afterModel.stage === "waitingApproval" || afterModel.stage === "waitingInput") {
      return afterModel;
    }
    if (detail.context.orchestrationId && detail.context.subtaskId) {
      const lateMessages = await claimGlobalSubtaskMessages(
        input.projectId,
        detail.context.orchestrationId,
        detail.context.subtaskId,
        dataDir,
      );
      if (lateMessages.length) {
        pendingDecisions.length = 0;
        queuedParentMessages.push(...lateMessages);
        continue;
      }
    }
    const responseDecisions = response ? delegatedDecisions(response, activeMcpTools) : [];
    const decision = pendingDecisions.shift() ?? responseDecisions.shift() ?? null;
    if (responseDecisions.length) pendingDecisions.push(...responseDecisions);
    if (decision?.type === "invalidTool") {
      const definition = getAgentToolDefinition(decision.name);
      if (definition && !definition.internal && decision.arguments && typeof decision.arguments === "object" && !Array.isArray(decision.arguments)) {
        const call = await startAgentToolCall({
          projectId: input.projectId,
          executionId: input.executionId,
          name: definition.name,
          arguments: decision.arguments as Record<string, unknown>,
        }, dataDir);
        await finishAgentToolCall({
          projectId: input.projectId,
          executionId: input.executionId,
          toolCallId: call.id,
          error: decision.error,
        }, dataDir);
      }
      queuedParentMessages.push(hookFeedbackMessage(decision.error, "工具调用校验失败"));
      continue;
    }
    const completionSummary = !decision
      ? response?.text ?? "Sub-agent 已完成任务。"
      : decision.type === "complete"
        ? decision.summary
        : null;
    if (completionSummary !== null) {
      if (planApprovalRequired && detail.context.orchestrationId && detail.context.subtaskId) {
        return submitTeamPlanForApproval({
          projectId: input.projectId,
          orchestrationId: detail.context.orchestrationId,
          subtaskId: detail.context.subtaskId,
          executionId: input.executionId,
          plan: completionSummary,
          dataDir,
        });
      }
      if (detail.context.structuredResultSchema) {
        try {
          parseWorkflowStructuredResult(completionSummary, detail.context.structuredResultSchema);
        } catch (error) {
          const message = error instanceof Error ? error.message : "结构化结果校验失败";
          if (structuredResultCorrections < MAX_STRUCTURED_RESULT_CORRECTIONS) {
            structuredResultCorrections += 1;
            queuedParentMessages.push(hookFeedbackMessage(
              `${message}。请修正最终结果，只返回符合既定 JSON Schema 的 JSON 值，不要使用 Markdown 代码块或附加说明。`,
              `结构化结果需要修正（${structuredResultCorrections}/${MAX_STRUCTURED_RESULT_CORRECTIONS}）`,
            ));
            continue;
          }
          await runLifecycle("SessionEnd", { error: message });
          return completeAgentExecution({
            projectId: input.projectId,
            executionId: input.executionId,
            status: "failed",
            error: message,
            resultSummary: "Sub-agent 未能返回符合 Workflow JSON Schema 的结果。",
          }, dataDir);
        }
      }
      const stopFeedback = await runStopLifecycle(completionSummary);
      if (stopFeedback) {
        queuedParentMessages.push(hookFeedbackMessage(stopFeedback));
        continue;
      }
      await runLifecycle("SessionEnd", { result: completionSummary });
      return completeAgentExecution({
        projectId: input.projectId,
        executionId: input.executionId,
        status: "succeeded",
        resultSummary: completionSummary,
      }, dataDir);
    }
    if (!decision || decision.type === "complete") continue;
    if (decision.type === "message") {
      if (!detail.context.orchestrationId || !detail.context.subtaskId) {
        throw new Error("send_message 只能由受调度的 Sub-agent 调用");
      }
      try {
        const messageResult = await executeAgentToolPipeline({
          projectId: input.projectId,
          executionId: input.executionId,
          name: "send_message",
          arguments: { to: decision.to, summary: decision.summary, message: decision.message },
          execute: async () => {
            if (decision.legacyKind) {
              const report = await sendGlobalSubtaskReport({
                projectId: input.projectId,
                orchestrationId: detail.context.orchestrationId!,
                subtaskId: detail.context.subtaskId!,
                executionId: input.executionId,
                kind: decision.legacyKind,
                summary: decision.summary!,
                text: decision.message as string,
              }, dataDir);
              return { delivered: true, parentTurnId: undefined, recipients: ["team-lead"], report };
            }
            const structured = typeof decision.message === "string" ? null : decision.message;
            return sendGlobalTeamMessage({
              projectId: input.projectId,
              orchestrationId: detail.context.orchestrationId!,
              senderSubtaskId: detail.context.subtaskId!,
              executionId: input.executionId,
              to: decision.to,
              summary: decision.summary,
              message: typeof decision.message === "string"
                ? decision.message
                : structured?.type === "shutdown_request"
                  ? structured.reason?.trim() || "请完成当前工作并退出"
                  : structured?.approve
                    ? "已批准关闭请求"
                    : structured?.reason?.trim() || "已拒绝关闭请求",
              kind: structured?.type,
              requestId: structured?.type === "shutdown_response" ? structured.request_id : undefined,
              approve: structured?.type === "shutdown_response" ? structured.approve : undefined,
              reason: structured?.type === "shutdown_response" ? structured.reason : undefined,
            }, dataDir);
          },
        }, dataDir);
        await deliverSubagentMessageToParentTurn({
          projectId: input.projectId,
          orchestrationId: detail.context.orchestrationId,
          subtaskId: detail.context.subtaskId,
          executionId: input.executionId,
          decision,
          output: messageResult.output,
          dataDir,
        });
        if (isApprovedShutdownResponse(decision)) {
          await stopRunningAgentCommands(input.projectId, input.executionId);
          return stopAgentExecution(input.projectId, input.executionId, dataDir);
        }
        await resumeTeamMessageRecipients({
          projectId: input.projectId,
          orchestrationId: detail.context.orchestrationId,
          output: messageResult.output,
          model: input.model,
          reasoningEffort: input.reasoningEffort,
          modelSpeed: input.modelSpeed,
          callModel,
          callMcpTool,
          listMcpTools,
          dataDir,
        });
      } catch (error) {
        safeRuntimeError(error, "Sub-agent 消息发送失败");
      }
      continue;
    }
    if (isMcpToolName(decision.name)) {
      try {
        await executeAgentToolPipeline({
          projectId: input.projectId,
          executionId: input.executionId,
          name: decision.name,
          arguments: decision.arguments,
          execute: () => callMcpTool({
            projectId: input.projectId,
            name: decision.name as McpToolName,
            arguments: decision.arguments,
            signal: input.signal,
            rootId: detail.context.workspaceRootId,
            agentMcpServers: detail.context.agentMcpServers,
            ...(detail.context.agentCustomizationSource
              ? { agentCustomizationSource: detail.context.agentCustomizationSource }
              : {}),
            connectionScope: input.executionId,
          }, dataDir),
          persistOutput: (output, metadata) => persistAgentToolResultForModel({
            dataDir,
            name: decision.name,
            output,
            projectId: input.projectId,
            toolCallId: metadata.toolCallId,
          }),
        }, dataDir);
      } catch (error) {
        safeRuntimeError(error, "MCP 工具执行失败");
      }
      continue;
    }
    if (planApprovalRequired && decision.name === "exit_plan_mode" &&
      detail.context.orchestrationId && detail.context.subtaskId) {
      const plan = typeof decision.arguments.plan === "string" ? decision.arguments.plan : "";
      try {
        return await submitTeamPlanForApproval({
          projectId: input.projectId,
          orchestrationId: detail.context.orchestrationId,
          subtaskId: detail.context.subtaskId,
          executionId: input.executionId,
          plan,
          dataDir,
        });
      } catch (error) {
        queuedParentMessages.push(hookFeedbackMessage(
          safeRuntimeError(error, "计划提交失败"),
          "计划提交失败，请修正后重试",
        ));
        continue;
      }
    }
    if (planApprovalRequired && !allowedTools.includes(decision.name)) {
      queuedParentMessages.push(hookFeedbackMessage(
        "负责人尚未批准计划。当前只能读取、分析并调用 exit_plan_mode 提交完整计划，不能写文件、执行命令或触发外部变更。",
        "等待计划批准",
      ));
      continue;
    }
    const deferredToolSearchResults = decision.name === "tool_search"
      ? searchProjectMcpTools(
          mcpDiscovery.tools,
          (decision.arguments as AgentWorkspaceToolArguments["tool_search"]).query,
          (decision.arguments as AgentWorkspaceToolArguments["tool_search"]).maxResults,
        )
      : undefined;
    if (decision.name === "browser" && permissionMode === "untrusted" && isBrowserInteraction(decision.arguments)) {
      return completeAgentExecution({
        projectId: input.projectId,
        executionId: input.executionId,
        status: "failed",
        error: "不可信模式下的页面点击、输入或按键必须由主 Agent 向用户请求批准",
        resultSummary: "Sub-agent 没有绕过页面交互权限边界。",
      }, dataDir);
    }
    let output: Awaited<ReturnType<typeof executeAgentWorkspaceTool>>;
    try {
      output = await executeAgentWorkspaceTool({
        projectId: input.projectId,
        executionId: input.executionId,
        name: decision.name,
        additionalAllowedTools: detail.context.additionalAllowedTools,
        arguments: (decision.name === "web_fetch"
          ? { ...decision.arguments, model: input.model }
          : decision.arguments) as never,
        deferredToolSearchResults,
        signal: input.signal,
        delegatedCallModel: callModel,
        delegatedModel: input.model,
        delegatedReasoningEffort: input.reasoningEffort,
        delegatedModelSpeed: input.modelSpeed,
      }, dataDir);
      if (decision.name === "browser") {
        browserScreenshot = browserScreenshotDataUrl(output) ?? browserScreenshot;
      }
    } catch (error) {
      safeRuntimeError(error, "Sub-agent 工具执行失败");
      continue;
    }
    if (decision.name === "tool_search" && output && typeof output === "object" && "tools" in output && Array.isArray(output.tools)) {
      const availableMcpNames = new Set(mcpDiscovery.tools.map((tool) => tool.name));
      for (const tool of output.tools) {
        if (
          tool
          && typeof tool === "object"
          && "name" in tool
          && typeof tool.name === "string"
          && DEFERRED_MODEL_AGENT_TOOL_NAMES.has(tool.name as AgentWorkspaceToolName)
        ) {
          activeBuiltInToolNames.add(tool.name as AgentWorkspaceToolName);
        }
        if (tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string" && availableMcpNames.has(tool.name as McpToolName)) {
          activeMcpToolNames.add(tool.name);
        }
      }
    }
    if (decision.name === "shell_command" && isProposedShellCommand(output)) {
      return getAgentExecution(input.projectId, input.executionId, dataDir);
    }
    if (decision.name === "ask_user_question") return getAgentExecution(input.projectId, input.executionId, dataDir);
  }
  return completeAgentExecution({
    projectId: input.projectId,
    executionId: input.executionId,
    status: "failed",
    error: "Sub-agent 工具调用达到安全上限",
    resultSummary: "Sub-agent 未能在安全轮数内完成任务。",
  }, dataDir);
}

function hookFeedbackMessage(text: string, summary = "Stop Hook 要求继续处理"): GlobalSubtaskMessage {
  return {
    id: crypto.randomUUID(),
    from: "parent",
    senderName: "agent-hook",
    recipientName: "subagent",
    kind: "blocked",
    summary,
    text,
    createdAt: new Date().toISOString(),
  };
}

function isBrowserInteraction(argumentsValue: Record<string, unknown>) {
  return argumentsValue.operation === "click" || argumentsValue.operation === "type" || argumentsValue.operation === "press";
}

function isProposedShellCommand(value: unknown) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    "id" in value && typeof value.id === "string" &&
    "status" in value && value.status === "proposed";
}

async function collectDelegatedWorkspaceImages(input: {
  cache: Map<string, string>;
  dataDir: string;
  detail: AgentExecutionDetail;
  projectId: string;
}) {
  const paths = input.detail.toolCalls.flatMap((call) => {
    if (call.name !== "view_image" || call.status !== "succeeded" || !call.output || typeof call.output !== "object") return [];
    const relativePath = "relativePath" in call.output ? call.output.relativePath : undefined;
    return typeof relativePath === "string" ? [relativePath] : [];
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

export function buildDelegatedSubagentContext(
  detail: AgentExecutionDetail,
  permissionMode: ZenmeSessionPermissionMode,
  _activeBackgroundTasks: readonly unknown[] = [],
  projectInstructions: ProjectAgentInstruction[] = [],
  availableMcpTools: readonly ProjectMcpTool[] = [],
  activeMcpTools: readonly ProjectMcpTool[] = [],
  mcpFailures: ReadonlyArray<{ serverId: string; serverName: string; error: string }> = [],
  parentMessages: readonly GlobalSubtaskMessage[] = [],
  availableSkills: readonly ProjectSkillSummary[] = [],
  exposedTools?: readonly AgentWorkspaceToolName[],
  isTeamTeammate = false,
  planApproval?: { feedback?: string },
) {
  void _activeBackgroundTasks;
  const allowedTools = [...(exposedTools ?? delegatedAllowedTools(detail))];
  const allowedToolSet = new Set<AgentWorkspaceToolName>(allowedTools);
  const excludedTools = MODEL_AGENT_TOOL_DEFINITIONS
    .map((definition) => definition.name)
    .filter((name) => !allowedToolSet.has(name));
  return [
    isTeamTeammate
      ? "你是 Zenme Local 统一 Project Agent Team 中的长期成员。只完成分配给你的任务，不扩展目标，也不得再次委派 Sub-agent。你不能直接向用户提问；需要同步关键进度、缺少必要信息或被阻塞时，调用 send_message 发给 team-lead，由负责人协调或决定是否询问用户。"
      : "你是 Zenme Local 统一 Project Agent 临时派生的一次性 Sub-agent。只完成分配给你的任务，不扩展目标，也不得再次委派 Sub-agent。你不能直接向用户提问；完成后以最终文本摘要将结果返回父 Agent。不要创建或领取共享任务，也不要轮询后台任务。",
    `默认会话权限：${permissionMode}。文件修改仍进入 ChangeSet；命令仍受 Workspace 沙箱和审批边界约束。`,
    `任务：${detail.instruction}`,
    `Workspace Root：${detail.context.workspaceRootId ?? "主根（旧任务未记录稳定 ID）"}。该任务的文件和命令工具会被强制限定在此 Root；不要尝试切换 rootId。`,
    `允许路径：${JSON.stringify(detail.context.allowedPathPrefixes ?? ["."])}`,
    `允许工具：${JSON.stringify(allowedTools)}`,
    parentMessages.length
      ? `${isTeamTeammate
        ? "Team 邮箱在任务运行期间收到以下协调消息。来自 team-lead 的指令和结构化关闭请求优先于较早任务描述；来自队友的消息应按内容协作："
        : "父 Agent 在任务运行期间补充了以下纠错、Hook 或任务指令；新指令优先于较早任务描述："}\n${parentMessages.map((message) => `- from=${message.senderName ?? (message.from === "parent" ? "team-lead" : "teammate")}${message.kind ? ` type=${message.kind}` : ""}${message.requestId ? ` request_id=${message.requestId}` : ""}: ${message.text}`).join("\n")}`
      : "",
    planApproval
      ? `你由负责人以 mode=plan 启动。当前处于强制计划阶段：只能读取和分析，不能写文件、执行 Shell、修改任务或产生外部变更。形成完整实施计划后必须调用 exit_plan_mode 提交 plan，并等待 team-lead 使用 plan_approval_response 响应；不要把计划当作普通最终答复。${planApproval.feedback ? `上一版计划被拒绝，必须根据以下反馈修订：${planApproval.feedback}` : ""}`
      : "",
    isTeamTeammate && parentMessages.some((message) => message.kind === "shutdown_request")
      ? "team-lead 已请求关闭：停止开始新的工作，整理当前结果，并用 send_message 向 team-lead 发送结构化 shutdown_response（携带原 request_id，approve=true）后退出；若必须拒绝，approve=false 且 reason 必填。"
      : "",
    formatProjectAgentInstructions(projectInstructions),
    availableSkills.length
      ? `当前可用技能（需要其专门指令时调用 skill 加载）：\n${formatProjectSkillListing([...availableSkills])}`
      : "",
    formatAgentToolProtocol({ exclude: excludedTools }),
    isTeamTeammate
      ? "Team 协作工具 send_message 与 cc-haha 一致：to=team-lead 向负责人报告，to=具名成员直接协作，to='*' 只广播纯文本；纯文本必须带 5–10 词 summary。关闭请求和响应必须使用结构化 shutdown_request/shutdown_response，不能广播；不要用它发送高频流水账。"
      : "",
    isTeamTeammate
      ? "项目共享任务协作：task_list/task_get/task_update/task_create 用于读取和维护共享工作项；它们不是后台进程工具。根据当前协作需要自行决定何时使用。"
      : "",
    formatDelegatedMcpContext(availableMcpTools, activeMcpTools, mcpFailures),
    allowedToolSet.has("code_intelligence")
      ? "code_intelligence 可提供 TypeScript/JavaScript 的定义、引用、实现、类型和调用关系等语义 observation；位置使用从 1 开始的行列号。根据问题选择语义导航或文本搜索。"
      : "",
    allowedToolSet.has("browser")
      ? "验证本地 Web 界面时使用 browser：仅在用户输入或 shell_command 输出已经提供明确 loopback URL 后 navigate，再根据 snapshot 返回的元素 ref 执行 click/type/press；需要视觉判断时请求 screenshot。不要猜测 selector、扫描端口或重启服务。"
      : "",
    allowedToolSet.has("code_diagnostics")
      ? "code_diagnostics 可提供 TypeScript/JavaScript 的结构化诊断；测试、构建、诊断、预览等验证方式由你根据任务风险和当前证据选择。不要把任何单一工具当作固定完成门槛。"
      : "完成前按允许工具进行与修改风险相称的验证，不要把未运行的检查写成已通过。",
    "Shell 与 cc-haha 保持同一语义：只启动一次命令；短命令前台完成，长命令在 15 秒后由同一进程自动转为后台，并返回稳定 taskId 和 outputFilePath。后台任务终止时运行时会发送通知，不要枚举任务、轮询输出、扫描端口或为了获得 URL 重启服务。需要页面验证时，只能使用 shell_command 输出或用户提供的明确 loopback URL。",
    '任务完成时返回普通文本，或返回 {"type":"complete","summary":"..."}。',
    formatAgentCanvasContext({
      currentNodeContext: detail.context.currentNodeContext,
      connectedGraphContext: detail.context.connectedGraphContext,
      legacyCanvasContext: detail.context.canvasContext,
    }) || "画布上下文：无",
    `已确认 Project Memory：${JSON.stringify(detail.context.projectMemories ?? [])}`,
    `Project Knowledge：${JSON.stringify(detail.context.knowledgeContext ?? [])}`,
    `工具历史：${JSON.stringify(detail.toolCalls.flatMap((call) => {
      const projected = projectAgentToolCallForModel(call.name, call.arguments);
      return projected ? [{ ...projected, status: call.status, output: call.output, error: call.error }] : [];
    }))}`,
    `命令历史：${JSON.stringify(detail.commandRequests.map((command) => ({ executable: command.executable, args: command.args, cwd: command.cwd, status: command.status, stdout: command.stdout, stderr: command.stderr })))}`,
  ].filter(Boolean).join("\n\n");
}

function delegatedAllowedTools(detail: AgentExecutionDetail): AgentWorkspaceToolName[] {
  return (detail.context.allowedTools ?? []).filter((name) =>
    name !== "ask_user_question" &&
    name !== "delegate_tasks" &&
    name !== "run_approved_command" &&
    getAgentToolDefinition(name)?.internal !== true);
}

function formatDelegatedMcpContext(
  availableTools: readonly ProjectMcpTool[],
  activeTools: readonly ProjectMcpTool[],
  failures: ReadonlyArray<{ serverName: string; error: string }>,
) {
  const lines: string[] = [];
  if (availableTools.length && !activeTools.length) {
    lines.push(`当前 Project 有 ${availableTools.length} 个 MCP 工具可通过 tool_search 按需发现；未发现前不要猜测或调用其内部名称。`);
  } else if (activeTools.length) {
    lines.push(
      `当前 Sub-agent Turn 已激活以下 MCP 工具（另有 ${Math.max(0, availableTools.length - activeTools.length)} 个仍延迟加载）：`,
      ...activeTools.map((tool) => `- ${tool.name}: ${tool.description}\n  JSON Schema：${JSON.stringify(tool.parameters)}`),
    );
  }
  if (failures.length) {
    lines.push(`部分 MCP 服务不可用：${failures.map((failure) => `${failure.serverName}（${failure.error}）`).join("；")}`);
  }
  return lines.join("\n");
}

export function restoreDelegatedMcpToolNames(
  detail: AgentExecutionDetail,
  availableTools: readonly ProjectMcpTool[],
) {
  const availableNames = new Set(availableTools.map((tool) => tool.name));
  const activeNames = new Set<string>();
  for (const call of detail.toolCalls) {
    if (call.name !== "tool_search" || call.status !== "succeeded" || !call.output || typeof call.output !== "object") continue;
    const tools = "tools" in call.output && Array.isArray(call.output.tools) ? call.output.tools : [];
    for (const tool of tools) {
      if (tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string" && availableNames.has(tool.name as McpToolName)) {
        activeNames.add(tool.name);
      }
    }
  }
  return activeNames;
}

export function restoreDelegatedBuiltInToolNames(detail: AgentExecutionDetail) {
  const activeNames = new Set<AgentWorkspaceToolName>();
  for (const call of detail.toolCalls) {
    if (call.name !== "tool_search" || call.status !== "succeeded" || !call.output || typeof call.output !== "object") continue;
    const tools = "tools" in call.output && Array.isArray(call.output.tools) ? call.output.tools : [];
    for (const tool of tools) {
      if (
        !tool
        || typeof tool !== "object"
        || !("name" in tool)
        || typeof tool.name !== "string"
        || !DEFERRED_MODEL_AGENT_TOOL_NAMES.has(tool.name as AgentWorkspaceToolName)
      ) continue;
      activeNames.add(tool.name as AgentWorkspaceToolName);
    }
  }
  return activeNames;
}

function delegatedDecisions(
  response: ProjectAgentModelResponse,
  activeMcpTools: readonly ProjectMcpTool[] = [],
): SubagentDecision[] {
  const nativeCalls = response.toolCalls?.length ? response.toolCalls : response.toolCall ? [response.toolCall] : [];
  if (nativeCalls.length) return nativeCalls.map((nativeCall) => {
    const message = parseSubagentMessage(nativeCall.name, nativeCall.arguments);
    if (message) return message;
    const mcpCall = parseProjectMcpToolCall(activeMcpTools, nativeCall.name, nativeCall.arguments);
    if (mcpCall) return { type: "tool", name: mcpCall.name, arguments: mcpCall.arguments };
    const call = parseAgentToolCall(nativeCall.name, nativeCall.arguments);
    if (!call) return {
      type: "invalidTool" as const,
      name: nativeCall.name,
      arguments: nativeCall.arguments,
      error: describeAgentToolCallValidationError(nativeCall.name, nativeCall.arguments),
    };
    return { type: "tool", name: call.name, arguments: call.arguments };
  });
  const candidate = response.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!candidate.startsWith("{")) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return []; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const value = parsed as Record<string, unknown>;
  if (value.type === "complete" && typeof value.summary === "string") return [{ type: "complete", summary: value.summary }];
  if (value.type !== "tool") return [];
  const message = parseSubagentMessage(value.name, value.arguments);
  if (message) return [message];
  const mcpCall = parseProjectMcpToolCall(activeMcpTools, value.name, value.arguments);
  if (mcpCall) return [{ type: "tool", name: mcpCall.name, arguments: mcpCall.arguments }];
  const call = parseAgentToolCall(value.name, value.arguments);
  if (!call) return [{
    type: "invalidTool",
    name: typeof value.name === "string" ? value.name : "",
    arguments: value.arguments,
    error: describeAgentToolCallValidationError(value.name, value.arguments),
  }];
  return [{ type: "tool", name: call.name, arguments: call.arguments }];
}

function parseSubagentMessage(name: unknown, argumentsValue: unknown): Extract<SubagentDecision, { type: "message" }> | null {
  if (name !== "send_message" || !argumentsValue || typeof argumentsValue !== "object" || Array.isArray(argumentsValue)) return null;
  const value = argumentsValue as Record<string, unknown>;
  const legacyKind = (["progress", "question", "blocked"] as const)
    .includes(value.kind as "progress" | "question" | "blocked")
    ? value.kind as "progress" | "question" | "blocked"
    : undefined;
  if (legacyKind) {
    if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 500 ||
      typeof value.message !== "string" || !value.message.trim() || value.message.length > 200_000 ||
      Object.keys(value).some((key) => !["kind", "summary", "message"].includes(key))) return null;
    return {
      type: "message",
      to: "team-lead",
      legacyKind,
      summary: value.summary.trim(),
      message: value.message.trim(),
    };
  }
  if (typeof value.to !== "string" || !value.to.trim() || value.to.length > 100 ||
    Object.keys(value).some((key) => !["to", "summary", "message"].includes(key))) return null;
  const summary = typeof value.summary === "string" && value.summary.trim() && value.summary.length <= 500
    ? value.summary.trim()
    : undefined;
  if (typeof value.message === "string") {
    if (!value.message.trim() || value.message.length > 200_000 || !summary) return null;
    return { type: "message", to: value.to.trim(), summary, message: value.message.trim() };
  }
  if (!value.message || typeof value.message !== "object" || Array.isArray(value.message)) return null;
  const structured = value.message as Record<string, unknown>;
  if (structured.type === "shutdown_request" &&
    Object.keys(structured).every((key) => ["type", "reason"].includes(key)) &&
    (structured.reason === undefined || typeof structured.reason === "string")) {
    return {
      type: "message",
      to: value.to.trim(),
      summary,
      message: { type: "shutdown_request", reason: structured.reason as string | undefined },
    };
  }
  if (structured.type === "shutdown_response" && typeof structured.request_id === "string" &&
    Boolean(structured.request_id.trim()) && typeof structured.approve === "boolean" &&
    (structured.reason === undefined || typeof structured.reason === "string") &&
    Object.keys(structured).every((key) => ["type", "request_id", "approve", "reason"].includes(key)) &&
    (structured.approve || Boolean((structured.reason as string | undefined)?.trim()))) {
    return {
      type: "message",
      to: value.to.trim(),
      summary,
      message: {
        type: "shutdown_response",
        request_id: structured.request_id.trim(),
        approve: structured.approve,
        reason: structured.reason as string | undefined,
      },
    };
  }
  return null;
}

function isApprovedShutdownResponse(decision: Extract<SubagentDecision, { type: "message" }>) {
  return typeof decision.message !== "string" &&
    decision.message.type === "shutdown_response" && decision.message.approve;
}

async function deliverSubagentMessageToParentTurn(input: {
  dataDir: string;
  decision: Extract<SubagentDecision, { type: "message" }>;
  executionId: string;
  orchestrationId: string;
  output: unknown;
  projectId: string;
  subtaskId: string;
}) {
  if (input.decision.to !== "team-lead") return;
  const orchestration = await getGlobalOrchestration(input.projectId, input.orchestrationId, input.dataDir);
  if (!orchestration?.parentTurnId) return;
  const task = orchestration.tasks.find((candidate) => candidate.id === input.subtaskId);
  const senderName = task?.name ?? task?.title ?? input.subtaskId;
  const outputRecord = input.output && typeof input.output === "object" && !Array.isArray(input.output)
    ? input.output as Record<string, unknown>
    : {};
  const report = outputRecord.report && typeof outputRecord.report === "object" && !Array.isArray(outputRecord.report)
    ? outputRecord.report as Record<string, unknown>
    : null;
  const routed = outputRecord.message && typeof outputRecord.message === "object" && !Array.isArray(outputRecord.message)
    ? outputRecord.message as Record<string, unknown>
    : null;
  const messageId = typeof report?.id === "string" ? report.id : typeof routed?.id === "string" ? routed.id : crypto.randomUUID();
  const structured = typeof input.decision.message === "string" ? null : input.decision.message;
  const text = typeof input.decision.message === "string"
    ? input.decision.message
    : structured?.type === "shutdown_response"
      ? structured.approve ? "已批准关闭请求并退出" : `已拒绝关闭请求：${structured.reason}`
      : structured?.reason ?? "请求关闭";
  await enqueueProjectAgentMessage({
    projectId: input.projectId,
    turnId: orchestration.parentTurnId,
    kind: "task-notification",
    priority: "later",
    dedupeKey: `team-message:${messageId}`,
    content: `Sub-agent“${senderName}”发来消息：${text}`,
    data: {
      status: "succeeded",
      executionId: input.executionId,
      name: "send_message",
      output: {
        sender: senderName,
        to: "team-lead",
        summary: input.decision.summary,
        message: input.decision.message,
      },
    },
  }, input.dataDir);
}

function isPlanModeSubagentTool(name: AgentWorkspaceToolName) {
  if (name === "exit_plan_mode") return true;
  if (name === "skill" || name === "tool_search") return false;
  return getAgentToolDefinition(name)?.permission === "read";
}

async function submitTeamPlanForApproval(input: {
  dataDir: string;
  executionId: string;
  orchestrationId: string;
  plan: string;
  projectId: string;
  subtaskId: string;
}) {
  const output = await executeAgentToolPipeline({
    projectId: input.projectId,
    executionId: input.executionId,
    name: "exit_plan_mode",
    arguments: { plan: input.plan },
    validate: (value) => Boolean(value) && typeof value === "object" &&
      "plan" in value && typeof value.plan === "string" && Boolean(value.plan.trim()),
    execute: () => requestGlobalTeamPlanApproval({
      projectId: input.projectId,
      orchestrationId: input.orchestrationId,
      subtaskId: input.subtaskId,
      executionId: input.executionId,
      plan: input.plan,
    }, input.dataDir),
  }, input.dataDir);
  const request = output.output;
  if (request.parentTurnId) {
    await enqueueProjectAgentMessage({
      projectId: input.projectId,
      turnId: request.parentTurnId,
      kind: "task-notification",
      priority: "later",
      dedupeKey: `team-plan:${request.requestId}`,
      content: `Sub-agent“${request.teammateName}”提交了实施计划，等待负责人批准：\n${input.plan}`,
      data: {
        status: "waitingApproval",
        executionId: input.executionId,
        name: "exit_plan_mode",
        output: {
          teammateName: request.teammateName,
          requestId: request.requestId,
          plan: input.plan,
          instruction: "使用 send_message 向该成员发送 plan_approval_response；批准设 approve=true，拒绝设 approve=false 并提供 feedback。",
        },
      },
    }, input.dataDir);
  }
  const detail = await getAgentExecution(input.projectId, input.executionId, input.dataDir);
  if (!detail) throw new Error("Sub-agent Execution 不存在");
  return detail;
}

async function resumeTeamMessageRecipients(input: {
  callMcpTool: typeof callProjectMcpTool;
  callModel: typeof callProjectAgentModel;
  dataDir: string;
  listMcpTools: typeof listProjectMcpTools;
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  orchestrationId: string;
  output: unknown;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
}) {
  if (!input.output || typeof input.output !== "object" || Array.isArray(input.output)) return;
  const reactivated = "reactivatedAgentIds" in input.output && Array.isArray(input.output.reactivatedAgentIds)
    ? input.output.reactivatedAgentIds.filter((value): value is string => typeof value === "string")
    : [];
  if (!reactivated.length) return;
  const orchestration = await getGlobalOrchestration(input.projectId, input.orchestrationId, input.dataDir);
  for (const taskId of reactivated) {
    const executionId = orchestration?.tasks.find((task) => task.id === taskId)?.agentExecutionId;
    if (!executionId) continue;
    await startDelegatedSubagentRun({
      projectId: input.projectId,
      executionId,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      modelSpeed: input.modelSpeed,
    }, {
      dataDir: input.dataDir,
      callModel: input.callModel,
      callMcpTool: input.callMcpTool,
      listMcpTools: input.listMcpTools,
    });
  }
}

function orchestrationSettled(orchestration: GlobalOrchestration) {
  return ["completed", "failed", "stopped", "interrupted", "waitingReview"].includes(orchestration.status);
}

export async function getDelegatedOrchestrationResult(projectId: string, orchestrationId: string, dataDir = getZenmeDataDir()) {
  const current = await getGlobalOrchestration(projectId, orchestrationId, dataDir);
  if (!current) throw new Error("并行 Sub-agent 调度不存在");
  return current;
}

function safeRuntimeError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  return error.message.replace(/[\r\n\t]+/g, " ").slice(0, 100_000);
}
