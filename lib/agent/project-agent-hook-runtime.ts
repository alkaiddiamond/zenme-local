import path from "node:path";
import crypto from "node:crypto";

import { substitutePluginUserConfigInContent, substitutePluginUserConfigRuntime } from "@/lib/agent/project-plugin-options";

import { approveAgentCommand, proposeAgentCommand, runApprovedAgentCommand } from "@/lib/agent/command-runtime";
import type { ProjectAgentHook, ProjectAgentHookEvent, ProjectAgentHookMatcher, ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import type { ProjectAgentModelResponse, callProjectAgentModel } from "@/lib/agent/project-agent-model";
import { MODEL_AGENT_TOOL_DEFINITIONS, type NativeAgentTool } from "@/lib/agent/tool-registry";
import type { AgentToolFailureHookResult, AgentToolPermissionHookResult, AgentToolPostHookResult, AgentToolPreHookResult } from "@/lib/agent/tool-execution-pipeline";
import type { AgentCallableToolName, AgentWorkspaceToolName } from "@/lib/agent/types";
import type { ChatMessage } from "@/lib/ai/chat-message";
import type { ZenmeModelSpeed, ZenmeReasoningEffort } from "@/lib/local/settings";

type HookModelCaller = typeof callProjectAgentModel;

type ProjectAgentHookRuntimeInput = {
  dataDir: string;
  event: ProjectAgentHookEvent;
  executionId: string;
  hooks: ProjectAgentHooks;
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  matchQuery?: string;
  name: AgentCallableToolName;
  projectId: string;
  reasoningEffort?: ZenmeReasoningEffort;
  rootId?: string;
  signal?: AbortSignal;
  arguments: Record<string, unknown>;
  output?: unknown;
  error?: unknown;
  callModel?: HookModelCaller;
  onAsyncRewake?: (result: ProjectAgentHookRuntimeResult) => void | Promise<void>;
  onHookSuccess?: (
    event: ProjectAgentHookEvent,
    hook: ProjectAgentHook,
    matcher: ProjectAgentHookMatcher,
  ) => void | Promise<void>;
};

export type ProjectAgentHookRuntimeResult = {
  additionalContext?: string;
  arguments?: Record<string, unknown>;
  elicitation?: {
    action: "accept" | "decline" | "cancel";
    content?: Record<string, string | number | boolean | string[]>;
  };
  output?: unknown;
  permission?: "allow" | "ask" | "deny";
  preventContinuation?: boolean;
  reason?: string;
};

const LEGACY_TOOL_NAMES: Partial<Record<AgentCallableToolName, string[]>> = {
  shell_command: ["Bash", "PowerShell"],
  read_file: ["Read"],
  view_image: ["Read"],
  write_file: ["Write"],
  edit_file: ["Edit"],
  apply_patch: ["Edit"],
  glob_files: ["Glob"],
  search_files: ["Grep"],
  web_fetch: ["WebFetch"],
  web_search: ["WebSearch"],
  agent_spawn: ["Agent", "Task"],
  skill: ["Skill"],
};

export function createProjectAgentToolHooks<Output = unknown>(input: Omit<ProjectAgentHookRuntimeInput, "event" | "arguments" | "output" | "error">) {
  return {
    preHooks: [async (context: { arguments: Record<string, unknown> }) =>
      runProjectAgentHooks({ ...input, event: "PreToolUse", arguments: context.arguments }) as Promise<AgentToolPreHookResult<Record<string, unknown>> | undefined>],
    postSuccessHooks: [async (context: { arguments: Record<string, unknown>; output: Output }) =>
      runProjectAgentHooks({ ...input, event: "PostToolUse", arguments: context.arguments, output: context.output }) as Promise<AgentToolPostHookResult<Output> | undefined>],
    postFailureHooks: [async (context: { arguments: Record<string, unknown>; error: unknown }) =>
      runProjectAgentHooks({ ...input, event: "PostToolUseFailure", arguments: context.arguments, error: context.error }) as Promise<AgentToolFailureHookResult | undefined>],
    permissionRequestHooks: [async (context: { arguments: Record<string, unknown> }) =>
      runProjectAgentHooks({ ...input, event: "PermissionRequest", arguments: context.arguments }) as Promise<AgentToolPermissionHookResult<Record<string, unknown>> | undefined>],
    permissionDeniedHooks: [async (context: { arguments: Record<string, unknown>; reason: string }) =>
      runProjectAgentHooks({ ...input, event: "PermissionDenied", arguments: context.arguments, error: context.reason }) as Promise<AgentToolFailureHookResult | undefined>],
  };
}

async function runProjectAgentHooks(input: ProjectAgentHookRuntimeInput): Promise<ProjectAgentHookRuntimeResult | undefined> {
  const configured = input.hooks[input.event] ?? [];
  const hooks = configured.flatMap((matcher) => matchesHookMatcher(matcher.matcher, input)
    ? matcher.hooks.map((hook) => ({ hook, matcher }))
    : []);
  const results: ProjectAgentHookRuntimeResult[] = [];
  for (const { hook, matcher } of hooks) {
    if (!matchesIf(hook.if, input.name, input.arguments)) continue;
    if (hook.type === "command" && (hook.async || hook.asyncRewake)) {
      void executeHook(input, hook, matcher).then(async (result) => {
        if (hook.once && result.permission !== "deny" && !result.preventContinuation) {
          await input.onHookSuccess?.(input.event, hook, matcher);
        }
        // Match cc-haha: an async hook is silent on ordinary completion.
        // asyncRewake only wakes the Agent for a blocking result (exit 2 /
        // continue:false), not for every successful background hook.
        if (hook.asyncRewake && (result.permission === "deny" || result.preventContinuation)) {
          await input.onAsyncRewake?.(result);
        }
      }).catch(() => undefined);
      continue;
    }
    const result = await executeHook(input, hook, matcher);
    results.push(result);
    if (hook.once && result.permission !== "deny" && !result.preventContinuation) {
      await input.onHookSuccess?.(input.event, hook, matcher);
    }
  }
  return mergeHookResults(results);
}

export async function runProjectAgentLifecycleHooks(input: Omit<ProjectAgentHookRuntimeInput, "name" | "arguments" | "output" | "error"> & {
  event: Exclude<ProjectAgentHookEvent, "PreToolUse" | "PostToolUse" | "PostToolUseFailure">;
  payload?: Record<string, unknown>;
}) {
  return runProjectAgentHooks({
    ...input,
    name: "agent_spawn",
    arguments: input.payload ?? {},
  });
}

function matchesHookMatcher(matcher: string | undefined, input: ProjectAgentHookRuntimeInput) {
  if (!input.matchQuery) return matchesTool(matcher, input.name);
  if (!matcher) return true;
  try { return new RegExp(matcher, "i").test(input.matchQuery); } catch { return false; }
}

async function executeHook(
  input: ProjectAgentHookRuntimeInput,
  hook: ProjectAgentHook,
  matcher: ProjectAgentHookMatcher,
): Promise<ProjectAgentHookRuntimeResult> {
  const payload = hookPayload(input);
  if (hook.type === "command") {
    const proposed = await proposeAgentCommand({
      projectId: input.projectId,
      executionId: input.executionId,
      rootId: input.rootId,
      command: substitutePluginHookValue(substitutePluginHookPaths(hook.command, matcher), matcher),
      reason: `${input.event} Agent Hook`,
      timeoutMs: secondsToMilliseconds(hook.timeout),
      background: false,
    }, input.dataDir);
    if (proposed.sandboxMode === "danger-full-access") {
      throw new Error(`${input.event} Hook 命令超出 Workspace 范围`);
    }
    await approveAgentCommand(input.projectId, input.executionId, proposed.id, input.dataDir);
    const completed = await runApprovedAgentCommand({
      projectId: input.projectId,
      executionId: input.executionId,
      commandId: proposed.id,
      foregroundBudgetMs: secondsToMilliseconds(hook.timeout),
      stdin: `${JSON.stringify(payload)}\n`,
      environment: pluginHookEnvironment(matcher),
      signal: input.signal,
    }, input.dataDir);
    if ("status" in completed && completed.status === "running") return {};
    const exitCode = "exitCode" in completed ? completed.exitCode : null;
    const stdout = "stdout" in completed ? completed.stdout ?? "" : "";
    const stderr = "stderr" in completed ? completed.stderr ?? "" : "";
    if (exitCode === 2) return { permission: "deny", reason: stderr.trim() || stdout.trim() || "Hook 已阻止操作" };
    if (exitCode !== 0) throw new Error(stderr.trim() || `Hook 命令失败（exit ${exitCode ?? "unknown"}）`);
    return parseHookOutput(stdout, input.event);
  }
  if (hook.type === "http") {
    const response = await fetch(substitutePluginHookValue(hook.url, matcher), {
      method: "POST",
      headers: { "content-type": "application/json", ...expandHeaders(substitutePluginHookHeaders(hook.headers, matcher), hook.allowedEnvVars) },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([input.signal ?? new AbortController().signal, AbortSignal.timeout(secondsToMilliseconds(hook.timeout))]),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP Hook 失败（${response.status}）：${body.slice(0, 1_000)}`);
    return parseHookOutput(body, input.event);
  }
  if (!input.callModel) throw new Error(`${hook.type} Hook 缺少模型运行时`);
  if (hook.type === "agent") {
    return executeAgentHook(input, hook, matcher);
  }
  const elicitationInstruction = input.event === "Elicitation" || input.event === "ElicitationResult"
    ? `，也可返回 "action": "accept" | "decline" | "cancel" 以及可选的对象 "content"`
    : "";
  const response = await input.callModel({
    model: hook.model?.trim() || input.model,
    context: `你正在执行 ${input.event} Hook。只返回 JSON：{\"ok\": boolean, \"reason\"?: string, \"additionalContext\"?: string${elicitationInstruction}}。`,
    prompt: `${substitutePluginHookContent(hook.prompt, matcher)}\n\nHook 输入：\n${JSON.stringify(payload)}`,
    mode: "agent_planning",
    reasoningEffort: input.reasoningEffort,
    modelSpeed: input.modelSpeed,
    signal: input.signal,
  });
  return parseModelHookOutput(response, input.event);
}

const AGENT_HOOK_MAX_TURNS = 50;
const AGENT_HOOK_DISALLOWED_TOOLS = new Set<AgentWorkspaceToolName>([
  "agent_spawn",
  "delegate_tasks",
  "task_output",
  "task_stop",
  "ask_user_question",
  "enter_plan_mode",
  "exit_plan_mode",
  "workflow",
]);
const HOOK_RESULT_TOOL: NativeAgentTool = {
  name: "hook_result",
  description: "Finish this hook-agent run with the structured hook decision.",
  parameters: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      reason: { type: "string" },
      additionalContext: { type: "string" },
      action: { type: "string", enum: ["accept", "decline", "cancel"] },
      content: { type: "object", additionalProperties: true },
    },
    required: ["ok"],
    additionalProperties: false,
  },
};

async function executeAgentHook(
  input: ProjectAgentHookRuntimeInput,
  hook: ProjectAgentHook,
  matcher: ProjectAgentHookMatcher,
): Promise<ProjectAgentHookRuntimeResult> {
  if (hook.type !== "agent") throw new Error("Agent Hook 类型无效");
  const [{ createAgentExecution, completeAgentExecution, getAgentExecution }, { executeAgentWorkspaceTool }] = await Promise.all([
    import("@/lib/agent/execution-store"),
    import("@/lib/agent/workspace-tools"),
  ]);
  const parent = await getAgentExecution(input.projectId, input.executionId, input.dataDir);
  if (!parent) throw new Error(`${input.event} Agent Hook 的父 Execution 不存在`);
  const inheritedTools = parent.context.allowedTools ?? MODEL_AGENT_TOOL_DEFINITIONS.map((definition) => definition.name);
  const allowedTools = inheritedTools.filter((name) => !AGENT_HOOK_DISALLOWED_TOOLS.has(name));
  const processedPrompt = substitutePluginHookContent(hook.prompt, matcher)
    .replace(/\$ARGUMENTS/g, JSON.stringify(hookPayload(input)));
  const child = await createAgentExecution({
    projectId: input.projectId,
    agentId: `hook-agent:${input.event}:${crypto.randomUUID()}`,
    instruction: processedPrompt,
    resultNodeId: parent.resultNodeId ?? input.executionId,
    triggerNodeId: parent.triggerNodeId ?? parent.resultNodeId ?? input.executionId,
    selectedNodeIds: parent.context.selectedNodeIds,
    fileDocumentIds: parent.context.fileDocumentIds,
    canvasContext: parent.context.canvasContext,
    workspaceRootId: parent.context.workspaceRootId,
    allowedPathPrefixes: parent.context.allowedPathPrefixes,
    allowedTools,
    permissionMode: "neverAsk",
    allowWithoutWorkspace: !parent.context.workspaceRootId,
  }, input.dataDir);
  const messages: ChatMessage[] = [{ role: "user", content: processedPrompt }];
  const context = [
    `You are running a ${input.event} hook as a bounded verification agent.`,
    "Use the available tools to inspect real state. Do not spawn other agents or enter plan mode.",
    "When you have a decision, call hook_result exactly once. ok=false means the hook condition is not satisfied.",
  ].join("\n");
  const hookModel = hook.model?.trim() || input.model;
  try {
    for (let turn = 0; turn < AGENT_HOOK_MAX_TURNS; turn += 1) {
      const response = await input.callModel!({
        model: hookModel,
        context,
        prompt: processedPrompt,
        messages,
        allowedAgentTools: allowedTools,
        additionalAgentTools: [HOOK_RESULT_TOOL],
        reasoningEffort: input.reasoningEffort,
        modelSpeed: input.modelSpeed,
        signal: input.signal,
      });
      const calls = response.toolCalls?.length ? response.toolCalls : response.toolCall ? [response.toolCall] : [];
      if (!calls.length) {
        messages.push({ role: "assistant", content: response.text });
        messages.push({ role: "user", content: "Finish by calling hook_result with the structured decision." });
        continue;
      }
      const toolCalls = calls.map((call, index) => ({
        id: `hook-${turn}-${index}-${crypto.randomUUID()}`,
        name: call.name,
        arguments: call.arguments,
      }));
      messages.push({ role: "assistant", content: response.text, toolCalls });
      for (const call of toolCalls) {
        if (call.name === HOOK_RESULT_TOOL.name) {
          const result = hookAgentResult(call.arguments, input.event);
          await completeAgentExecution({
            projectId: input.projectId,
            executionId: child.detail.id,
            status: "succeeded",
            resultSummary: result.permission === "deny" || result.preventContinuation ? result.reason ?? "Hook blocked" : "Hook completed",
          }, input.dataDir);
          return result;
        }
        if (!allowedTools.includes(call.name as AgentWorkspaceToolName)) {
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: `Tool ${call.name} is not available to hook agents.` });
          continue;
        }
        try {
          const output = await executeAgentWorkspaceTool({
            projectId: input.projectId,
            executionId: child.detail.id,
            name: call.name as AgentWorkspaceToolName,
            arguments: (isRecord(call.arguments) ? call.arguments : {}) as never,
            delegatedModel: hookModel,
            delegatedCallModel: input.callModel,
            delegatedReasoningEffort: input.reasoningEffort,
            delegatedModelSpeed: input.modelSpeed,
            signal: input.signal,
          }, input.dataDir);
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: safeJson(output) });
        } catch (error) {
          messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    await completeAgentExecution({
      projectId: input.projectId,
      executionId: child.detail.id,
      status: "succeeded",
      resultSummary: "Hook agent reached its bounded turn limit without a structured decision",
    }, input.dataDir);
    return {};
  } catch (error) {
    await completeAgentExecution({
      projectId: input.projectId,
      executionId: child.detail.id,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    }, input.dataDir).catch(() => undefined);
    return {};
  }
}

