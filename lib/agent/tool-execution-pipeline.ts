import {
  finishAgentToolCall,
  startAgentToolCall,
} from "@/lib/agent/execution-store";
import type { AgentCallableToolName } from "@/lib/agent/types";
import { getZenmeDataDir } from "@/lib/local/data-dir";

export type AgentToolPermissionDecision = "allow" | "ask" | "deny";

export type AgentToolHookContext<Arguments extends Record<string, unknown>> = {
  arguments: Arguments;
  executionId: string;
  name: AgentCallableToolName;
  projectId: string;
};

export type AgentToolPreHookResult<Arguments extends Record<string, unknown>> = {
  additionalContext?: string;
  arguments?: Arguments;
  permission?: AgentToolPermissionDecision;
  preventContinuation?: boolean;
  reason?: string;
};

export type AgentToolPostHookResult<Output> = {
  additionalContext?: string;
  output?: Output;
  preventContinuation?: boolean;
};

export type AgentToolFailureHookResult = {
  additionalContext?: string;
  preventContinuation?: boolean;
};

export type AgentToolPermissionHookResult<Arguments extends Record<string, unknown>> = {
  additionalContext?: string;
  arguments?: Arguments;
  permission?: AgentToolPermissionDecision;
  reason?: string;
};

export type AgentToolExecutionResult<Arguments extends Record<string, unknown>, Output> = {
  arguments: Arguments;
  additionalContext: string[];
  output: Output;
  persistedOutput: unknown;
  preventContinuation: boolean;
  toolCallId: string;
};

export class AgentToolPipelineError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_arguments" | "permission_denied" | "approval_required",
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "AgentToolPipelineError";
  }
}

/**
 * Canonical Agent tool lifecycle, matching cc-haha's ToolOrchestration order:
 * validate -> PreToolUse -> permission -> execute -> PostToolUse/PostToolUseFailure.
 *
 * Validation and permission failures intentionally happen before a persisted running
 * tool call is created. Once execution starts, the call is completed exactly once.
 */
export async function executeAgentToolPipeline<
  Arguments extends Record<string, unknown>,
  Output,