function hookAgentResult(value: unknown, event: ProjectAgentHookEvent): ProjectAgentHookRuntimeResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") return {};
  const parsed = value;
  const ok = parsed.ok;
  const reason = stringValue(parsed.reason);
  return {
    ...(elicitationValue(parsed) ? { elicitation: elicitationValue(parsed) } : {}),
    ...(stringValue(parsed.additionalContext) ? { additionalContext: stringValue(parsed.additionalContext) } : {}),
    ...(!ok && (event === "PreToolUse" || event === "PermissionRequest")
      ? { permission: "deny" as const, reason: reason || "Hook 已阻止操作" }
      : {}),
    ...(!ok && event !== "PreToolUse" && event !== "PermissionRequest"
      ? { preventContinuation: true, ...(reason ? { reason } : {}) }
      : {}),
  };
}

function safeJson(value: unknown) {
  try { return JSON.stringify(value); } catch { return String(value); }
}

function substitutePluginHookPaths(command: string, matcher: ProjectAgentHookMatcher) {
  return command
    .replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, matcher.pluginRoot ?? matcher.skillRoot ?? "")
    .replace(/\$\{CLAUDE_SKILL_DIR\}/g, matcher.skillRoot ?? "")
    .replace(/\$\{CLAUDE_PLUGIN_DATA\}/g, pluginDataDirectory(matcher) ?? "");
}

function pluginHookEnvironment(matcher: ProjectAgentHookMatcher) {
  const dataDirectory = pluginDataDirectory(matcher);
  return {
    ...(matcher.pluginRoot || matcher.skillRoot ? { CLAUDE_PLUGIN_ROOT: matcher.pluginRoot ?? matcher.skillRoot } : {}),
    ...(matcher.skillRoot ? { CLAUDE_SKILL_DIR: matcher.skillRoot } : {}),
    ...(dataDirectory ? { CLAUDE_PLUGIN_DATA: dataDirectory } : {}),
    ...Object.fromEntries(Object.entries(matcher.pluginOptions?.values ?? {}).map(([key, value]) => [
      `CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`,
      Array.isArray(value) ? value.join(",") : String(value),
    ])),
  };
}

function substitutePluginHookValue(value: string, matcher: ProjectAgentHookMatcher) {
  return matcher.pluginOptions ? substitutePluginUserConfigRuntime(value, {
    ...matcher.pluginOptions,
  }) : value;
}

function substitutePluginHookContent(value: string, matcher: ProjectAgentHookMatcher) {
  return matcher.pluginOptions ? substitutePluginUserConfigInContent(value, {
    ...matcher.pluginOptions,
  }) : value;
}

function substitutePluginHookHeaders(headers: Record<string, string> | undefined, matcher: ProjectAgentHookMatcher) {
  return headers && Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, substitutePluginHookValue(value, matcher)]));
}