>(input: {
  arguments: Arguments;
  authorize?: (context: AgentToolHookContext<Arguments> & {
    hookPermission?: AgentToolPermissionDecision;
    hookReason?: string;
  }) => Promise<AgentToolPermissionDecision | AgentToolAuthorizationResult | void>
    | AgentToolPermissionDecision | AgentToolAuthorizationResult | void;
  execute: (context: AgentToolHookContext<Arguments>) => Promise<Output>;
  executionId: string;
  name: AgentCallableToolName;
  onPermissionRequestResolved?: (decision: "allow" | "deny", context: AgentToolHookContext<Arguments> & {
    reason?: string;
  }) => Promise<void> | void;
  persistOutput?: (output: Output, metadata: {
    additionalContext: string[];
    preventContinuation: boolean;
    toolCallId: string;
  }) => unknown | Promise<unknown>;
  permissionDeniedHooks?: ReadonlyArray<(context: AgentToolHookContext<Arguments> & {
    reason: string;
  }) => Promise<AgentToolFailureHookResult | void> | AgentToolFailureHookResult | void>;
  permissionRequestHooks?: ReadonlyArray<(context: AgentToolHookContext<Arguments>) =>
    Promise<AgentToolPermissionHookResult<Arguments> | void> | AgentToolPermissionHookResult<Arguments> | void>;
  postFailureHooks?: ReadonlyArray<(context: AgentToolHookContext<Arguments> & {
    error: unknown;
  }) => Promise<AgentToolFailureHookResult | void> | AgentToolFailureHookResult | void>;
  postSuccessHooks?: ReadonlyArray<(context: AgentToolHookContext<Arguments> & {
    output: Output;
  }) => Promise<AgentToolPostHookResult<Output> | void> | AgentToolPostHookResult<Output> | void>;
  preHooks?: ReadonlyArray<(context: AgentToolHookContext<Arguments>) =>
    Promise<AgentToolPreHookResult<Arguments> | void> | AgentToolPreHookResult<Arguments> | void>;
  projectId: string;
  validate?: (argumentsValue: Arguments) => boolean;
}, dataDir = getZenmeDataDir()): Promise<AgentToolExecutionResult<Arguments, Output>> {
  const validate = input.validate ?? (() => true);
  if (!validate(input.arguments)) {
    throw new AgentToolPipelineError("Agent 工具参数无效", "invalid_arguments");
  }

  let argumentsValue = input.arguments;
  let hookPermission: AgentToolPermissionDecision | undefined;
  let hookReason: string | undefined;
  let preventContinuation = false;
  const additionalContext: string[] = [];

  for (const hook of input.preHooks ?? []) {
    const result = await hook(toolContext(input, argumentsValue));
    if (!result) continue;
    if (result.arguments) argumentsValue = result.arguments;
    if (!validate(argumentsValue)) {
      throw new AgentToolPipelineError("PreToolUse Hook 返回了无效工具参数", "invalid_arguments");
    }
    if (result.permission) hookPermission = stricterPermission(hookPermission, result.permission);
    if (result.reason) hookReason = result.reason;
    if (result.additionalContext) additionalContext.push(result.additionalContext);
    preventContinuation ||= Boolean(result.preventContinuation);
  }

  if (hookPermission === "deny") return denyToolUse(input, argumentsValue,
    hookReason || "PreToolUse Hook 已拒绝工具调用", additionalContext);
  const authorizationResult = await input.authorize?.({
    ...toolContext(input, argumentsValue),
    hookPermission,
    hookReason,
  });
  const authorization = typeof authorizationResult === "object" && authorizationResult
    ? authorizationResult.decision
    : authorizationResult;
  const authorizationDetail = typeof authorizationResult === "object" && authorizationResult
    ? authorizationResult.detail
    : undefined;
  const authorizationReason = typeof authorizationResult === "object" && authorizationResult
    ? authorizationResult.reason
    : undefined;
  const permission = stricterPermission(hookPermission, authorization);
  if (permission === "deny") {
    return denyToolUse(input, argumentsValue,
      authorizationReason || hookReason || "工具调用已被权限策略拒绝", additionalContext);
  }
  if (permission === "ask") {
    let requestPermission: AgentToolPermissionDecision | undefined;
    let requestReason: string | undefined;
    for (const hook of input.permissionRequestHooks ?? []) {
      const result = await hook(toolContext(input, argumentsValue));
      if (!result) continue;
      if (result.arguments) argumentsValue = result.arguments;
      if (!validate(argumentsValue)) {
        throw new AgentToolPipelineError("PermissionRequest Hook 返回了无效工具参数", "invalid_arguments");
      }
      if (result.permission) requestPermission = stricterPermission(requestPermission, result.permission);
      if (result.reason) requestReason = result.reason;
      if (result.additionalContext) additionalContext.push(result.additionalContext);
    }
    if (requestPermission === "deny") {
      await input.onPermissionRequestResolved?.("deny", {
        ...toolContext(input, argumentsValue),
        reason: requestReason,
      });
      return denyToolUse(input, argumentsValue,
        requestReason || "PermissionRequest Hook 已拒绝工具调用", additionalContext);
    }
    if (requestPermission !== "allow") {
      throw new AgentToolPipelineError(
        requestReason || authorizationReason || hookReason || "工具调用需要用户批准",
        "approval_required",
        authorizationDetail,
      );
    }
    await input.onPermissionRequestResolved?.("allow", {
      ...toolContext(input, argumentsValue),
      reason: requestReason,
    });
  }

  const call = await startAgentToolCall({
    projectId: input.projectId,
    executionId: input.executionId,
    name: input.name,
    arguments: argumentsValue,
  }, dataDir);
  try {
    // `execute` is declared as Promise<Output>; normalize TypeScript's generic
    // `Awaited<Output>` inference back to the public pipeline output contract.
    let output = await input.execute(toolContext(input, argumentsValue)) as Output;
    for (const hook of input.postSuccessHooks ?? []) {
      const result = await hook({ ...toolContext(input, argumentsValue), output });
      if (!result) continue;
      if (result.output !== undefined) output = result.output;
      if (result.additionalContext) additionalContext.push(result.additionalContext);
      preventContinuation ||= Boolean(result.preventContinuation);
    }
    const persistedOutput = input.persistOutput
      ? await input.persistOutput(output, { additionalContext, preventContinuation, toolCallId: call.id })
      : output;
    const changeSetId = changeSetIdFromOutput(output);
    await finishAgentToolCall({
      projectId: input.projectId,
      executionId: input.executionId,
      toolCallId: call.id,
      output: persistedOutput,
      changeSetId,
    }, dataDir);
    return {
      arguments: argumentsValue,
      additionalContext,
      output,
      persistedOutput,
      preventContinuation,
      toolCallId: call.id,
    };
  } catch (error) {
    for (const hook of input.postFailureHooks ?? []) {
      try {
        const result = await hook({ ...toolContext(input, argumentsValue), error });
        if (result?.additionalContext) additionalContext.push(result.additionalContext);
        preventContinuation ||= Boolean(result?.preventContinuation);
      } catch {
        // Failure hooks are observational and must not replace the original tool error.
      }
    }
    await finishAgentToolCall({
      projectId: input.projectId,
      executionId: input.executionId,
      toolCallId: call.id,
      error: safeErrorMessage(error),
    }, dataDir).catch(() => undefined);
    throw error;
  }
}

type AgentToolAuthorizationResult = {
  decision: AgentToolPermissionDecision;
  detail?: unknown;
  reason?: string;
};

async function denyToolUse<Arguments extends Record<string, unknown>>(
  input: {
    executionId: string;
    name: AgentCallableToolName;
    permissionDeniedHooks?: ReadonlyArray<(context: AgentToolHookContext<Arguments> & {
      reason: string;
    }) => Promise<AgentToolFailureHookResult | void> | AgentToolFailureHookResult | void>;
    projectId: string;
  },
  argumentsValue: Arguments,
  reason: string,
  additionalContext: string[],
): Promise<never> {
  for (const hook of input.permissionDeniedHooks ?? []) {
    try {
      const result = await hook({ ...toolContext(input, argumentsValue), reason });
      if (result?.additionalContext) additionalContext.push(result.additionalContext);
    } catch {
      // PermissionDenied hooks are observational and cannot make denial less strict.
    }
  }
  throw new AgentToolPipelineError(reason, "permission_denied", {
    additionalContext,
  });
}

function toolContext<Arguments extends Record<string, unknown>>(input: {
  executionId: string;
  name: AgentCallableToolName;
  projectId: string;
}, argumentsValue: Arguments): AgentToolHookContext<Arguments> {
  return {
    projectId: input.projectId,
    executionId: input.executionId,
    name: input.name,
    arguments: argumentsValue,
  };
}

function stricterPermission(
  left?: AgentToolPermissionDecision,
  right?: AgentToolPermissionDecision | void,
): AgentToolPermissionDecision | undefined {
  if (left === "deny" || right === "deny") return "deny";
  if (left === "ask" || right === "ask") return "ask";
  if (left === "allow" || right === "allow") return "allow";
  return undefined;
}

function changeSetIdFromOutput(output: unknown) {
  return output && typeof output === "object" && "changeSetId" in output
    && typeof output.changeSetId === "string"
    ? output.changeSetId
    : undefined;
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Agent 工具执行失败";
}