function pluginDataDirectory(matcher: ProjectAgentHookMatcher) {
  if (matcher.pluginDataRoot) return matcher.pluginDataRoot;
  if (!matcher.pluginRoot || !matcher.pluginId) return undefined;
  const safeId = matcher.pluginId.replace(/[^A-Za-z0-9._@-]/g, "_");
  return path.join(path.dirname(path.dirname(matcher.pluginRoot)), "data", safeId);
}

function parseModelHookOutput(response: ProjectAgentModelResponse, event: ProjectAgentHookEvent) {
  const parsed = parseJsonObject(response.text);
  if (!parsed) return { additionalContext: response.text };
  const ok = parsed.ok !== false;
  return {
    ...(elicitationValue(parsed) ? { elicitation: elicitationValue(parsed) } : {}),
    ...(typeof parsed.additionalContext === "string" ? { additionalContext: parsed.additionalContext } : {}),
    ...(!ok && (event === "PreToolUse" || event === "PermissionRequest")
      ? { permission: "deny" as const, reason: stringValue(parsed.reason) || "Hook 已阻止操作" }
      : {}),
    ...(!ok && event !== "PreToolUse" && event !== "PermissionRequest" ? { preventContinuation: true } : {}),
  };
}

function parseHookOutput(output: string, event: ProjectAgentHookEvent): ProjectAgentHookRuntimeResult {
  const trimmed = output.trim();
  if (!trimmed) return {};
  const parsed = parseJsonObject(trimmed);
  if (!parsed) return { additionalContext: trimmed };
  const specific = isRecord(parsed.hookSpecificOutput) ? parsed.hookSpecificOutput : {};
  const permission = permissionValue(specific.permissionDecision) ?? decisionPermission(parsed.decision);
  const updatedInput = isRecord(specific.updatedInput) ? specific.updatedInput : undefined;
  const updatedOutput = specific.updatedMCPToolOutput;
  const elicitation = (event === "Elicitation" || event === "ElicitationResult")
    ? elicitationValue(specific) ?? elicitationValue(parsed)
    : undefined;
  return {
    ...(elicitation ? { elicitation } : {}),
    ...(permission ? { permission } : {}),
    ...(updatedInput ? { arguments: updatedInput } : {}),
    ...(updatedOutput !== undefined ? { output: updatedOutput } : {}),
    ...(stringValue(specific.additionalContext) || stringValue(parsed.systemMessage)
      ? { additionalContext: stringValue(specific.additionalContext) || stringValue(parsed.systemMessage) }
      : {}),
    ...(parsed.continue === false ? { preventContinuation: true } : {}),
    ...(stringValue(specific.permissionDecisionReason) || stringValue(parsed.reason) || stringValue(parsed.stopReason)
      ? { reason: stringValue(specific.permissionDecisionReason) || stringValue(parsed.reason) || stringValue(parsed.stopReason) }
      : {}),
    ...(parsed.continue === false && event !== "PreToolUse" ? { preventContinuation: true } : {}),
  };
}

function elicitationValue(value: Record<string, unknown>): ProjectAgentHookRuntimeResult["elicitation"] {
  const action = value.action;
  if (action !== "accept" && action !== "decline" && action !== "cancel") return undefined;
  return {
    action,
    ...(isElicitationContent(value.content) ? { content: value.content } : {}),
  };
}

function isElicitationContent(value: unknown): value is Record<string, string | number | boolean | string[]> {
  return isRecord(value) && Object.values(value).every((item) =>
    typeof item === "string" || typeof item === "number" || typeof item === "boolean" ||
    (Array.isArray(item) && item.every((entry) => typeof entry === "string")));
}

function hookPayload(input: ProjectAgentHookRuntimeInput) {
  if (!TOOL_LIFECYCLE_EVENTS.has(input.event)) {
    return {
      hook_event_name: input.event,
      session_id: input.executionId,
      ...input.arguments,
    };
  }
  return {
    hook_event_name: input.event,
    session_id: input.executionId,
    tool_name: (LEGACY_TOOL_NAMES[input.name] ?? [input.name])[0],
    tool_input: input.arguments,
    ...(input.output !== undefined ? { tool_response: input.output } : {}),
    ...(input.error !== undefined ? { error: input.error instanceof Error ? input.error.message : String(input.error) } : {}),
  };
}

const TOOL_LIFECYCLE_EVENTS = new Set<ProjectAgentHookEvent>([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PermissionDenied",
]);

function matchesTool(matcher: string | undefined, name: AgentCallableToolName) {
  if (!matcher) return true;
  const candidates = [name, ...(LEGACY_TOOL_NAMES[name] ?? [])];
  try { const pattern = new RegExp(matcher, "i"); return candidates.some((candidate) => pattern.test(candidate)); }
  catch { return false; }
}

function matchesIf(condition: string | undefined, name: AgentCallableToolName, args: Record<string, unknown>) {
  if (!condition) return true;
  const match = condition.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\(([\s\S]*)\))?$/);
  if (!match || !matchesTool(`^${escapeRegExp(match[1])}$`, name)) return false;
  if (!match[2]) return true;
  const command = typeof args.command === "string" ? args.command : "";
  const pattern = `^${escapeRegExp(match[2]).replace(/\\\*/g, ".*")}$`;
  return Boolean(command) && new RegExp(pattern, "i").test(command);
}

function mergeHookResults(results: ProjectAgentHookRuntimeResult[]): ProjectAgentHookRuntimeResult | undefined {
  if (!results.length) return undefined;
  const contexts = results.map((result) => result.additionalContext).filter((value): value is string => Boolean(value));
  return {
    elicitation: [...results].reverse().find((result) => result.elicitation)?.elicitation,
    arguments: results.reduce<Record<string, unknown> | undefined>((current, result) => result.arguments ?? current, undefined),
    output: results.reduce<unknown>((current, result) => result.output ?? current, undefined),
    permission: results.reduce<"allow" | "ask" | "deny" | undefined>((current, result) => stricterPermission(current, result.permission), undefined),
    preventContinuation: results.some((result) => result.preventContinuation),
    reason: [...results].reverse().find((result) => result.reason)?.reason,
    additionalContext: contexts.length ? contexts.join("\n\n") : undefined,
  };
}

function stricterPermission(left?: "allow" | "ask" | "deny", right?: "allow" | "ask" | "deny") {
  if (left === "deny" || right === "deny") return "deny";
  if (left === "ask" || right === "ask") return "ask";
  return left ?? right;
}
function permissionValue(value: unknown) { return value === "allow" || value === "ask" || value === "deny" ? value : undefined; }
function decisionPermission(value: unknown) { return value === "approve" ? "allow" : value === "block" ? "deny" : undefined; }
function parseJsonObject(value: string) { try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : null; } catch { return null; } }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value: unknown) { return typeof value === "string" ? value.trim().slice(0, 100_000) : ""; }
function secondsToMilliseconds(value: number | undefined) { return Math.max(1_000, Math.min(300_000, Math.round((value ?? 60) * 1_000))); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function expandHeaders(headers: Record<string, string> | undefined, allowed: string[] | undefined) {
  const allow = new Set(allowed ?? []);
  return Object.fromEntries(Object.entries(headers ?? {}).map(([key, value]) => [key, value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => allow.has(name) ? process.env[name] ?? "" : "")]));
}
