import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  type AgentCommandProgress,
  type AgentCommandStall,
  approveAgentCommand,
  getAgentBackgroundTask,
  proposeAgentCommand,
  rejectAgentCommand,
  runApprovedAgentCommand,
  stopAgentBackgroundTask,
} from "@/lib/agent/command-runtime";
import {
  getAgentExecution,
  setAgentExecutionWorkspaceRoot,
} from "@/lib/agent/execution-store";
import { AgentToolPipelineError, executeAgentToolPipeline } from "@/lib/agent/tool-execution-pipeline";
import {
  evaluateProjectToolPermission,
  isProjectToolBlanketDenied,
  loadProjectPermissionRules,
} from "@/lib/agent/project-permission-rules";
import { createProjectAgentToolHooks, runProjectAgentLifecycleHooks } from "@/lib/agent/project-agent-hook-runtime";
import type { ProjectAgentHookRuntimeResult } from "@/lib/agent/project-agent-hook-runtime";
import { mergeProjectAgentHooks, type ProjectAgentHook, type ProjectAgentHookEvent, type ProjectAgentHookMatcher } from "@/lib/agent/project-agent-hooks";
import type {
  AgentBackgroundTaskSnapshot,
  AgentCommandRequest,
  AgentExecutionDetail,
  AgentWorkflowTaskSnapshot,
  AgentWorkspaceToolArguments,
  AgentWorkspaceToolName,
  AgentWorkspaceToolResult,
} from "@/lib/agent/types";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import type { ZenmeModelSpeed, ZenmeReasoningEffort } from "@/lib/local/settings";
import type { GlobalOrchestration } from "@/lib/global-agent/types";
import type { AgentWorkflowProgressEvent } from "@/lib/agent/workflow-types";
import { addLocalWorkspaceRoot, getLocalWorkspaceBinding, removeLocalWorkspaceRoot } from "@/lib/local/workspace-repository";
import { createWorkspaceChangeSet, listWorkspaceChangeSets } from "@/lib/workspace/change-sets";
import { createProjectMemory } from "@/lib/memory/repository";
import { searchProjectKnowledge } from "@/lib/knowledge/index-store";
import {
  isSensitiveWorkspacePath,
  listWorkspaceFiles,
  MAX_WORKSPACE_TEXT_BYTES,
} from "@/lib/workspace/workspace-files";
import {
  canUseWorkspaceRootCapability,
  listWorkspaceRoots,
  resolveWorkspaceRoot,
} from "@/lib/workspace/types";
import { resolveExistingWorkspacePath } from "@/lib/workspace/workspace-inspection";
import { searchProjectWeb } from "@/lib/agent/web-search";
import { fetchProjectWebPage } from "@/lib/agent/web-fetch";
import { AGENT_TOOL_NAMES, getAgentToolDefinition, searchAgentToolDefinitions } from "@/lib/agent/tool-registry";
import {
  appendProjectAgentEvent,
  createProjectAgentTask,
  getProjectAgentConversationRuntimeState,
  getProjectAgentSession,
  getProjectAgentTask,
  listProjectAgentTasks,
  updateProjectAgentConversationContext,
  updateProjectAgentTask,
  updateProjectAgentContext,
} from "@/lib/agent/project-session-store";
import {
  createProjectAgentWorktree,
  inspectProjectAgentWorktreeChanges,
  removeProjectAgentWorktree,
} from "@/lib/agent/project-agent-worktree";
import { loadProjectSkill } from "@/lib/agent/project-skills";
import {
  formatProjectPromptShellOutput,
  projectPromptShellMatches,
  substituteProjectPromptShellOutputs,
} from "@/lib/agent/project-prompt-shell";
import { loadProjectAgentDefinition, type ProjectAgentDefinition } from "@/lib/agent/project-agents";
import {
  isProjectAgentMemoryVirtualPath,
  loadProjectAgentMemoryPrompt,
  readProjectAgentMemoryFile,
  writeProjectAgentMemoryFile,
} from "@/lib/agent/project-agent-memory";
import { collectTypeScriptDiagnostics, type CodeDiagnostic, type CodeDiagnosticsResult } from "@/lib/agent/code-diagnostics";
import { decodeCommandOutput } from "@/lib/agent/command-output-decoder";
import { isPersistedAgentToolResult, persistAgentToolResultForModel } from "@/lib/agent/tool-result-storage";
import { queryTypeScriptCodeIntelligence } from "@/lib/agent/code-intelligence";
import { collectProjectPluginLspDiagnostics, queryProjectPluginLspCodeIntelligence } from "@/lib/agent/project-plugin-lsp";
import { listProjectMcpResources, readProjectMcpResource } from "@/lib/agent/mcp-runtime";
import {
  ApplyPatchError,
  applyPatchPaths,
  applyPatchToText,
  parseApplyPatchDocument,
} from "@/lib/agent/apply-patch";
import { persistedWorkspaceImageObservation, readWorkspaceImage } from "@/lib/agent/workspace-images";
import { editAgentImages, generateAgentImages } from "@/lib/agent/image-tools";
import { controlBrowserPreview } from "@/lib/agent/browser-control";
import { estimateTextTokenCount } from "@/lib/ai/context-budget";
import {
  getProjectAgentPlanFilePath,
  isProjectAgentPlanVirtualPath,
  readProjectAgentPlan,
  writeProjectAgentPlan,
} from "@/lib/agent/project-plan";

const execFileAsync = promisify(execFile);
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_BYTES = 8 * 1024 * 1024;
const MAX_SEARCH_RESULTS = 200;
const MAX_READ_LINES = 400;
const MAX_READ_OUTPUT_TOKENS = 25_000;
const MAX_DIFF_BYTES = 2 * 1024 * 1024;
const MAX_STATUS_FILE_SCAN = 2_000;
const MAX_STATUS_RECENT_FILES = 50;
const MAX_GLOB_RESULTS = 2_000;

export const AGENT_WORKSPACE_TOOL_NAMES: readonly AgentWorkspaceToolName[] = AGENT_TOOL_NAMES;

export class AgentWorkspaceToolError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_unavailable"
      | "invalid_arguments"
      | "sensitive_path"
      | "file_unreadable",
  ) {
    super(message);
    this.name = "AgentWorkspaceToolError";
  }
}

export class AgentHookPreventContinuationError extends Error {
  constructor(readonly context: string[]) {
    super(context.at(-1) || "Agent Hook 已要求停止继续处理");
    this.name = "AgentHookPreventContinuationError";
  }
}

export async function executeAgentWorkspaceTool<Name extends AgentWorkspaceToolName>(input: {
  additionalAllowedTools?: string[];
  arguments: AgentWorkspaceToolArguments[Name];
  deferredToolSearchResults?: AgentWorkspaceToolResult["tool_search"]["tools"];
  executionId: string;
  name: Name;
  projectId: string;
  signal?: AbortSignal;
  /** Internal caller override. Model-visible Shell remains on the normal foreground budget. */
  foregroundBudgetMs?: number;
  onCommandProgress?: (progress: AgentCommandProgress) => Promise<void> | void;
  onCommandStall?: (stall: AgentCommandStall) => Promise<void> | void;
  commandStallCheckIntervalMs?: number;
  commandStallThresholdMs?: number;
  onWorkflowProgress?: (event: AgentWorkflowProgressEvent, runId: string) => Promise<void> | void;
  turnId?: string;
  delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel;
  delegatedModel?: string;
  delegatedModelSpeed?: ZenmeModelSpeed;
  delegatedReasoningEffort?: ZenmeReasoningEffort;
  onAsyncHookRewake?: (result: ProjectAgentHookRuntimeResult) => void | Promise<void>;
  onHookFeedback?: (feedback: { additionalContext: string[]; preventContinuation: boolean }) => void | Promise<void>;
  onHookSuccess?: (event: ProjectAgentHookEvent, hook: ProjectAgentHook, matcher: ProjectAgentHookMatcher) => void | Promise<void>;
  onPersistedOutput?: (output: unknown) => void | Promise<void>;
}, dataDir = getZenmeDataDir()): Promise<AgentWorkspaceToolResult[Name]> {
  if (!AGENT_WORKSPACE_TOOL_NAMES.includes(input.name)) {
    throw new AgentWorkspaceToolError("Agent 工具不存在", "invalid_arguments");
  }
  const definition = getAgentToolDefinition(input.name);
  if (!definition) throw new AgentWorkspaceToolError("Agent 工具不存在", "invalid_arguments");
  if (definition.internal && input.name !== "run_approved_command") {
    throw new AgentWorkspaceToolError("该历史兼容工具不再允许通过当前 Agent Runtime 执行", "invalid_arguments");
  }
  const execution = await getAgentExecution(input.projectId, input.executionId, dataDir);
  if (!execution) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const configuredHooks = execution.context.agentHooks && input.delegatedModel
    ? createProjectAgentToolHooks<AgentWorkspaceToolResult[Name]>({
        projectId: input.projectId,
        executionId: input.executionId,
        name: input.name,
        hooks: execution.context.agentHooks,
        rootId: execution.context.workspaceRootId,
        model: input.delegatedModel,
        reasoningEffort: input.delegatedReasoningEffort,
        modelSpeed: input.delegatedModelSpeed,
        callModel: input.delegatedCallModel,
        signal: input.signal,
        onAsyncRewake: input.onAsyncHookRewake,
        onHookSuccess: input.onHookSuccess,
        dataDir,
      })
    : undefined;
  let preparedShellCommand: AgentCommandRequest | undefined;
  let result;
  try {
    result = await executeAgentToolPipeline<Record<string, unknown>, AgentWorkspaceToolResult[Name]>({
    projectId: input.projectId,
    executionId: input.executionId,
    name: input.name,
    arguments: input.arguments as Record<string, unknown>,
    validate: (argumentsValue) => definition.validate(argumentsValue),
    preHooks: [
      async ({ arguments: argumentsValue }) => ({
        arguments: await applyExecutionWorkspaceRootScope(
          input.projectId,
          input.executionId,
          input.name,
          argumentsValue as AgentWorkspaceToolArguments[Name],
          dataDir,
        ) as Record<string, unknown>,
      }),
      ...(configuredHooks?.preHooks ?? []),
    ],
    authorize: input.name === "shell_command"
      ? async ({ arguments: argumentsValue }) => {
          const { run_in_background, background, ...commandArguments } =
            argumentsValue as AgentWorkspaceToolArguments["shell_command"];
          preparedShellCommand = await proposeAgentCommand({
            ...commandArguments,
            reason: commandArguments.reason?.trim() || shellCommandReason(commandArguments),
            background: run_in_background ?? background,
            projectId: input.projectId,
            executionId: input.executionId,
          }, dataDir);
          const permissionMode = execution.context.permissionMode ?? "onRequest";
          const permissionRules = await loadProjectPermissionRules(input.projectId, dataDir);
          const invocation = (preparedShellCommand.command ??
            [preparedShellCommand.executable, ...preparedShellCommand.args].join(" ")).trim();
          const configuredPermission = evaluateProjectToolPermission({
            content: invocation,
            name: input.name,
            rules: permissionRules,
          });
          const requiresApproval = Boolean(preparedShellCommand.externalRoot || preparedShellCommand.requiresExplicitApproval);
          const allowedByInvocation = !preparedShellCommand.externalRoot &&
            (configuredPermission === "allow" ||
              shellCommandMatchesAdditionalAllowance(preparedShellCommand, input.additionalAllowedTools));
          if (configuredPermission === "deny") {
            await rejectAgentCommand(input.projectId, input.executionId, preparedShellCommand.id, dataDir);
            return {
              decision: "deny" as const,
              detail: preparedShellCommand,
              reason: "该命令已被项目或用户权限规则拒绝。",
            };
          }
          if (permissionMode === "neverAsk" && requiresApproval && !allowedByInvocation) {
            await rejectAgentCommand(input.projectId, input.executionId, preparedShellCommand.id, dataDir);
            return {
              decision: "deny" as const,
              detail: preparedShellCommand,
              reason: preparedShellCommand.externalRoot
                ? "命令工作目录位于 Workspace 外；当前会话为“从不请求审批”，因此已直接拒绝。"
                : "该命令需要明确批准；当前会话为“从不请求审批”，因此已直接拒绝。",
            };
          }
          if (configuredPermission === "ask" || permissionMode === "untrusted" || (requiresApproval && !allowedByInvocation)) {
            return { decision: "ask" as const, detail: preparedShellCommand };
          }
          await approveAgentCommand(input.projectId, input.executionId, preparedShellCommand.id, dataDir);
          return { decision: "allow" as const, detail: preparedShellCommand };
        }
      : async ({ arguments: argumentsValue }) => {
          const permissionRules = await loadProjectPermissionRules(input.projectId, dataDir);
          const configuredPermission = evaluateProjectToolPermission({
            content: projectToolPermissionContent(input.name, argumentsValue),
            name: input.name,
            rules: permissionRules,
          });
          if (configuredPermission === "deny") {
            return {
              decision: "deny" as const,
              reason: `工具 ${input.name} 已被项目或用户权限规则拒绝。`,
            };
          }
          if (configuredPermission === "ask") {
            return {
              decision: "ask" as const,
              detail: { name: input.name, arguments: argumentsValue },
              reason: `工具 ${input.name} 需要用户批准。`,
            };
          }
          return configuredPermission;
        },
    postSuccessHooks: configuredHooks?.postSuccessHooks,
    postFailureHooks: configuredHooks?.postFailureHooks,
    permissionRequestHooks: configuredHooks?.permissionRequestHooks,
    permissionDeniedHooks: configuredHooks?.permissionDeniedHooks,
    onPermissionRequestResolved: input.name === "shell_command"
      ? async (decision) => {
          if (!preparedShellCommand) return;
          if (decision === "allow") {
            await approveAgentCommand(input.projectId, input.executionId, preparedShellCommand.id, dataDir);
          } else {
            await rejectAgentCommand(input.projectId, input.executionId, preparedShellCommand.id, dataDir);
          }
        }
      : undefined,
    execute: async ({ arguments: argumentsValue }) => input.name === "shell_command" && preparedShellCommand
      ? runApprovedAgentCommand({
          allowSandboxedWithoutExecutePermission: true,
          projectId: input.projectId,
          executionId: input.executionId,
          commandId: preparedShellCommand.id,
          foregroundBudgetMs: input.foregroundBudgetMs,
          signal: input.signal,
          onProgress: input.onCommandProgress,
          onStall: input.onCommandStall,
          stallCheckIntervalMs: input.commandStallCheckIntervalMs,
          stallThresholdMs: input.commandStallThresholdMs,
        }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>
      : runTool({
          ...input,
          arguments: argumentsValue as AgentWorkspaceToolArguments[Name],
        }, dataDir),
    persistOutput: async (output, hookMetadata) => persistAgentToolResultForModel({
      dataDir,
      name: input.name,
      output: persistOutputWithHookMetadata(
        persistedAgentWorkspaceToolOutput(input.name, output),
        hookMetadata,
      ),
      projectId: input.projectId,
      toolCallId: hookMetadata.toolCallId,
    }),
    }, dataDir);
  } catch (error) {
    if (input.name === "shell_command" && error instanceof AgentToolPipelineError &&
      error.code === "approval_required" && error.detail) {
      return error.detail as AgentWorkspaceToolResult[Name];
    }
    throw error;
  }
  await input.onPersistedOutput?.(result.persistedOutput);
  if (result.additionalContext.length || result.preventContinuation) {
    await input.onHookFeedback?.({
      additionalContext: result.additionalContext,
      preventContinuation: result.preventContinuation,
    });
  }
  if (result.preventContinuation) throw new AgentHookPreventContinuationError(result.additionalContext);
  // Hooks and the live runtime keep the native result. Execution history (and
  // therefore resumed/Sub-agent model context) stores persistedOutput; the main
  // Project Turn applies the same model-facing persistence to its event stream.
  return result.output;
}

function persistOutputWithHookMetadata(
  output: unknown,
  metadata: { additionalContext: string[]; preventContinuation: boolean },
) {
  if (!metadata.additionalContext.length && !metadata.preventContinuation) return output;
  const agentHook = {
    additionalContext: metadata.additionalContext,
    preventContinuation: metadata.preventContinuation,
  };
  return output && typeof output === "object" && !Array.isArray(output)
    ? { ...output, agentHook }
    : { value: output, agentHook };
}

const ROOT_SCOPED_TOOLS = new Set<AgentWorkspaceToolName>([
  "workspace_status", "list_directory", "glob_files", "search_files", "code_diagnostics", "code_intelligence",
  "view_image", "read_file", "write_file", "edit_file", "apply_patch", "notebook_edit",
  "propose_patch", "git_diff", "shell_command", "skill", "list_mcp_resources", "read_mcp_resource",
]);

async function applyExecutionWorkspaceRootScope<Name extends AgentWorkspaceToolName>(
  projectId: string,
  executionId: string,
  name: Name,
  args: AgentWorkspaceToolArguments[Name],
  dataDir: string,
): Promise<AgentWorkspaceToolArguments[Name]> {
  const detail = await getAgentExecution(projectId, executionId, dataDir);
  if (!detail) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const assignedRootId = detail.context.workspaceRootId;
  if (!assignedRootId) return args;

  if (ROOT_SCOPED_TOOLS.has(name)) {
    const record = args as Record<string, unknown>;
    if (typeof record.rootId === "string" && record.rootId !== assignedRootId) {
      throw new AgentWorkspaceToolError("Sub-agent 不得访问分配范围之外的 Workspace Root", "invalid_arguments");
    }
    return { ...record, rootId: assignedRootId } as AgentWorkspaceToolArguments[Name];
  }
  if (name === "propose_memory") {
    const memory = args as AgentWorkspaceToolArguments["propose_memory"];
    return {
      ...memory,
      sources: memory.sources.map((source) => source.kind === "workspaceFile"
        ? { ...source, rootId: assignedRootId }
        : source),
    } as AgentWorkspaceToolArguments[Name];
  }
  return args;
}

async function runTool<Name extends AgentWorkspaceToolName>(
  input: {
    arguments: AgentWorkspaceToolArguments[Name];
    deferredToolSearchResults?: AgentWorkspaceToolResult["tool_search"]["tools"];
    executionId: string;
    name: Name;
    projectId: string;
    signal?: AbortSignal;
    onCommandProgress?: (progress: AgentCommandProgress) => Promise<void> | void;
    onCommandStall?: (stall: AgentCommandStall) => Promise<void> | void;
    commandStallCheckIntervalMs?: number;
    commandStallThresholdMs?: number;
    onWorkflowProgress?: (event: AgentWorkflowProgressEvent, runId: string) => Promise<void> | void;
    turnId?: string;
    delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel;
    delegatedModel?: string;
    delegatedModelSpeed?: ZenmeModelSpeed;
    delegatedReasoningEffort?: ZenmeReasoningEffort;
  },
  dataDir: string,
): Promise<AgentWorkspaceToolResult[Name]> {
  await assertExecutionToolScope(input, dataDir);
  switch (input.name) {
    case "workspace_status":
      return workspaceStatus(input.projectId, input.arguments as AgentWorkspaceToolArguments["workspace_status"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "list_directory":
      return listDirectory(input.projectId, input.arguments as AgentWorkspaceToolArguments["list_directory"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "glob_files":
      return globFiles(input.projectId, input.arguments as AgentWorkspaceToolArguments["glob_files"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "search_files":
      return searchFiles(input.projectId, input.arguments as AgentWorkspaceToolArguments["search_files"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "code_diagnostics": {
      const args = input.arguments as AgentWorkspaceToolArguments["code_diagnostics"];
      const root = await requireReadableRoot(input.projectId, dataDir, args.rootId);
      const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
      const overlays = await collectExecutionChangeSetOverlays(input.projectId, detail?.changeSetIds ?? [], root.id, dataDir);
      const [typescript, plugin] = await Promise.all([
        collectTypeScriptDiagnostics({
        rootPath: root.realPath,
        overlays,
        configPath: args.configPath,
        relativePaths: args.relativePaths,
        maxProblems: args.maxProblems,
        }),
        collectProjectPluginLspDiagnostics({
          rootPath: root.realPath,
          dataDir,
          projectId: input.projectId,
          overlays,
          relativePaths: args.relativePaths,
        }),
      ]);
      return mergeCodeDiagnostics(typescript, plugin, args.maxProblems) as AgentWorkspaceToolResult[Name];
    }
    case "code_intelligence": {
      const args = input.arguments as AgentWorkspaceToolArguments["code_intelligence"];
      if (isSensitiveWorkspacePath(args.filePath)) {
        throw new AgentWorkspaceToolError("敏感文件不能进入代码语义分析", "sensitive_path");
      }
      const root = await requireReadableRoot(input.projectId, dataDir, args.rootId);
      const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
      const overlays = await collectExecutionChangeSetOverlays(input.projectId, detail?.changeSetIds ?? [], root.id, dataDir);
      const pluginResult = await queryProjectPluginLspCodeIntelligence({
        rootPath: root.realPath,
        dataDir,
        projectId: input.projectId,
        overlay: Object.hasOwn(overlays, args.filePath) ? overlays[args.filePath] : undefined,
        operation: args.operation,
        filePath: args.filePath,
        line: args.line,
        character: args.character,
        query: args.query,
        maxResults: args.maxResults,
      });
      if (pluginResult?.available || !/\.[cm]?[jt]sx?$/i.test(args.filePath)) {
        return (pluginResult ?? {
          available: false,
          filePath: args.filePath,
          items: [],
          operation: args.operation,
          reason: "没有已启用的插件 LSP 支持该文件类型",
          truncated: false,
        }) as AgentWorkspaceToolResult[Name];
      }
      const typeScriptResult = await queryTypeScriptCodeIntelligence({
        rootPath: root.realPath,
        overlays,
        operation: args.operation,
        filePath: args.filePath,
        line: args.line,
        character: args.character,
        query: args.query,
        configPath: args.configPath,
        maxResults: args.maxResults,
      });
      if (!typeScriptResult.available && pluginResult?.reason) {
        typeScriptResult.reason = `${pluginResult.reason}；TypeScript 降级：${typeScriptResult.reason ?? "不可用"}`;
      }
      return typeScriptResult as AgentWorkspaceToolResult[Name];
    }
    case "view_image":
      return readWorkspaceImage(
        input.projectId,
        (input.arguments as AgentWorkspaceToolArguments["view_image"]).relativePath,
        dataDir,
        (input.arguments as AgentWorkspaceToolArguments["view_image"]).rootId,
      ) as Promise<AgentWorkspaceToolResult[Name]>;
    case "image_gen": {
      const args = input.arguments as AgentWorkspaceToolArguments["image_gen"];
      return generateAgentImages({
        ...args,
        dataDir,
        executionId: input.executionId,
        projectId: input.projectId,
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "image_edit": {
      const args = input.arguments as AgentWorkspaceToolArguments["image_edit"];
      const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
      return editAgentImages({
        ...args,
        dataDir,
        executionId: input.executionId,
        projectId: input.projectId,
        workspaceRootId: detail?.context.workspaceRootId,
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "search_knowledge":
      return searchKnowledge(input.projectId, input.arguments as AgentWorkspaceToolArguments["search_knowledge"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "list_mcp_resources":
      return listProjectMcpResources({
        projectId: input.projectId,
        ...(input.arguments as AgentWorkspaceToolArguments["list_mcp_resources"]),
      }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "read_mcp_resource":
      return readProjectMcpResource({
        projectId: input.projectId,
        ...(input.arguments as AgentWorkspaceToolArguments["read_mcp_resource"]),
      }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "web_search":
      return searchProjectWeb(input.arguments as AgentWorkspaceToolArguments["web_search"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "web_fetch":
      return fetchProjectWebPage(input.arguments as AgentWorkspaceToolArguments["web_fetch"], { signal: input.signal }) as Promise<AgentWorkspaceToolResult[Name]>;
    case "browser":
      return runBrowserPreview({
        projectId: input.projectId,
        executionId: input.executionId,
        args: input.arguments as AgentWorkspaceToolArguments["browser"],
        signal: input.signal,
        dataDir,
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    case "ask_user_question": {
      const args = input.arguments as AgentWorkspaceToolArguments["ask_user_question"];
      const questions = args.questions?.map((question) => ({
        ...question,
        multiSelect: question.multiSelect ?? false,
      })) ?? [{
        question: args.question ?? "请提供所需信息。",
        header: "问题",
        options: args.options ?? [],
        multiSelect: false,
      }];
      return Promise.resolve({
        question: questions[0].question,
        options: questions[0].options,
        questions,
        status: "waitingInput",
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "enter_plan_mode":
      return Promise.resolve({
        message: "已进入规划模式。请只读探索现有实现；只允许通过 write_file/edit_file 更新 @plan/PLAN.md。形成完整计划后调用 exit_plan_mode 请求用户批准。",
        status: "entered",
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    case "exit_plan_mode": {
      const plan = (input.arguments as AgentWorkspaceToolArguments["exit_plan_mode"]).plan;
      const execution = await getAgentExecution(input.projectId, input.executionId, dataDir);
      const filePath = await writeProjectAgentPlan(
        input.projectId,
        plan,
        dataDir,
        execution?.context.conversationId,
      );
      return Promise.resolve({
        filePath,
        plan,
        question: "批准该计划并开始实施吗？",
        options: [
          { label: "批准并开始实施", description: "退出规划模式，在当前 Turn 中按计划继续。" },
          { label: "继续修改计划", description: "留在规划模式，并根据反馈完善计划。" },
        ],
        status: "waitingInput",
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "enter_worktree": {
      const output = await enterMainAgentWorktree(
        input.projectId,
        input.executionId,
        input.arguments as AgentWorkspaceToolArguments["enter_worktree"],
        dataDir,
      );
      await runWorkspaceLifecycleHook(input, "WorktreeCreate", output, dataDir);
      await runWorkspaceLifecycleHook(input, "CwdChanged", { rootId: output.rootId, path: output.worktreePath }, dataDir);
      return output as AgentWorkspaceToolResult[Name];
    }
    case "exit_worktree": {
      const output = await exitMainAgentWorktree(
        input.projectId,
        input.executionId,
        input.arguments as AgentWorkspaceToolArguments["exit_worktree"],
        dataDir,
      );
      if (output.action === "remove") await runWorkspaceLifecycleHook(input, "WorktreeRemove", output, dataDir);
      await runWorkspaceLifecycleHook(input, "CwdChanged", { rootId: output.originalRootId }, dataDir);
      return output as AgentWorkspaceToolResult[Name];
    }
    case "read_file":
      return readFile(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["read_file"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "write_file":
      return writeFile(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["write_file"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "edit_file":
      return editFile(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["edit_file"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "apply_patch":
      return applyPatch(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["apply_patch"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "notebook_edit":
      return notebookEdit(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["notebook_edit"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "propose_patch":
      return proposePatch(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["propose_patch"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "propose_memory":
      return proposeMemory(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["propose_memory"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "git_diff":
      return gitDiff(input.projectId, input.arguments as AgentWorkspaceToolArguments["git_diff"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "shell_command": {
      const args = input.arguments as AgentWorkspaceToolArguments["shell_command"];
      const { run_in_background, background, ...commandArguments } = args;
      const command = await proposeAgentCommand({
        ...commandArguments,
        reason: commandArguments.reason?.trim() || shellCommandReason(commandArguments),
        background: run_in_background ?? background,
        projectId: input.projectId,
        executionId: input.executionId,
      }, dataDir);
      const execution = await getAgentExecution(input.projectId, input.executionId, dataDir);
      if (!execution) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
      const permissionMode = execution.context.permissionMode ?? "onRequest";
      const requiresApproval = Boolean(command.externalRoot || command.requiresExplicitApproval);
      if (permissionMode === "neverAsk" && requiresApproval) {
        await rejectAgentCommand(input.projectId, input.executionId, command.id, dataDir);
        throw new Error(command.externalRoot
          ? "命令工作目录位于 Workspace 外；当前会话为“从不请求审批”，因此已直接拒绝。"
          : "该命令需要明确批准；当前会话为“从不请求审批”，因此已直接拒绝。");
      }
      if (permissionMode === "untrusted" || requiresApproval) {
        return command as AgentWorkspaceToolResult[Name];
      }
      await approveAgentCommand(input.projectId, input.executionId, command.id, dataDir);
      return runApprovedAgentCommand({
        allowSandboxedWithoutExecutePermission: true,
        projectId: input.projectId,
        executionId: input.executionId,
        commandId: command.id,
        signal: input.signal,
        onProgress: input.onCommandProgress,
        onStall: input.onCommandStall,
        stallCheckIntervalMs: input.commandStallCheckIntervalMs,
        stallThresholdMs: input.commandStallThresholdMs,
      }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "task_output":
      {
        const args = input.arguments as AgentWorkspaceToolArguments["task_output"];
        const taskId = args.task_id ?? args.taskId;
        if (!taskId) throw new AgentWorkspaceToolError("TaskOutput 缺少 task_id", "invalid_arguments");
        const wait = args.block ?? args.wait ?? true;
        const timeoutMs = args.timeout ?? args.timeoutMs;
        const { readProjectAgentWorkflowTask, waitForProjectAgentWorkflow, workflowTaskSnapshot } = await import("@/lib/agent/workflow-runner");
        let workflow = await readProjectAgentWorkflowTask(input.projectId, taskId, dataDir);
        if (workflow && wait && (workflow.status === "queued" || workflow.status === "running")) {
          const boundedTimeoutMs = Math.max(1, Math.min(timeoutMs ?? 30_000, 600_000));
          workflow = await Promise.race([
            waitForProjectAgentWorkflow(input.projectId, workflow.runId, dataDir).then(workflowTaskSnapshot),
            new Promise<AgentWorkflowTaskSnapshot>((resolve) => setTimeout(() => resolve(workflow!), boundedTimeoutMs)),
          ]);
        }
        if (workflow) return workflow as AgentWorkspaceToolResult[Name];
        const agentTask = await readAgentBackgroundTaskOutput(
          input.projectId,
          { taskId, wait, timeoutMs },
          dataDir,
        );
        if (agentTask) return agentTask as AgentWorkspaceToolResult[Name];
        return readBackgroundTaskOutput(input.projectId, { taskId, wait, timeoutMs }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
      }
    case "task_stop":
      {
        const args = input.arguments as AgentWorkspaceToolArguments["task_stop"];
        const taskId = args.task_id ?? args.taskId;
        if (!taskId) throw new AgentWorkspaceToolError("TaskStop 缺少 task_id", "invalid_arguments");
        const { stopProjectAgentWorkflowTask } = await import("@/lib/agent/workflow-runner");
        const workflow = await stopProjectAgentWorkflowTask(input.projectId, taskId, dataDir);
        if (workflow) return workflow as AgentWorkspaceToolResult[Name];
        const agentTask = await stopAgentSubtask(input.projectId, taskId, dataDir);
        if (agentTask) return agentTask as AgentWorkspaceToolResult[Name];
        return stopAgentBackgroundTask(input.projectId, taskId, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
      }
    case "delegate_tasks":
      return delegateTasks(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["delegate_tasks"], dataDir, input.signal, input.turnId, input.delegatedCallModel, input.delegatedReasoningEffort, input.delegatedModelSpeed) as Promise<AgentWorkspaceToolResult[Name]>;
    case "workflow": {
      if (!input.delegatedModel?.trim()) throw new AgentWorkspaceToolError("Workflow 缺少模型配置", "invalid_arguments");
      const args = input.arguments as AgentWorkspaceToolArguments["workflow"];
      const { launchProjectAgentWorkflow } = await import("@/lib/agent/workflow-runner");
      const run = await launchProjectAgentWorkflow({
        ...args,
        projectId: input.projectId,
        executionId: input.executionId,
        turnId: input.turnId,
        model: input.delegatedModel,
        reasoningEffort: input.delegatedReasoningEffort,
        modelSpeed: input.delegatedModelSpeed,
        callModel: input.delegatedCallModel,
        signal: input.signal,
        onProgress: (event, current) => input.onWorkflowProgress?.(event, current.id),
      }, dataDir);
      return {
        status: "async_launched",
        taskId: run.taskId,
        taskType: "local_workflow",
        workflowName: run.name,
        runId: run.id,
        summary: run.description,
        scriptPath: run.scriptPath,
      } as AgentWorkspaceToolResult[Name];
    }
    case "team_create":
      return createTeam(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["team_create"], dataDir, input.turnId) as Promise<AgentWorkspaceToolResult[Name]>;
    case "agent_spawn":
      return spawnAgent(input.projectId, input.executionId, input.arguments as AgentWorkspaceToolArguments["agent_spawn"], dataDir, input.turnId, input.delegatedCallModel, input.delegatedReasoningEffort, input.delegatedModelSpeed) as Promise<AgentWorkspaceToolResult[Name]>;
    case "send_message":
      return sendTeamMessage(input.projectId, input.arguments as AgentWorkspaceToolArguments["send_message"], dataDir, input.delegatedCallModel, input.delegatedReasoningEffort, input.delegatedModelSpeed) as Promise<AgentWorkspaceToolResult[Name]>;
    case "team_delete":
      return deleteTeam(input.projectId, input.arguments as AgentWorkspaceToolArguments["team_delete"], dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    case "task_create": {
      const task = await createProjectAgentTask({
        projectId: input.projectId,
        ...(input.arguments as AgentWorkspaceToolArguments["task_create"]),
      }, dataDir);
      await appendSharedTaskEvent(input.projectId, input.turnId ?? input.executionId, dataDir);
      await runWorkspaceLifecycleHook(input, "TaskCreated", { task }, dataDir);
      return { task } as AgentWorkspaceToolResult[Name];
    }
    case "task_get":
      return {
        task: await getProjectAgentTask(
          input.projectId,
          (input.arguments as AgentWorkspaceToolArguments["task_get"]).taskId,
          dataDir,
        ),
      } as AgentWorkspaceToolResult[Name];
    case "task_list":
      return { tasks: await listProjectAgentTasks(input.projectId, dataDir) } as AgentWorkspaceToolResult[Name];
    case "task_update": {
      const task = await updateProjectAgentTask({
        projectId: input.projectId,
        ...(input.arguments as AgentWorkspaceToolArguments["task_update"]),
      }, dataDir);
      await appendSharedTaskEvent(input.projectId, input.turnId ?? input.executionId, dataDir);
      if (task?.status === "completed") await runWorkspaceLifecycleHook(input, "TaskCompleted", { task }, dataDir);
      return { success: true, task } as AgentWorkspaceToolResult[Name];
    }
    case "skill": {
      const args = input.arguments as AgentWorkspaceToolArguments["skill"];
      const loaded = await loadProjectSkill({ projectId: input.projectId, dataDir, skill: args.skill, args: args.args, rootId: args.rootId, invokedBy: args.invokedBy });
      return continueProjectSkillPromptShell({ ...input, loaded }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "tool_search": {
      const args = input.arguments as AgentWorkspaceToolArguments["tool_search"];
      const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
      if (!detail) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
      const maxResults = Math.max(1, Math.min(30, args.maxResults ?? 10));
      const permissionRules = await loadProjectPermissionRules(input.projectId, dataDir);
      const searchableBuiltIns = (detail.context.allowedTools ?? AGENT_TOOL_NAMES)
        .filter((name) => !isProjectToolBlanketDenied(name, permissionRules));
      return Promise.resolve({
        tools: [
          ...searchAgentToolDefinitions(args.query, maxResults, searchableBuiltIns),
          ...(input.deferredToolSearchResults ?? []),
        ].filter((tool) => !isProjectToolBlanketDenied(tool.name, permissionRules)).slice(0, maxResults),
      }) as Promise<AgentWorkspaceToolResult[Name]>;
    }
    case "run_approved_command":
      return runApprovedAgentCommand({
        projectId: input.projectId,
        executionId: input.executionId,
        commandId: (input.arguments as AgentWorkspaceToolArguments["run_approved_command"]).commandRequestId,
        signal: input.signal,
        onProgress: input.onCommandProgress,
      }, dataDir) as Promise<AgentWorkspaceToolResult[Name]>;
    default:
      throw new AgentWorkspaceToolError("该工具仅用于历史兼容，当前 Agent Runtime 不再执行", "invalid_arguments");
  }
}

function mergeCodeDiagnostics(
  typescript: CodeDiagnosticsResult,
  plugin: Awaited<ReturnType<typeof collectProjectPluginLspDiagnostics>>,
  requestedMaximum?: number,
): CodeDiagnosticsResult {
  const maximum = Number.isSafeInteger(requestedMaximum)
    ? Math.max(1, Math.min(500, requestedMaximum!))
    : 100;
  const all = dedupeCodeDiagnostics([...typescript.diagnostics, ...plugin.diagnostics]);
  const reasons = [
    !typescript.available ? typescript.reason : undefined,
    ...plugin.failures,
  ].filter((value): value is string => Boolean(value));
  return {
    available: typescript.available || plugin.available,
    ...(typescript.configPath ? { configPath: typescript.configPath } : {}),
    diagnostics: all.slice(0, maximum),
    errorCount: all.filter((diagnostic) => diagnostic.severity === "error").length,
    fileCount: Math.max(typescript.fileCount, new Set(plugin.diagnostics.map((diagnostic) => diagnostic.file).filter(Boolean)).size),
    ...(reasons.length ? { reason: reasons.join("；") } : {}),
    truncated: typescript.truncated || plugin.truncated || all.length > maximum,
    warningCount: all.filter((diagnostic) => diagnostic.severity === "warning").length,
  };
}

type SkillPromptShellInput = {
  additionalAllowedTools?: string[];
  delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel;
  delegatedModel?: string;
  delegatedModelSpeed?: ZenmeModelSpeed;
  delegatedReasoningEffort?: ZenmeReasoningEffort;
  executionId: string;
  loaded: AgentWorkspaceToolResult["skill"];
  onAsyncHookRewake?: (result: ProjectAgentHookRuntimeResult) => void | Promise<void>;
  onCommandProgress?: (progress: AgentCommandProgress) => Promise<void> | void;
  onCommandStall?: (stall: AgentCommandStall) => Promise<void> | void;
  onHookFeedback?: (feedback: { additionalContext: string[]; preventContinuation: boolean }) => void | Promise<void>;
  onHookSuccess?: (event: ProjectAgentHookEvent, hook: ProjectAgentHook, matcher: ProjectAgentHookMatcher) => void | Promise<void>;
  projectId: string;
  signal?: AbortSignal;
  turnId?: string;
};

/**
 * Expands cc-haha compatible shell expressions in a loaded Skill. The state is
 * persisted in the Skill tool result so an approval can resume without
 * re-running commands that already completed.
 */
export async function continueProjectSkillPromptShell(
  input: SkillPromptShellInput,
  dataDir = getZenmeDataDir(),
): Promise<AgentWorkspaceToolResult["skill"]> {
  const state = input.loaded.promptShellState ?? {
    executionId: input.executionId,
    source: input.loaded.content,
    shell: input.loaded.shell === "powershell" ? "powershell" as const : "bash" as const,
    outputs: projectPromptShellMatches(input.loaded.content).map(() => null),
  };
  const matches = projectPromptShellMatches(state.source);
  if (state.outputs.length !== matches.length) {
    throw new AgentWorkspaceToolError("Skill 嵌入命令恢复状态无效", "invalid_arguments");
  }

  if (state.pendingCommandId) {
    const execution = await getAgentExecution(input.projectId, state.executionId, dataDir);
    const command = execution?.commandRequests.find((candidate) => candidate.id === state.pendingCommandId);
    if (!command) throw new AgentWorkspaceToolError("Skill 嵌入命令的审批记录已丢失", "invalid_arguments");
    const pendingIndex = state.outputs.findIndex((output) => output === null);
    if (["proposed", "approved", "running"].includes(command.status)) {
      return { ...input.loaded, promptShellState: state, pendingCommand: command };
    }
    if (command.status !== "succeeded" || pendingIndex < 0) {
      throw new AgentWorkspaceToolError(formatSkillPromptShellFailure(command, matches[pendingIndex]?.pattern), "invalid_arguments");
    }
    state.outputs[pendingIndex] = formatProjectPromptShellOutput(command);
    delete state.pendingCommandId;
  }

  for (let index = 0; index < matches.length; index += 1) {
    if (state.outputs[index] !== null) continue;
    const match = matches[index];
    const command = await executeAgentWorkspaceTool({
      projectId: input.projectId,
      executionId: state.executionId,
      additionalAllowedTools: [
        ...(input.additionalAllowedTools ?? []),
        ...(input.loaded.allowedTools ?? []),
      ],
      name: "shell_command",
      arguments: {
        command: match.command,
        shell: state.shell,
        reason: `展开 Skill 嵌入命令（${index + 1}/${matches.length}）`,
      },
      signal: input.signal,
      foregroundBudgetMs: 300_000,
      turnId: input.turnId,
      delegatedCallModel: input.delegatedCallModel,
      delegatedModel: input.delegatedModel,
      delegatedModelSpeed: input.delegatedModelSpeed,
      delegatedReasoningEffort: input.delegatedReasoningEffort,
      onAsyncHookRewake: input.onAsyncHookRewake,
      onCommandProgress: input.onCommandProgress,
      onCommandStall: input.onCommandStall,
      onHookFeedback: input.onHookFeedback,
      onHookSuccess: input.onHookSuccess,
    }, dataDir);
    if (command.status === "proposed") {
      state.pendingCommandId = command.id;
      return { ...input.loaded, promptShellState: state, pendingCommand: command };
    }
    if (command.status !== "succeeded") {
      throw new AgentWorkspaceToolError(formatSkillPromptShellFailure(command, match.pattern), "invalid_arguments");
    }
    state.outputs[index] = formatProjectPromptShellOutput(command);
  }

  const expanded = matches.length
    ? substituteProjectPromptShellOutputs(state.source, matches, state.outputs.map((output) => output ?? ""))
    : state.source;
  const loaded = {
    ...input.loaded,
    content: expanded,
    promptShellState: undefined,
    pendingCommand: undefined,
  };
  if (loaded.executionContext !== "fork") return loaded;
  if (!input.delegatedModel?.trim()) throw new AgentWorkspaceToolError("Forked Skill 缺少模型配置", "invalid_arguments");
  return runForkedProjectSkill({
    projectId: input.projectId,
    executionId: input.executionId,
    turnId: input.turnId,
    rootId: loaded.rootId,
    loaded,
    model: input.delegatedModel,
    modelSpeed: input.delegatedModelSpeed,
    reasoningEffort: input.delegatedReasoningEffort,
    callModel: input.delegatedCallModel,
    signal: input.signal,
    dataDir,
  });
}

function formatSkillPromptShellFailure(command: AgentCommandRequest, pattern?: string) {
  const output = formatProjectPromptShellOutput(command) || command.error || command.status;
  return `Skill 嵌入命令执行失败${pattern ? `（${pattern}）` : ""}：${output}`;
}

function dedupeCodeDiagnostics(diagnostics: CodeDiagnostic[]) {
  return [...new Map(diagnostics.map((diagnostic) => [JSON.stringify([
    diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.message,
    diagnostic.severity, diagnostic.source, diagnostic.code,
  ]), diagnostic])).values()];
}

async function runWorkspaceLifecycleHook(
  input: {
    delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel;
    delegatedModel?: string;
    delegatedModelSpeed?: ZenmeModelSpeed;
    delegatedReasoningEffort?: ZenmeReasoningEffort;
    executionId: string;
    onAsyncHookRewake?: (result: ProjectAgentHookRuntimeResult) => void | Promise<void>;
    onHookFeedback?: (feedback: { additionalContext: string[]; preventContinuation: boolean }) => void | Promise<void>;
    projectId: string;
    signal?: AbortSignal;
  },
  event: "WorktreeCreate" | "WorktreeRemove" | "CwdChanged" | "TaskCreated" | "TaskCompleted",
  payload: Record<string, unknown>,
  dataDir: string,
) {
  const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
  if (!detail?.context.agentHooks || !input.delegatedModel) return;
  const result = await runProjectAgentLifecycleHooks({
    projectId: input.projectId,
    executionId: input.executionId,
    event,
    hooks: detail.context.agentHooks,
    rootId: detail.context.workspaceRootId,
    model: input.delegatedModel,
    reasoningEffort: input.delegatedReasoningEffort,
    modelSpeed: input.delegatedModelSpeed,
    callModel: input.delegatedCallModel,
    signal: input.signal,
    dataDir,
    payload,
    onAsyncRewake: input.onAsyncHookRewake,
  });
  if (result?.additionalContext || result?.preventContinuation || result?.permission === "deny") {
    await input.onHookFeedback?.({
      additionalContext: [result.additionalContext || result.reason || `${event} Hook 已完成`],
      preventContinuation: Boolean(result.preventContinuation || result.permission === "deny"),
    });
  }
}

async function appendSharedTaskEvent(projectId: string, turnId: string, dataDir: string) {
  const session = await getProjectAgentSession(projectId, dataDir);
  await appendProjectAgentEvent({
    projectId,
    turnId,
    type: "todo",
    data: { items: session.taskPlan },
  }, dataDir);
}

async function collectExecutionChangeSetOverlays(projectId: string, changeSetIds: string[], rootId: string, dataDir: string) {
  if (!changeSetIds.length) return {};
  const binding = await requireWorkspaceBinding(projectId, dataDir);
  const selected = new Set(changeSetIds);
  const changeSets = (await listWorkspaceChangeSets(projectId, dataDir))
    .filter((changeSet) => selected.has(changeSet.id)
      && (changeSet.rootId ?? binding.id) === rootId
      && !["rejected", "reverted", "conflict"].includes(changeSet.status))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const overlays: Record<string, string | null> = {};
  for (const changeSet of changeSets) {
    for (const operation of changeSet.operations) {
      if (operation.kind === "rename") {
        overlays[operation.relativePath] = null;
        if (operation.targetRelativePath) overlays[operation.targetRelativePath] = operation.beforeContent;
      } else {
        overlays[operation.relativePath] = operation.proposedContent;
      }
    }
  }
  return overlays;
}

async function runForkedProjectSkill(input: {
  projectId: string;
  executionId: string;
  turnId?: string;
  rootId?: string;
  loaded: AgentWorkspaceToolResult["skill"];
  model: string;
  modelSpeed?: ZenmeModelSpeed;
  reasoningEffort?: ZenmeReasoningEffort;
  callModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel;
  signal?: AbortSignal;
  dataDir: string;
}) {
  const parent = await getAgentExecution(input.projectId, input.executionId, input.dataDir);
  if (!parent) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const prepared = await prepareDelegatedAgentTask({
    projectId: input.projectId,
    dataDir: input.dataDir,
    parent,
    instruction: input.loaded.content,
    agentType: input.loaded.agent,
    rootId: input.rootId ?? input.loaded.rootId,
    allowedTools: parent.context.allowedTools,
    model: input.loaded.model ?? input.model,
    delegatedReasoningEffort: input.loaded.effort ?? input.reasoningEffort,
  });
  const [{ createGlobalOrchestration }, { runDelegatedOrchestration }] = await Promise.all([
    import("@/lib/global-agent/orchestration-store"),
    import("@/lib/global-agent/delegated-runtime"),
  ]);
  const orchestration = await createGlobalOrchestration({
    projectId: input.projectId,
    goal: `执行 Skill：${input.loaded.name}`,
    resultNodeId: input.executionId,
    triggerNodeId: parent.context.subtaskId ?? input.executionId,
    parentTurnId: input.turnId,
    concurrencyLimit: 1,
    maxSubagents: 1,
    canvasContext: parent.context.canvasContext,
    currentNodeContext: parent.context.currentNodeContext,
    connectedGraphContext: parent.context.connectedGraphContext,
    conversationId: parent.context.conversationId,
    selectedNodeIds: parent.context.selectedNodeIds,
    fileDocumentIds: parent.context.fileDocumentIds,
    tasks: [{
      name: `skill:${input.loaded.name}`,
      title: `Skill ${input.loaded.name}`,
      instruction: prepared.effectiveInstruction,
      agentType: prepared.definition?.agentType,
      rootId: prepared.effectiveRootId,
      allowedPathPrefixes: parent.context.allowedPathPrefixes,
      allowedTools: prepared.allowedTools,
      additionalAllowedTools: input.loaded.allowedTools,
      model: prepared.delegatedModel,
      reasoningEffort: prepared.delegatedEffort,
      maxTurns: prepared.definition?.maxTurns,
      skills: prepared.definition?.skills,
      memory: prepared.definition?.memory,
      isolation: prepared.definition?.isolation,
      permissionMode: prepared.definition?.permissionMode ?? parent.context.permissionMode,
      hooks: mergeProjectAgentHooks(prepared.delegatedHooks, input.loaded.hooks),
      mcpServers: prepared.definition?.mcpServers,
      customizationSource: prepared.definition?.source === "built-in" ? undefined : prepared.definition?.source,
    }],
  }, input.dataDir);
  const completed = await runDelegatedOrchestration({
    projectId: input.projectId,
    orchestrationId: orchestration.id,
    model: prepared.delegatedModel,
    reasoningEffort: prepared.delegatedEffort,
    modelSpeed: input.modelSpeed,
    signal: input.signal,
  }, {
    callModel: input.callModel,
    dataDir: input.dataDir,
    onProgress: input.turnId
      ? createDelegatedProgressProjector(input.projectId, input.turnId, input.dataDir)
      : undefined,
  });
  const task = completed.tasks[0];
  const detail = task?.agentExecutionId
    ? await getAgentExecution(input.projectId, task.agentExecutionId, input.dataDir)
    : null;
  return {
    ...input.loaded,
    forked: true as const,
    orchestrationId: completed.id,
    agentId: task?.agentExecutionId,
    status: task?.status ?? completed.status,
    result: task?.resultSummary || task?.error || completed.resultSummary || completed.error || "Skill execution completed",
    pendingCommand: [...(detail?.commandRequests ?? [])].reverse().find((command) => command.status === "proposed"),
  };
}

async function delegateTasks(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["delegate_tasks"],
  dataDir: string,
  signal?: AbortSignal,
  turnId?: string,
  delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel,
  delegatedReasoningEffort?: ZenmeReasoningEffort,
  delegatedModelSpeed?: ZenmeModelSpeed,
): Promise<AgentWorkspaceToolResult["delegate_tasks"]> {
  if (!args.model?.trim()) throw new AgentWorkspaceToolError("并行 Sub-agent 缺少模型配置", "invalid_arguments");
  const parent = await getAgentExecution(projectId, executionId, dataDir);
  if (!parent) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const [{ createGlobalOrchestration }, { runDelegatedOrchestration }] = await Promise.all([
    import("@/lib/global-agent/orchestration-store"),
    import("@/lib/global-agent/delegated-runtime"),
  ]);
  const orchestration = await createGlobalOrchestration({
    projectId,
    goal: args.goal,
    resultNodeId: executionId,
    triggerNodeId: parent.context.subtaskId ?? executionId,
    parentTurnId: turnId,
    concurrencyLimit: args.concurrencyLimit,
    maxSubagents: args.tasks.length,
    canvasContext: parent.context.canvasContext,
    currentNodeContext: parent.context.currentNodeContext,
    connectedGraphContext: parent.context.connectedGraphContext,
    conversationId: parent.context.conversationId,
    selectedNodeIds: parent.context.selectedNodeIds,
    fileDocumentIds: parent.context.fileDocumentIds,
    tasks: args.tasks.map((task) => ({
      ...task,
      rootId: task.rootId ?? parent.context.workspaceRootId,
    })),
  }, dataDir);
  const completed = await runDelegatedOrchestration({
    projectId,
    orchestrationId: orchestration.id,
    model: args.model,
    reasoningEffort: delegatedReasoningEffort,
    modelSpeed: delegatedModelSpeed,
    signal,
  }, {
    callModel: delegatedCallModel,
    dataDir,
    onProgress: turnId ? createDelegatedProgressProjector(projectId, turnId, dataDir) : undefined,
  });
  const taskDetails = await Promise.all(completed.tasks.map(async (task) => ({
    task,
    detail: task.agentExecutionId
      ? await getAgentExecution(projectId, task.agentExecutionId, dataDir)
      : null,
  })));
  return {
    orchestrationId: completed.id,
    status: completed.status,
    tasks: taskDetails.map(({ task, detail }) => ({
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
    })),
  };
}

function createDelegatedProgressProjector(projectId: string, turnId: string, dataDir: string) {
  return async (current: GlobalOrchestration) => {
    const completedCount = current.tasks.filter((task) =>
      ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status)).length;
    const runningTitles = current.tasks.filter((task) =>
      task.status === "running" || task.status === "dispatching").map((task) => task.title);
    const beforeProjection = await getProjectAgentSession(projectId, dataDir);
    const latestDelegationStatus = beforeProjection.events.findLast((event) =>
      event.turnId === turnId && event.type === "status" && event.data?.stage === "delegating",
    );
    const statusChanged = latestDelegationStatus?.data?.completedCount !== completedCount ||
      latestDelegationStatus?.data?.totalCount !== current.tasks.length ||
      JSON.stringify(latestDelegationStatus?.data?.runningTitles ?? []) !== JSON.stringify(runningTitles);
    if (statusChanged) {
      await appendProjectAgentEvent({
        projectId,
        turnId,
        type: "status",
        data: {
          stage: "delegating",
          orchestrationId: current.id,
          completedCount,
          totalCount: current.tasks.length,
          runningTitles,
        },
      }, dataDir);
    }
    await projectDelegatedExecutionEvents({
      projectId,
      turnId,
      orchestrationId: current.id,
      tasks: current.tasks,
    }, dataDir);
    const session = await getProjectAgentSession(projectId, dataDir);
    const knownCommandIds = new Set(session.events.flatMap((event) =>
      event.turnId === turnId && event.type === "approval" && typeof event.data?.commandRequestId === "string"
        ? [event.data.commandRequestId]
        : []));
    for (const task of current.tasks.filter((candidate) =>
      candidate.status === "waitingApproval" && candidate.agentExecutionId)) {
      const detail = await getAgentExecution(projectId, task.agentExecutionId!, dataDir);
      const command = [...(detail?.commandRequests ?? [])].reverse().find((candidate) => candidate.status === "proposed");
      if (!command || knownCommandIds.has(command.id)) continue;
      await appendProjectAgentEvent({
        projectId,
        turnId,
        type: "approval",
        content: command.reason,
        data: {
          status: "pending",
          executionId: task.agentExecutionId,
          commandRequestId: command.id,
          executable: command.executable,
          args: command.args,
          cwd: command.cwd,
          externalRoot: command.externalRoot,
          sandboxMode: command.sandboxMode,
          orchestrationId: current.id,
        },
      }, dataDir);
    }
  };
}

async function createTeam(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["team_create"],
  dataDir: string,
  turnId?: string,
): Promise<AgentWorkspaceToolResult["team_create"]> {
  const parent = await getAgentExecution(projectId, executionId, dataDir);
  if (!parent) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const { createGlobalTeam } = await import("@/lib/global-agent/orchestration-store");
  const team = await createGlobalTeam({
    projectId,
    teamName: args.teamName,
    description: args.description,
    maxSubagents: args.maxMembers,
    resultNodeId: executionId,
    triggerNodeId: parent.context.subtaskId ?? executionId,
    parentTurnId: turnId,
    canvasContext: parent.context.canvasContext,
    currentNodeContext: parent.context.currentNodeContext,
    connectedGraphContext: parent.context.connectedGraphContext,
    conversationId: parent.context.conversationId,
    selectedNodeIds: parent.context.selectedNodeIds,
    fileDocumentIds: parent.context.fileDocumentIds,
  }, dataDir);
  return { teamId: team.id, teamName: team.teamName ?? args.teamName, status: team.status };
}

async function prepareDelegatedAgentTask(input: {
  projectId: string;
  dataDir: string;
  parent: AgentExecutionDetail;
  instruction: string;
  agentType?: string;
  rootId?: string;
  allowedTools?: AgentWorkspaceToolName[];
  model: string;
  delegatedReasoningEffort?: ZenmeReasoningEffort;
}) {
  let definition: ProjectAgentDefinition | undefined;
  if (input.agentType?.trim()) {
    try {
      definition = await loadProjectAgentDefinition({
        projectId: input.projectId,
        dataDir: input.dataDir,
        agentType: input.agentType,
        rootId: input.rootId ?? input.parent.context.workspaceRootId,
      });
    } catch (error) {
      throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent 定义无效", "invalid_arguments");
    }
  }
  const effectiveRootId = input.rootId ?? definition?.rootId ?? input.parent.context.workspaceRootId;
  let preloadedSkills: Array<{ name: string; content: string }> = [];
  if (definition?.skills?.length) {
    try {
      preloadedSkills = await Promise.all(definition.skills.map(async (skill) => {
        const loaded = await loadProjectSkill({ projectId: input.projectId, dataDir: input.dataDir, skill, rootId: effectiveRootId });
        return { name: loaded.name, content: loaded.content };
      }));
    } catch (error) {
      throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent 预加载技能失败", "invalid_arguments");
    }
  }
  const memoryPrompt = definition?.memory
    ? await loadProjectAgentMemoryPrompt({
        projectId: input.projectId,
        agentType: definition.agentType,
        scope: definition.memory,
        rootId: effectiveRootId,
        dataDir: input.dataDir,
      }).catch((error) => {
        throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent Memory 加载失败", "invalid_arguments");
      })
    : "";
  const effectiveInstruction = definition
    ? [
        `<agent-definition type="${definition.agentType}">`,
        definition.systemPrompt,
        `</agent-definition>`,
        definition.initialPrompt ? `<initial-prompt>\n${definition.initialPrompt}\n</initial-prompt>` : "",
        definition.criticalSystemReminder ? `<critical-system-reminder>\n${definition.criticalSystemReminder}\n</critical-system-reminder>` : "",
        ...preloadedSkills.map((skill) => `<preloaded-skill name="${skill.name}">\n${skill.content}\n</preloaded-skill>`),
        memoryPrompt,
        `<task>\n${input.instruction}\n</task>`,
      ].filter(Boolean).join("\n\n")
    : input.instruction;
  return {
    definition,
    effectiveRootId,
    effectiveInstruction,
    allowedTools: resolveAgentDefinitionTools(input.allowedTools, definition),
    delegatedModel: definition?.model && definition.model !== "inherit" ? definition.model : input.model,
    delegatedEffort: definition?.effort ?? input.delegatedReasoningEffort,
    delegatedHooks: mergeProjectAgentHooks(input.parent.context.agentHooks, definition?.hooks),
  };
}

async function spawnAgent(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["agent_spawn"],
  dataDir: string,
  turnId?: string,
  delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel,
  delegatedReasoningEffort?: ZenmeReasoningEffort,
  delegatedModelSpeed?: ZenmeModelSpeed,
): Promise<AgentWorkspaceToolResult["agent_spawn"]> {
  if (!args.model?.trim()) throw new AgentWorkspaceToolError("Sub-agent 缺少模型配置", "invalid_arguments");
  const parent = await getAgentExecution(projectId, executionId, dataDir);
  if (!parent) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const prepared = await prepareDelegatedAgentTask({
    projectId,
    dataDir,
    parent,
    instruction: args.instruction,
    agentType: args.agentType,
    rootId: args.rootId,
    allowedTools: args.allowedTools,
    model: args.model,
    delegatedReasoningEffort,
  });
  const { definition, effectiveRootId, effectiveInstruction, allowedTools, delegatedModel, delegatedEffort, delegatedHooks } = prepared;
  const store = await import("@/lib/global-agent/orchestration-store");
  const runtime = await import("@/lib/global-agent/delegated-runtime");
  const requestedName = args.name?.trim() || "";
  const ordinaryName = requestedName || definition?.agentType || args.title?.trim() || "general-purpose";
  if (args.teamId && !requestedName) {
    throw new AgentWorkspaceToolError("Team Agent 必须提供 name", "invalid_arguments");
  }
  let team = args.teamId
    ? await store.getGlobalOrchestration(projectId, args.teamId, dataDir)
    : requestedName
      ? await store.getOpenGlobalTeam(projectId, dataDir)
      : null;
  let task: import("@/lib/global-agent/types").GlobalSubtask;
  if (team?.kind === "team" && !team.deletedAt) {
    task = await store.addGlobalTeamMember({
      projectId,
      teamId: team.id,
      name: requestedName,
      agentType: definition?.agentType,
      instruction: effectiveInstruction,
      title: args.title,
      rootId: effectiveRootId,
      allowedPathPrefixes: args.allowedPathPrefixes,
      allowedTools,
      model: delegatedModel,
      reasoningEffort: delegatedEffort,
      maxTurns: definition?.maxTurns,
      skills: definition?.skills,
      memory: definition?.memory,
      isolation: args.isolation ?? definition?.isolation,
      permissionMode: definition?.permissionMode,
      planModeRequired: args.mode === "plan",
      hooks: delegatedHooks,
      mcpServers: definition?.mcpServers,
      customizationSource: definition?.source === "built-in" ? undefined : definition?.source,
      structuredResultSchema: args.structuredResultSchema,
    }, dataDir);
    team = await store.getGlobalOrchestration(projectId, team.id, dataDir);
  } else if (args.teamId) {
    throw new AgentWorkspaceToolError("指定 Team 不存在或已经关闭", "invalid_arguments");
  } else {
    team = await store.createGlobalOrchestration({
      projectId,
      goal: args.title?.trim() || args.instruction,
      resultNodeId: executionId,
      triggerNodeId: parent.context.subtaskId ?? executionId,
      parentTurnId: turnId,
      maxSubagents: 1,
      canvasContext: parent.context.canvasContext,
      currentNodeContext: parent.context.currentNodeContext,
      connectedGraphContext: parent.context.connectedGraphContext,
      conversationId: parent.context.conversationId,
      selectedNodeIds: parent.context.selectedNodeIds,
      fileDocumentIds: parent.context.fileDocumentIds,
      tasks: [{
        name: ordinaryName,
        agentType: definition?.agentType,
        title: args.title?.trim() || ordinaryName,
        instruction: effectiveInstruction,
        rootId: effectiveRootId,
        allowedPathPrefixes: args.allowedPathPrefixes,
        allowedTools,
        model: delegatedModel,
        reasoningEffort: delegatedEffort,
        maxTurns: definition?.maxTurns,
        skills: definition?.skills,
        memory: definition?.memory,
        isolation: args.isolation ?? definition?.isolation,
        permissionMode: definition?.permissionMode,
        planModeRequired: args.mode === "plan",
        hooks: delegatedHooks,
        mcpServers: definition?.mcpServers,
        customizationSource: definition?.source === "built-in" ? undefined : definition?.source,
        structuredResultSchema: args.structuredResultSchema,
      }],
    }, dataDir);
    task = team.tasks[0];
  }
  if (!team) throw new AgentWorkspaceToolError("Team 创建失败", "invalid_arguments");
  const background = team.kind === "team" || args.run_in_background === true || definition?.background === true;
  if (background) {
    await runtime.startDelegatedOrchestrationRun({
      projectId,
      orchestrationId: team.id,
      model: delegatedModel,
      reasoningEffort: delegatedEffort,
      modelSpeed: delegatedModelSpeed,
    }, { callModel: delegatedCallModel, dataDir });
  } else {
    team = await runtime.runDelegatedOrchestration({
      projectId,
      orchestrationId: team.id,
      model: delegatedModel,
      reasoningEffort: delegatedEffort,
      modelSpeed: delegatedModelSpeed,
    }, {
      callModel: delegatedCallModel,
      dataDir,
      onProgress: turnId ? createDelegatedProgressProjector(projectId, turnId, dataDir) : undefined,
    });
    task = team.tasks.find((candidate) => candidate.id === task.id) ?? task;
  }
  const detail = task.agentExecutionId
    ? await getAgentExecution(projectId, task.agentExecutionId, dataDir)
    : null;
  return {
    teamId: team.id,
    agentId: task.id,
    taskId: task.id,
    taskType: "local_agent",
    name: task.name ?? ordinaryName,
    status: task.status,
    background,
    ...(!background ? {
      result: task.resultSummary || task.error || team.resultSummary || team.error || "Sub-agent completed",
      pendingCommand: [...(detail?.commandRequests ?? [])].reverse().find((command) => command.status === "proposed"),
    } : {}),
  };
}

function resolveAgentDefinitionTools(
  explicit: AgentWorkspaceToolName[] | undefined,
  definition: ProjectAgentDefinition | undefined,
) {
  const selected = explicit ?? definition?.tools;
  if (!selected) return undefined;
  const denied = new Set(definition?.disallowedTools ?? []);
  return selected.filter((tool) => AGENT_WORKSPACE_TOOL_NAMES.includes(tool) && !denied.has(tool));
}

async function sendTeamMessage(
  projectId: string,
  args: AgentWorkspaceToolArguments["send_message"],
  dataDir: string,
  delegatedCallModel?: typeof import("@/lib/agent/project-agent-model").callProjectAgentModel,
  delegatedReasoningEffort?: ZenmeReasoningEffort,
  delegatedModelSpeed?: ZenmeModelSpeed,
): Promise<AgentWorkspaceToolResult["send_message"]> {
  const store = await import("@/lib/global-agent/orchestration-store");
  let directRecipientTaskId: string | undefined;
  let team = args.teamId
    ? await store.getGlobalOrchestration(projectId, args.teamId, dataDir)
    : null;
  if (!team && typeof args.message === "string" && args.to !== "*") {
    const candidates = (await store.listGlobalOrchestrations(projectId, dataDir))
      .flatMap((item) => item.deletedAt ? [] : item.tasks
        .filter((task) => Boolean(task.agentExecutionId) && (
          task.id === args.to ||
          task.agentExecutionId === args.to ||
          (task.name ?? task.title).toLocaleLowerCase() === args.to.toLocaleLowerCase()
        ))
        .map((task) => ({ item, task })))
      .sort((left, right) => right.item.updatedAt.localeCompare(left.item.updatedAt));
    const direct = candidates[0];
    if (direct) {
      team = direct.item;
      directRecipientTaskId = direct.task.id;
    }
  }
  team ??= await store.getOpenGlobalTeam(projectId, dataDir);
  if (!team || team.deletedAt) {
    throw new AgentWorkspaceToolError("没有找到可接收消息的 Agent", "invalid_arguments");
  }
  const isPersistentTeam = team.kind === "team";
  if (!isPersistentTeam && args.to === "*") {
    throw new AgentWorkspaceToolError("普通 Sub-agent 不支持广播消息", "invalid_arguments");
  }
  const structured = typeof args.message === "string" ? null : args.message;
  if (structured?.type === "plan_approval_response") {
    if (!isPersistentTeam) throw new AgentWorkspaceToolError("普通 Sub-agent 不支持计划审批消息", "invalid_arguments");
    if (args.to === "*") throw new AgentWorkspaceToolError("结构化计划审批响应不能广播", "invalid_arguments");
    const response = await store.respondGlobalTeamPlanApproval({
      projectId,
      orchestrationId: team.id,
      teammateName: args.to,
      requestId: structured.request_id,
      approve: structured.approve,
      feedback: structured.feedback,
    }, dataDir);
    if (!args.model?.trim()) throw new AgentWorkspaceToolError("恢复 Team Agent 时缺少模型配置", "invalid_arguments");
    const runtime = await import("@/lib/global-agent/delegated-runtime");
    await runtime.startDelegatedSubagentRun({
      projectId,
      executionId: response.agentExecutionId,
      model: args.model,
      reasoningEffort: delegatedReasoningEffort,
      modelSpeed: delegatedModelSpeed,
    }, { callModel: delegatedCallModel, dataDir });
    await runtime.startDelegatedOrchestrationRun({
      projectId,
      orchestrationId: team.id,
      model: args.model,
      reasoningEffort: delegatedReasoningEffort,
      modelSpeed: delegatedModelSpeed,
    }, { callModel: delegatedCallModel, dataDir });
    return {
      teamId: team.id,
      recipients: response.recipients,
      agentIds: [response.taskId],
      reactivatedAgentIds: response.reactivatedAgentIds,
      delivered: true,
      requestId: structured.request_id,
      approved: response.approved,
    };
  }
  const messageKind = structured?.type === "shutdown_request" || args.messageType === "shutdown_request"
    ? "shutdown_request"
    : undefined;
  if (messageKind === "shutdown_request" && args.to === "*") {
    throw new AgentWorkspaceToolError("结构化关闭请求不能广播", "invalid_arguments");
  }
  const messageText = typeof args.message === "string"
    ? args.message
    : args.message.type === "shutdown_request"
      ? args.message.reason?.trim() || "请完成当前工作并退出"
      : "计划审批响应";
  const delivery = await store.sendGlobalSubtaskMessage({
    projectId,
    orchestrationId: team.id,
    text: messageText,
    summary: args.summary,
    ...(directRecipientTaskId
      ? { subtaskIds: [directRecipientTaskId] }
      : args.to === "*" ? {} : { recipientNames: [args.to] }),
    reactivateTerminalTeamMembers: isPersistentTeam,
    reactivateTerminalAgents: !isPersistentTeam,
    kind: messageKind,
  }, dataDir);
  if (delivery.reactivatedAgentIds.length) {
    if (!args.model?.trim()) throw new AgentWorkspaceToolError("重新激活 Agent 时缺少模型配置", "invalid_arguments");
    const runtime = await import("@/lib/global-agent/delegated-runtime");
    await runtime.startDelegatedOrchestrationRun({
      projectId,
      orchestrationId: team.id,
      model: args.model,
      reasoningEffort: delegatedReasoningEffort,
      modelSpeed: delegatedModelSpeed,
    }, { callModel: delegatedCallModel, dataDir });
  }
  return {
    teamId: team.id,
    recipients: delivery.recipientNames,
    agentIds: delivery.recipients,
    reactivatedAgentIds: delivery.reactivatedAgentIds,
    delivered: delivery.recipients.length > 0,
    requestId: delivery.requestId,
  };
}

async function deleteTeam(
  projectId: string,
  args: AgentWorkspaceToolArguments["team_delete"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["team_delete"]> {
  const store = await import("@/lib/global-agent/orchestration-store");
  const team = args.teamId
    ? await store.getGlobalOrchestration(projectId, args.teamId, dataDir)
    : await store.getOpenGlobalTeam(projectId, dataDir);
  if (!team) return { success: true, message: "当前没有开放 Team" };
  return store.closeGlobalTeam(projectId, team.id, dataDir);
}

export async function projectDelegatedExecutionEvents(input: {
  orchestrationId: string;
  projectId: string;
  tasks: Array<{ agentExecutionId?: string; id: string; title: string }>;
  turnId: string;
}, dataDir = getZenmeDataDir()) {
  const session = await getProjectAgentSession(input.projectId, dataDir);
  const turnEvents = session.events.filter((event) => event.turnId === input.turnId);
  const projectedCalls = new Map(turnEvents.flatMap((event) =>
    event.type === "toolCall" && typeof event.data?.delegatedSourceId === "string"
      ? [[event.data.delegatedSourceId, event] as const]
      : [],
  ));
  const projectedResults = new Set(turnEvents.flatMap((event) =>
    event.type === "toolResult" && typeof event.data?.delegatedSourceId === "string"
      ? [event.data.delegatedSourceId]
      : [],
  ));

  for (const task of input.tasks) {
    if (!task.agentExecutionId) continue;
    const detail = await getAgentExecution(input.projectId, task.agentExecutionId, dataDir);
    if (!detail) continue;
    for (const call of detail.toolCalls) {
      const sourceId = `tool:${call.id}`;
      let projectedCall = projectedCalls.get(sourceId);
      if (!projectedCall) {
        projectedCall = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId: input.turnId,
          type: "toolCall",
          content: delegatedActivitySummary(task.title, call.name, call.arguments),
          data: delegatedProjectionData(input, task, detail, sourceId, call.name, "running"),
        }, dataDir);
        projectedCalls.set(sourceId, projectedCall);
      }
      if (call.status !== "running" && !projectedResults.has(sourceId)) {
        await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId: input.turnId,
          type: "toolResult",
          content: delegatedResultSummary(task.title, call.name, call.output, call.error),
          data: {
            ...delegatedProjectionData(input, task, detail, sourceId, call.name, call.status),
            toolCallEventId: projectedCall.id,
          },
        }, dataDir);
        projectedResults.add(sourceId);
      }
    }
    for (const command of detail.commandRequests) {
      const sourceId = `command:${command.id}`;
      let projectedCall = projectedCalls.get(sourceId);
      if (!projectedCall) {
        projectedCall = await appendProjectAgentEvent({
          projectId: input.projectId,
          turnId: input.turnId,
          type: "toolCall",
          content: `${task.title}：${(command.command ?? [command.executable, ...command.args].join(" ")).slice(0, 1_000)}`,
          data: delegatedProjectionData(input, task, detail, sourceId, "shell_command", "running"),
        }, dataDir);
        projectedCalls.set(sourceId, projectedCall);
      }
      if (!commandIsTerminal(command.status) || projectedResults.has(sourceId)) continue;
      await appendProjectAgentEvent({
        projectId: input.projectId,
        turnId: input.turnId,
        type: "toolResult",
        content: delegatedResultSummary(
          task.title,
          "shell_command",
          command.stdout || command.stderr || command.previewUrl,
          command.error,
        ),
        data: {
          ...delegatedProjectionData(
            input,
            task,
            detail,
            sourceId,
            "shell_command",
            command.status === "succeeded" ? "succeeded" : command.status === "stopped" ? "stopped" : "failed",
          ),
          toolCallEventId: projectedCall.id,
        },
      }, dataDir);
      projectedResults.add(sourceId);
    }
  }
}

function delegatedProjectionData(
  input: { orchestrationId: string },
  task: { agentExecutionId?: string; id: string; title: string },
  detail: AgentExecutionDetail,
  sourceId: string,
  name: string,
  status: string,
) {
  return {
    delegated: true,
    delegatedSourceId: sourceId,
    executionId: detail.id,
    name,
    orchestrationId: input.orchestrationId,
    status,
    subtaskId: task.id,
    subtaskTitle: task.title,
    uiProjection: true,
  };
}

function delegatedActivitySummary(title: string, name: string, argumentsValue: unknown) {
  const serialized = JSON.stringify(argumentsValue);
  return `${title}：${name}${serialized && serialized !== "{}" ? ` ${serialized.slice(0, 1_500)}` : ""}`;
}

function delegatedResultSummary(title: string, name: string, output: unknown, error?: string) {
  if (error) return `${title}：${name} 失败：${error.slice(0, 2_000)}`;
  if (typeof output === "string" && output.trim()) return `${title}：${output.trim().slice(-2_000)}`;
  return `${title}：${name} 已完成`;
}

function shellCommandReason(input: AgentWorkspaceToolArguments["shell_command"]) {
  const text = "command" in input && input.command
    ? input.command
    : [input.executable, ...(input.args ?? [])].filter(Boolean).join(" ");
  return text.trim().slice(0, 2_000) || "运行命令";
}

function shellCommandMatchesAdditionalAllowance(command: AgentCommandRequest, rules: string[] | undefined) {
  if (!rules?.length) return false;
  const invocation = (command.command ?? [command.executable, ...command.args].join(" ")).trim();
  for (const rule of rules) {
    const normalized = rule.trim();
    if (/^(?:bash|powershell|shell_command)$/i.test(normalized)) return true;
    const scoped = normalized.match(/^(?:bash|powershell|shell_command)\((.*)\)$/i)?.[1]?.trim();
    if (!scoped) continue;
    const pattern = scoped.replace(/:\*$/u, "*");
    const expression = `^${pattern.split("*").map(escapeRegExp).join(".*")}$`;
    if (new RegExp(expression, "i").test(invocation)) return true;
  }
  return false;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function commandIsTerminal(status: string) {
  return ["succeeded", "failed", "stopped", "timedOut", "rejected"].includes(status);
}

async function assertExecutionToolScope(
  input: {
    arguments: AgentWorkspaceToolArguments[AgentWorkspaceToolName];
    executionId: string;
    name: AgentWorkspaceToolName;
    projectId: string;
  },
  dataDir: string,
) {
  const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
  if (!detail) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const allowedTools = detail.context.allowedTools;
  if (allowedTools !== undefined && !allowedTools.includes(input.name)) {
    throw new AgentWorkspaceToolError("Sub-agent 未获得该工具能力", "invalid_arguments");
  }
  if (detail.context.workspaceRootId && ROOT_SCOPED_TOOLS.has(input.name)) {
    const requestedRootId = (input.arguments as { rootId?: unknown }).rootId;
    if (requestedRootId !== detail.context.workspaceRootId) {
      throw new AgentWorkspaceToolError("Sub-agent Workspace Root 作用域不匹配", "invalid_arguments");
    }
  }
  const prefixes = detail.context.allowedPathPrefixes ?? [];
  if (prefixes.length === 0 || prefixes.includes(".")) return;
  for (const candidate of toolPaths(input.name, input.arguments)) {
    const relativePath = normalizeRelativePath(candidate, true);
    if (!prefixes.some((prefix) => isWithinPrefix(relativePath, normalizeRelativePath(prefix, true)))) {
      throw new AgentWorkspaceToolError("Sub-agent 路径超出任务范围", "invalid_arguments");
    }
  }
}

function toolPaths(name: AgentWorkspaceToolName, args: AgentWorkspaceToolArguments[AgentWorkspaceToolName]) {
  if (name === "workspace_status") return ["."];
  if (name === "list_directory") return [(args as AgentWorkspaceToolArguments["list_directory"]).relativePath ?? "."];
  if (name === "glob_files") return [(args as AgentWorkspaceToolArguments["glob_files"]).pathPrefix ?? "."];
  if (name === "code_diagnostics") return (args as AgentWorkspaceToolArguments["code_diagnostics"]).relativePaths ?? [];
  if (name === "code_intelligence") return [(args as AgentWorkspaceToolArguments["code_intelligence"]).filePath];
  if (name === "view_image") return [(args as AgentWorkspaceToolArguments["view_image"]).relativePath];
  if (name === "search_files") return [(args as AgentWorkspaceToolArguments["search_files"]).pathPrefix ?? "."];
  if (name === "search_knowledge") return [];
  if (name === "web_search") return [];
  if (name === "web_fetch" || name === "ask_user_question") return [];
  if (name === "read_file") {
    const requestedPath = (args as AgentWorkspaceToolArguments["read_file"]).relativePath;
    if (isProjectAgentMemoryVirtualPath(requestedPath) || isProjectAgentPlanVirtualPath(requestedPath)) return [];
    return path.isAbsolute(requestedPath) ? [] : [requestedPath];
  }
  if (name === "write_file") {
    const requestedPath = (args as AgentWorkspaceToolArguments["write_file"]).relativePath;
    return isProjectAgentMemoryVirtualPath(requestedPath) || isProjectAgentPlanVirtualPath(requestedPath) ? [] : [requestedPath];
  }
  if (name === "edit_file") {
    const requestedPath = (args as AgentWorkspaceToolArguments["edit_file"]).relativePath;
    return isProjectAgentMemoryVirtualPath(requestedPath) || isProjectAgentPlanVirtualPath(requestedPath) ? [] : [requestedPath];
  }
  if (name === "apply_patch") return applyPatchPaths((args as AgentWorkspaceToolArguments["apply_patch"]).patch);
  if (name === "notebook_edit") return [(args as AgentWorkspaceToolArguments["notebook_edit"]).relativePath];
  if (name === "shell_command" || name === "task_output" || name === "task_stop" || name === "skill" || name === "tool_search") return [];
  if (name === "git_diff") return (args as AgentWorkspaceToolArguments["git_diff"]).relativePaths ?? ["."];
  if (name === "propose_patch") {
    return (args as AgentWorkspaceToolArguments["propose_patch"]).operations.flatMap((operation) =>
      operation.targetRelativePath ? [operation.relativePath, operation.targetRelativePath] : [operation.relativePath]);
  }
  if (name === "propose_memory") {
    return (args as AgentWorkspaceToolArguments["propose_memory"]).sources.flatMap((source) => source.kind === "workspaceFile" && source.relativePath ? [source.relativePath] : []);
  }
  return [];
}

export function persistedAgentWorkspaceToolOutput<Name extends AgentWorkspaceToolName>(
  name: Name,
  output: AgentWorkspaceToolResult[Name],
) {
  if (name === "view_image") return persistedWorkspaceImageObservation(output as AgentWorkspaceToolResult["view_image"]);
  if (name === "browser") {
    const browserOutput = output as AgentWorkspaceToolResult["browser"];
    return browserOutput.screenshot
      ? { ...browserOutput, screenshot: { ...browserOutput.screenshot, dataUrl: undefined } }
      : browserOutput;
  }
  return output;
}

async function runBrowserPreview(input: {
  projectId: string;
  executionId: string;
  args: AgentWorkspaceToolArguments["browser"];
  signal?: AbortSignal;
  dataDir: string;
}) {
  const url = input.args.url?.trim();
  return controlBrowserPreview({
    sessionId: `${input.projectId}:${input.executionId}`,
    operation: input.args.operation,
    url,
    ref: input.args.ref,
    text: input.args.text,
    key: input.args.key,
    includeScreenshot: input.args.includeScreenshot,
  }, input.signal);
}

async function readBackgroundTaskOutput(
  projectId: string,
  args: { taskId: string; wait: boolean; timeoutMs?: number },
  dataDir: string,
) {
  const initial = await getAgentBackgroundTask(projectId, args.taskId, dataDir);
  if (!args.wait || initial.status !== "running") return initial;
  const signature = taskOutputSignature(initial);
  const deadline = Date.now() + normalizeWaitMs(args.timeoutMs, 30_000, 600_000);
  let current = initial;
  while (current.status === "running" && Date.now() < deadline) {
    await delay(Math.min(250, deadline - Date.now()));
    current = await getAgentBackgroundTask(projectId, args.taskId, dataDir);
    if (taskOutputSignature(current) !== signature) break;
  }
  return current;
}

async function readAgentBackgroundTaskOutput(
  projectId: string,
  args: { taskId: string; wait: boolean; timeoutMs?: number },
  dataDir: string,
) {
  let current = await findAgentBackgroundTask(projectId, args.taskId, dataDir);
  if (!current || !args.wait || !agentTaskIsRunning(current.status)) return current;
  const deadline = Date.now() + normalizeWaitMs(args.timeoutMs, 30_000, 600_000);
  while (agentTaskIsRunning(current.status) && Date.now() < deadline) {
    await delay(Math.min(250, deadline - Date.now()));
    current = await findAgentBackgroundTask(projectId, args.taskId, dataDir);
    if (!current) return null;
  }
  return current;
}

async function stopAgentSubtask(projectId: string, taskId: string, dataDir: string) {
  const store = await import("@/lib/global-agent/orchestration-store");
  const orchestration = (await store.listGlobalOrchestrations(projectId, dataDir))
    .find((candidate) => candidate.tasks.some((task) => task.id === taskId));
  if (!orchestration) return null;
  const task = orchestration.tasks.find((candidate) => candidate.id === taskId);
  if (task?.agentExecutionId) {
    const runtime = await import("@/lib/global-agent/delegated-runtime");
    runtime.stopDelegatedSubagentRun(projectId, task.agentExecutionId, dataDir);
  }
  await store.stopGlobalSubtask(projectId, orchestration.id, taskId, dataDir);
  return findAgentBackgroundTask(projectId, taskId, dataDir);
}

async function findAgentBackgroundTask(
  projectId: string,
  taskId: string,
  dataDir: string,
): Promise<AgentBackgroundTaskSnapshot | null> {
  const store = await import("@/lib/global-agent/orchestration-store");
  const orchestration = (await store.listGlobalOrchestrations(projectId, dataDir))
    .find((candidate) => candidate.tasks.some((task) => task.id === taskId));
  if (!orchestration) return null;
  const refreshed = await store.refreshGlobalOrchestration(projectId, orchestration.id, dataDir);
  const task = refreshed.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;
  const output = task.resultSummary ?? task.error ?? "";
  return {
    taskId: task.id,
    taskType: "local_agent",
    orchestrationId: refreshed.id,
    agentId: task.id,
    name: task.name,
    description: task.title,
    status: task.status,
    prompt: task.instruction,
    output,
    result: task.resultSummary,
    error: task.error,
    agentExecutionId: task.agentExecutionId,
    changeSetIds: [...task.changeSetIds],
  };
}

function agentTaskIsRunning(status: AgentBackgroundTaskSnapshot["status"]) {
  return ["queued", "dispatching", "running", "waitingApproval", "waitingInput"].includes(status);
}

function taskOutputSignature(task: { status: string; stdout?: string; stderr?: string }) {
  return `${task.status}\u0000${task.stdout ?? ""}\u0000${task.stderr ?? ""}`;
}

function projectToolPermissionContent(
  name: AgentWorkspaceToolName,
  argumentsValue: Record<string, unknown>,
) {
  const pathValue = typeof argumentsValue.relativePath === "string"
    ? argumentsValue.relativePath
    : typeof argumentsValue.pathPrefix === "string"
      ? argumentsValue.pathPrefix
      : undefined;
  if (pathValue !== undefined) return pathValue;
  if (name === "apply_patch" && typeof argumentsValue.patch === "string") return argumentsValue.patch;
  if (name === "web_fetch" && typeof argumentsValue.url === "string") return argumentsValue.url;
  if (name === "web_search" && typeof argumentsValue.query === "string") return argumentsValue.query;
  if (name === "agent_spawn") {
    if (typeof argumentsValue.agentType === "string" && argumentsValue.agentType) return argumentsValue.agentType;
    if (typeof argumentsValue.name === "string") return argumentsValue.name;
  }
  if (name === "skill" && typeof argumentsValue.skill === "string") return argumentsValue.skill;
  if ((name === "task_output" || name === "task_stop") && typeof argumentsValue.task_id === "string") {
    return argumentsValue.task_id;
  }
  return undefined;
}

function normalizeWaitMs(value: number | undefined, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new AgentWorkspaceToolError("等待时间无效", "invalid_arguments");
  }
  return value;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, milliseconds)));
}

async function enterMainAgentWorktree(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["enter_worktree"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["enter_worktree"]> {
  const [session, execution, binding] = await Promise.all([
    getProjectAgentSession(projectId, dataDir),
    getAgentExecution(projectId, executionId, dataDir),
    requireWorkspaceBinding(projectId, dataDir),
  ]);
  if (!execution) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const conversationId = execution.context.conversationId;
  if (getProjectAgentConversationRuntimeState(session, conversationId).activeWorktree?.state === "active") {
    throw new AgentWorkspaceToolError("当前 Conversation 已处于 worktree 中", "invalid_arguments");
  }
  const originalRootId = execution.context.workspaceRootId ?? listWorkspaceRoots(binding).find((root) => root.primary)?.id;
  if (!originalRootId) throw new AgentWorkspaceToolError("Workspace 主根不存在", "workspace_unavailable");
  const originalRoot = resolveWorkspaceRoot(binding, originalRootId);
  if (!originalRoot || !canUseWorkspaceRootCapability(originalRoot, "read")) {
    throw new AgentWorkspaceToolError("原 Workspace Root 不可读", "workspace_unavailable");
  }

  let worktree = await createProjectAgentWorktree({
    projectId,
    taskId: executionId,
    name: args.name,
    originalRootId,
    workspacePath: originalRoot.realPath,
    dataDir,
  });
  let registeredRootId: string | undefined;
  try {
    const updatedBinding = await addLocalWorkspaceRoot({ projectId, rootPath: worktree.path }, dataDir);
    const worktreeRealPath = await fs.realpath(worktree.path);
    registeredRootId = listWorkspaceRoots(updatedBinding).find((root) =>
      path.resolve(root.realPath).toLocaleLowerCase() === path.resolve(worktreeRealPath).toLocaleLowerCase())?.id;
    if (!registeredRootId) throw new Error("Agent worktree 无法注册为临时 Workspace Root");
    worktree = { ...worktree, rootId: registeredRootId };
    await setAgentExecutionWorkspaceRoot(projectId, executionId, registeredRootId, dataDir);
    if (conversationId) {
      await updateProjectAgentConversationContext({ projectId, conversationId, activeWorktree: worktree }, dataDir);
    } else {
      await updateProjectAgentContext({ projectId, activeWorktree: worktree }, dataDir);
    }
  } catch (error) {
    if (registeredRootId) await removeLocalWorkspaceRoot({ projectId, rootId: registeredRootId }, dataDir).catch(() => undefined);
    await removeProjectAgentWorktree(worktree).catch(() => undefined);
    throw error;
  }
  return {
    message: `已创建并进入 worktree：${worktree.path}（分支 ${worktree.branch}）。当前 Session 的默认 Workspace Root 已切换。`,
    originalRootId,
    rootId: registeredRootId,
    worktreeBranch: worktree.branch,
    worktreePath: worktree.path,
  };
}

async function exitMainAgentWorktree(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["exit_worktree"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["exit_worktree"]> {
  const [session, execution] = await Promise.all([
    getProjectAgentSession(projectId, dataDir),
    getAgentExecution(projectId, executionId, dataDir),
  ]);
  if (!execution) throw new AgentWorkspaceToolError("Agent Execution 不存在", "invalid_arguments");
  const conversationId = execution.context.conversationId;
  const worktree = getProjectAgentConversationRuntimeState(session, conversationId).activeWorktree;
  if (!worktree || worktree.state !== "active" || !worktree.rootId) {
    throw new AgentWorkspaceToolError(
      "当前 Session 没有通过 enter_worktree 创建的活动 worktree；不会处理手工或其他 Session 创建的 worktree。",
      "invalid_arguments",
    );
  }
  const summary = await inspectProjectAgentWorktreeChanges(worktree);
  if (args.action === "remove" && !args.discardChanges) {
    if (!summary) {
      throw new AgentWorkspaceToolError(
        "无法可靠确认 worktree 状态，拒绝删除。请先征得用户明确同意，再以 discardChanges=true 重试；或使用 action=keep。",
        "invalid_arguments",
      );
    }
    if (summary.changedFiles > 0 || summary.commits > 0) {
      throw new AgentWorkspaceToolError(
        `worktree 包含 ${summary.changedFiles} 个未提交文件和 ${summary.commits} 个新增提交。删除会永久丢弃这些工作；请先征得用户明确同意，再以 discardChanges=true 重试，或使用 action=keep。`,
        "invalid_arguments",
      );
    }
  }

  if (args.action === "remove") await removeProjectAgentWorktree(worktree);
  await setAgentExecutionWorkspaceRoot(projectId, executionId, worktree.originalRootId, dataDir);
  if (conversationId) {
    await updateProjectAgentConversationContext({ projectId, conversationId, activeWorktree: null }, dataDir);
  } else {
    await updateProjectAgentContext({ projectId, activeWorktree: null }, dataDir);
  }
  if (args.action === "remove") {
    await removeLocalWorkspaceRoot({ projectId, rootId: worktree.rootId }, dataDir);
  }
  return {
    action: args.action,
    message: args.action === "keep"
      ? `已退出 worktree 并恢复原 Workspace Root；工作保留在 ${worktree.path}（分支 ${worktree.branch}）。`
      : `已退出并移除 worktree ${worktree.path}；当前 Session 已恢复原 Workspace Root。`,
    originalRootId: worktree.originalRootId,
    worktreeBranch: worktree.branch,
    worktreePath: worktree.path,
    ...(args.action === "remove" && summary
      ? { discardedFiles: summary.changedFiles, discardedCommits: summary.commits }
      : {}),
  };
}

async function workspaceStatus(
  projectId: string,
  args: AgentWorkspaceToolArguments["workspace_status"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["workspace_status"]> {
  const binding = await requireWorkspaceBinding(projectId, dataDir);
  const root = await requireReadableRoot(projectId, dataDir, args.rootId);
  const requestedLimit = args.recentFileLimit ?? 20;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 0 || requestedLimit > MAX_STATUS_RECENT_FILES) {
    throw new AgentWorkspaceToolError("最近文件数量上限无效", "invalid_arguments");
  }
  const entries = await listWorkspaceFiles(projectId, dataDir, root.id);
  const files = entries.filter((entry) => entry.kind === "file");
  const scannedFiles = files.filter((entry) => !entry.sensitive).slice(0, MAX_STATUS_FILE_SCAN);
  const recentFiles = requestedLimit === 0 ? [] : (await Promise.all(scannedFiles.map(async (entry) => {
    try {
      const stat = await fs.stat(path.join(root.realPath, ...entry.relativePath.split("/")));
      if (!stat.isFile()) return null;
      return {
        relativePath: entry.relativePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  })))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
    .slice(0, requestedLimit);
  return {
    rootId: root.id,
    primary: root.primary,
    displayName: root.displayName,
    status: root.status,
    permissions: {
      read: root.permissions.read,
      write: root.permissions.write,
      execute: root.permissions.execute,
    },
    git: {
      available: root.git.available,
      branch: root.git.branch,
      dirty: root.git.dirty,
    },
    changeTracking: root.git.available ? "git" : "none",
    summary: {
      directories: entries.filter((entry) => entry.kind === "directory").length,
      files: files.length,
      sensitiveFiles: files.filter((entry) => entry.sensitive).length,
      visibleEntriesMayBeTruncated: entries.length >= 20_000,
    },
    topLevelEntries: entries
      .filter((entry) => !entry.relativePath.includes("/") && !(entry.kind === "file" && entry.sensitive))
      .slice(0, 100)
      .map((entry) => ({ kind: entry.kind, relativePath: entry.relativePath })),
    roots: listWorkspaceRoots(binding).map((item) => ({
      rootId: item.id,
      primary: item.primary,
      displayName: item.displayName,
      status: item.status,
      permissions: {
        read: item.permissions.read,
        write: item.permissions.write,
        execute: item.permissions.execute,
      },
      git: {
        available: item.git.available,
        branch: item.git.branch,
        dirty: item.git.dirty,
      },
    })),
    recentFiles,
    recentFilesScanTruncated: files.length > scannedFiles.length,
  };
}

function isWithinPrefix(relativePath: string, prefix: string) {
  return prefix === "." || relativePath === prefix || relativePath.startsWith(`${prefix}/`);
}

async function listDirectory(
  projectId: string,
  args: AgentWorkspaceToolArguments["list_directory"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["list_directory"]> {
  const relativePath = normalizeRelativePath(args.relativePath ?? ".", true);
  const root = await requireReadableRoot(projectId, dataDir, args.rootId);
  const entries = await listWorkspaceFiles(projectId, dataDir, root.id);
  const prefix = relativePath === "." ? "" : `${relativePath}/`;
  const direct = entries.filter((entry) => {
    if (!entry.relativePath.startsWith(prefix) || entry.relativePath === relativePath) return false;
    const remainder = entry.relativePath.slice(prefix.length);
    return remainder && !remainder.includes("/") && !(entry.kind === "file" && entry.sensitive);
  });
  return {
    ...(!root.primary ? { rootId: root.id } : {}),
    entries: direct.map((entry) => ({ kind: entry.kind, relativePath: entry.relativePath })),
  };
}

async function globFiles(
  projectId: string,
  args: AgentWorkspaceToolArguments["glob_files"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["glob_files"]> {
  const pathPrefix = args.pathPrefix ? normalizeRelativePath(args.pathPrefix, true) : ".";
  const pattern = normalizeGlobPattern(args.pattern);
  const requestedMax = args.maxResults ?? 200;
  if (!Number.isInteger(requestedMax) || requestedMax < 1 || requestedMax > MAX_GLOB_RESULTS) {
    throw new AgentWorkspaceToolError("Glob 结果上限无效", "invalid_arguments");
  }
  const matcher = globToRegExp(pattern);
  const prefix = pathPrefix === "." ? "" : `${pathPrefix}/`;
  const roots = await requireReadableRoots(projectId, dataDir, args.rootId);
  const candidates = (await Promise.all(roots.map(async (root) => (await listWorkspaceFiles(projectId, dataDir, root.id))
    .filter((entry) => entry.kind === "file" && !entry.sensitive)
    .filter((entry) => !prefix || entry.relativePath.startsWith(prefix))
    .map((entry) => ({
      rootId: root.id,
      relativePath: entry.relativePath,
      matchPath: prefix ? entry.relativePath.slice(prefix.length) : entry.relativePath,
    }))
    .filter((entry) => matcher.test(entry.matchPath))))).flat()
    .sort((left, right) => left.rootId.localeCompare(right.rootId) || left.relativePath.localeCompare(right.relativePath));
  const selected = candidates.slice(0, requestedMax);
  return {
    ...(args.rootId && !roots[0].primary ? { rootId: roots[0].id } : {}),
    paths: selected.map((entry) => entry.relativePath),
    ...(roots.length > 1 ? { matches: selected.map(({ rootId, relativePath }) => ({ rootId, relativePath })) } : {}),
    truncated: candidates.length > requestedMax,
  };
}

async function searchFiles(
  projectId: string,
  args: AgentWorkspaceToolArguments["search_files"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["search_files"]> {
  if (typeof args.query !== "string" || !args.query.trim() || args.query.length > 1_000) {
    throw new AgentWorkspaceToolError("搜索词无效", "invalid_arguments");
  }
  const roots = await requireReadableRoots(projectId, dataDir, args.rootId);
  const pathPrefix = args.pathPrefix ? normalizeRelativePath(args.pathPrefix, true) : ".";
  const requestedMax = args.maxResults ?? 50;
  if (!Number.isInteger(requestedMax) || requestedMax < 1 || requestedMax > MAX_SEARCH_RESULTS) {
    throw new AgentWorkspaceToolError("搜索结果上限无效", "invalid_arguments");
  }
  const query = args.query.toLocaleLowerCase();
  const entries = (await Promise.all(roots.map(async (root) => (await listWorkspaceFiles(projectId, dataDir, root.id))
    .filter((entry) => entry.kind === "file" && !entry.sensitive)
    .filter((entry) => pathPrefix === "." || entry.relativePath === pathPrefix || entry.relativePath.startsWith(`${pathPrefix}/`))
    .map((entry) => ({ ...entry, root })))))
    .flat()
    .slice(0, MAX_SEARCH_FILES);
  const matches: AgentWorkspaceToolResult["search_files"]["matches"] = [];
  let scannedBytes = 0;
  let truncated = false;
  for (const entry of entries) {
    if (matches.length >= requestedMax || scannedBytes >= MAX_SEARCH_BYTES) {
      truncated = true;
      break;
    }
    const filePath = await resolveExistingWorkspacePath(entry.root.realPath, entry.relativePath);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_WORKSPACE_TEXT_BYTES || scannedBytes + stat.size > MAX_SEARCH_BYTES) continue;
    const buffer = await fs.readFile(filePath);
    scannedBytes += buffer.length;
    const content = decodeUtf8(buffer);
    if (content === null) continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].toLocaleLowerCase().includes(query)) continue;
      matches.push({
        ...(roots.length > 1 || !entry.root.primary ? { rootId: entry.root.id } : {}),
        relativePath: entry.relativePath,
        line: index + 1,
        text: lines[index].slice(0, 500),
      });
      if (matches.length >= requestedMax) {
        truncated = index + 1 < lines.length || entries.at(-1) !== entry;
        break;
      }
    }
  }
  return { ...(args.rootId && !roots[0].primary ? { rootId: roots[0].id } : {}), matches, truncated };
}

async function readFile(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["read_file"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["read_file"]> {
  if (isProjectAgentPlanVirtualPath(args.relativePath)) {
    const detail = await getAgentExecution(projectId, executionId, dataDir);
    return sliceTextFileResult(
      args.relativePath,
      await readProjectAgentPlan(projectId, dataDir, detail?.context.conversationId),
      args.startLine,
      args.endLine,
    );
  }
  if (isProjectAgentMemoryVirtualPath(args.relativePath)) {
    const detail = await requireAgentMemoryContext(projectId, executionId, dataDir);
    const content = await readProjectAgentMemoryFile({
      projectId,
      ...detail.context.agentMemory!,
      rootId: detail.context.workspaceRootId,
      virtualPath: args.relativePath,
      dataDir,
    }).catch((error) => {
      throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent Memory 读取失败", "file_unreadable");
    });
    return sliceTextFileResult(args.relativePath, content, args.startLine, args.endLine);
  }
  const taskOutputPath = path.isAbsolute(args.relativePath)
    ? await resolveOwnedTaskOutputPath(projectId, executionId, args.relativePath, dataDir)
    : null;
  const relativePath = taskOutputPath ? args.relativePath : normalizeRelativePath(args.relativePath);
  if (!taskOutputPath) assertNotSensitive(relativePath);
  const root = taskOutputPath ? null : await requireReadableRoot(projectId, dataDir, args.rootId);
  const filePath = taskOutputPath ?? await resolveExistingWorkspacePath(root!.realPath, relativePath);
  const stat = await fs.stat(filePath);
  const pdf = !taskOutputPath && path.extname(filePath).toLocaleLowerCase() === ".pdf";
  const maxReadableBytes = taskOutputPath ? 64 * 1024 * 1024 : pdf ? 32 * 1024 * 1024 : MAX_WORKSPACE_TEXT_BYTES;
  if (!stat.isFile() || stat.size > maxReadableBytes) {
    throw new AgentWorkspaceToolError(
      taskOutputPath ? "任务输出不可读或超过 64 MiB" : pdf ? "PDF 不可读或超过 32 MiB" : "文件不可读或超过 1 MiB",
      "file_unreadable",
    );
  }
  const buffer = await fs.readFile(filePath);
  if (pdf) {
    const content = await readPdfText(buffer, args.pages);
    return { ...sliceTextFileResult(relativePath, content, args.startLine, args.endLine), ...(root && !root.primary ? { rootId: root.id } : {}) };
  }
  const content = taskOutputPath ? decodeCommandOutput([buffer]) : decodeUtf8(buffer);
  if (content === null) throw new AgentWorkspaceToolError("文件不是 UTF-8 文本", "file_unreadable");
  return { ...sliceTextFileResult(relativePath, content, args.startLine, args.endLine), ...(root && !root.primary ? { rootId: root.id } : {}) };
}

async function readPdfText(buffer: Buffer, pagesExpression?: string) {
  let loadingTask: import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask | undefined;
  let document: import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy | undefined;
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      useWorkerFetch: false,
    });
    document = await loadingTask.promise;
    const pages = parsePdfPages(pagesExpression, document.numPages);
    const chunks: string[] = [];
    for (const pageNumber of pages) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const content = text.items.flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : []).join(" ").trim();
      chunks.push(`--- PDF page ${pageNumber}/${document.numPages} ---\n${content || "[此页没有可提取文本，可能是扫描件]"}`);
      page.cleanup();
    }
    return chunks.join("\n\n");
  } catch (error) {
    if (error instanceof AgentWorkspaceToolError) throw error;
    throw new AgentWorkspaceToolError(error instanceof Error ? `PDF 读取失败：${error.message}` : "PDF 读取失败", "file_unreadable");
  } finally {
    await loadingTask?.destroy().catch(() => undefined);
  }
}

export function parsePdfPages(expression: string | undefined, totalPages: number) {
  if (!Number.isSafeInteger(totalPages) || totalPages < 1) throw new AgentWorkspaceToolError("PDF 页数无效", "file_unreadable");
  if (!expression?.trim()) {
    if (totalPages > 20) throw new AgentWorkspaceToolError(`PDF 共 ${totalPages} 页；请用 pages 指定范围，单次最多读取 20 页`, "file_unreadable");
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = new Set<number>();
  for (const part of expression.split(",").map((item) => item.trim())) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw new AgentWorkspaceToolError("PDF pages 格式无效；请使用 1-5 或 1,3,5-7", "invalid_arguments");
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start || end > totalPages) throw new AgentWorkspaceToolError(`PDF 页码必须位于 1-${totalPages}`, "invalid_arguments");
    for (let page = start; page <= end; page += 1) {
      pages.add(page);
      if (pages.size > 20) throw new AgentWorkspaceToolError("单次最多读取 20 页 PDF", "file_unreadable");
    }
  }
  return [...pages].sort((left, right) => left - right);
}

function sliceTextFileResult(relativePath: string, content: string, requestedStart?: number, requestedEndLine?: number) {
  const lines = content.split(/\r?\n/);
  const startLine = normalizeLine(requestedStart, 1, lines.length || 1);
  const requestedEnd = requestedEndLine ?? Math.min(lines.length, startLine + MAX_READ_LINES - 1);
  if (!Number.isInteger(requestedEnd) || requestedEnd < startLine) throw new AgentWorkspaceToolError("文件行号无效", "invalid_arguments");
  const endLine = Math.min(requestedEnd, lines.length || 1, startLine + MAX_READ_LINES - 1);
  const selectedContent = lines.slice(startLine - 1, endLine).join("\n");
  const tokenEstimate = estimateTextTokenCount(selectedContent);
  if (tokenEstimate > MAX_READ_OUTPUT_TOKENS) {
    throw new AgentWorkspaceToolError(
      `文件内容约 ${tokenEstimate.toLocaleString("en-US")} tokens，超过单次读取上限 ${MAX_READ_OUTPUT_TOKENS.toLocaleString("en-US")}；请缩小 startLine/endLine 范围，或先使用 search_files 定位内容`,
      "file_unreadable",
    );
  }
  return { relativePath, startLine, endLine, totalLines: lines.length, content: selectedContent };
}

async function resolveOwnedTaskOutputPath(
  projectId: string,
  executionId: string,
  requestedPath: string,
  dataDir: string,
) {
  const detail = await getAgentExecution(projectId, executionId, dataDir);
  const requested = path.resolve(requestedPath);
  const owned = detail?.commandRequests.find((command) =>
    command.outputFilePath && path.resolve(command.outputFilePath) === requested,
  );
  if (owned?.outputFilePath) return owned.outputFilePath;
  const toolResult = detail?.toolCalls
    .map((call) => call.output)
    .find((output) => isPersistedAgentToolResult(output) && path.resolve(output.outputFilePath) === requested);
  if (isPersistedAgentToolResult(toolResult)) return toolResult.outputFilePath;
  const session = await getProjectAgentSession(projectId, dataDir);
  const turnResult = session.events
    .filter((event) => event.data?.executionId === executionId)
    .map((event) => event.data?.output)
    .find((output) => isPersistedAgentToolResult(output) && path.resolve(output.outputFilePath) === requested);
  if (!isPersistedAgentToolResult(turnResult)) {
    throw new AgentWorkspaceToolError("只能读取当前 Agent Execution 返回的任务输出文件", "invalid_arguments");
  }
  return turnResult.outputFilePath;
}

async function writeFile(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["write_file"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["write_file"]> {
  const execution = await getAgentExecution(projectId, executionId, dataDir);
  const conversationId = execution?.context.conversationId;
  if (isProjectAgentPlanVirtualPath(args.relativePath)) {
    const previous = await readProjectAgentPlan(projectId, dataDir, conversationId);
    await writeProjectAgentPlan(projectId, args.content, dataDir, conversationId);
    return { operation: previous ? "modify" : "create", relativePath: args.relativePath, status: "written" };
  }
  const session = await getProjectAgentSession(projectId, dataDir);
  if (getProjectAgentConversationRuntimeState(session, conversationId).interactionMode === "plan") {
    throw new AgentWorkspaceToolError(
      `规划模式只能写入 ${getProjectAgentPlanFilePath(projectId, dataDir, conversationId)}`,
      "invalid_arguments",
    );
  }
  if (isProjectAgentMemoryVirtualPath(args.relativePath)) {
    const detail = await requireAgentMemoryContext(projectId, executionId, dataDir);
    let operation: "create" | "modify" = "modify";
    try {
      await readProjectAgentMemoryFile({ projectId, ...detail.context.agentMemory!, rootId: detail.context.workspaceRootId, virtualPath: args.relativePath, dataDir });
    } catch { operation = "create"; }
    await writeProjectAgentMemoryFile({ projectId, ...detail.context.agentMemory!, rootId: detail.context.workspaceRootId, virtualPath: args.relativePath, content: args.content, dataDir })
      .catch((error) => { throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent Memory 写入失败", "invalid_arguments"); });
    return { operation, relativePath: args.relativePath, status: "written" };
  }
  const relativePath = normalizeRelativePath(args.relativePath);
  assertNotSensitive(relativePath);
  if (Buffer.byteLength(args.content, "utf8") > MAX_WORKSPACE_TEXT_BYTES) {
    throw new AgentWorkspaceToolError("写入内容超过 1 MiB", "invalid_arguments");
  }
  const exists = (await listWorkspaceFiles(projectId, dataDir, args.rootId)).some((entry) =>
    entry.kind === "file" && entry.relativePath === relativePath);
  const operation = exists ? "modify" : "create";
  const changeSet = await createWorkspaceChangeSet({
    projectId,
    rootId: args.rootId,
    title: args.title?.trim() || `${operation === "create" ? "创建" : "更新"} ${relativePath}`,
    description: "由 Agent Write 工具提出，等待用户审阅。",
    operations: [{ kind: operation, relativePath, proposedContent: args.content }],
    source: "agent",
    sourceAgentId: "workspace-agent",
    sourceExecutionId: executionId,
  }, dataDir);
  return { changeSetId: changeSet.id, operation, status: "proposed" };
}

async function editFile(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["edit_file"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["edit_file"]> {
  const execution = await getAgentExecution(projectId, executionId, dataDir);
  const conversationId = execution?.context.conversationId;
  if (isProjectAgentPlanVirtualPath(args.relativePath)) {
    const content = await readProjectAgentPlan(projectId, dataDir, conversationId);
    const occurrences = content.split(args.oldText).length - 1;
    if (occurrences === 0) throw new AgentWorkspaceToolError("Edit 未找到 oldText", "invalid_arguments");
    if (!args.replaceAll && occurrences !== 1) throw new AgentWorkspaceToolError("Edit 的 oldText 匹配多处；请提供更精确文本或启用 replaceAll", "invalid_arguments");
    const next = args.replaceAll ? content.split(args.oldText).join(args.newText) : content.replace(args.oldText, args.newText);
    await writeProjectAgentPlan(projectId, next, dataDir, conversationId);
    return { replacements: args.replaceAll ? occurrences : 1, relativePath: args.relativePath, status: "written" };
  }
  const session = await getProjectAgentSession(projectId, dataDir);
  if (getProjectAgentConversationRuntimeState(session, conversationId).interactionMode === "plan") {
    throw new AgentWorkspaceToolError(
      `规划模式只能编辑 ${getProjectAgentPlanFilePath(projectId, dataDir, conversationId)}`,
      "invalid_arguments",
    );
  }
  if (isProjectAgentMemoryVirtualPath(args.relativePath)) {
    const detail = await requireAgentMemoryContext(projectId, executionId, dataDir);
    const content = await readProjectAgentMemoryFile({ projectId, ...detail.context.agentMemory!, rootId: detail.context.workspaceRootId, virtualPath: args.relativePath, dataDir })
      .catch((error) => { throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent Memory 读取失败", "file_unreadable"); });
    const occurrences = content.split(args.oldText).length - 1;
    if (occurrences === 0) throw new AgentWorkspaceToolError("Edit 未找到 oldText", "invalid_arguments");
    if (!args.replaceAll && occurrences !== 1) throw new AgentWorkspaceToolError("Edit 的 oldText 匹配多处；请提供更精确文本或启用 replaceAll", "invalid_arguments");
    const next = args.replaceAll ? content.split(args.oldText).join(args.newText) : content.replace(args.oldText, args.newText);
    await writeProjectAgentMemoryFile({ projectId, ...detail.context.agentMemory!, rootId: detail.context.workspaceRootId, virtualPath: args.relativePath, content: next, dataDir })
      .catch((error) => { throw new AgentWorkspaceToolError(error instanceof Error ? error.message : "Agent Memory 写入失败", "invalid_arguments"); });
    return { replacements: args.replaceAll ? occurrences : 1, relativePath: args.relativePath, status: "written" };
  }
  const relativePath = normalizeRelativePath(args.relativePath);
  const content = await readWorkspaceText(projectId, relativePath, dataDir, args.rootId);
  const occurrences = content.split(args.oldText).length - 1;
  if (occurrences === 0) throw new AgentWorkspaceToolError("Edit 未找到 oldText", "invalid_arguments");
  if (!args.replaceAll && occurrences !== 1) {
    throw new AgentWorkspaceToolError("Edit 的 oldText 匹配多处；请提供更精确文本或启用 replaceAll", "invalid_arguments");
  }
  const proposedContent = args.replaceAll
    ? content.split(args.oldText).join(args.newText)
    : content.replace(args.oldText, args.newText);
  const changeSet = await createWorkspaceChangeSet({
    projectId,
    rootId: args.rootId,
    title: args.title?.trim() || `编辑 ${relativePath}`,
    description: "由 Agent Edit 工具提出，等待用户审阅。",
    operations: [{ kind: "modify", relativePath, proposedContent }],
    source: "agent",
    sourceAgentId: "workspace-agent",
    sourceExecutionId: executionId,
  }, dataDir);
  return { changeSetId: changeSet.id, replacements: args.replaceAll ? occurrences : 1, status: "proposed" };
}

async function requireAgentMemoryContext(projectId: string, executionId: string, dataDir: string) {
  const detail = await getAgentExecution(projectId, executionId, dataDir);
  if (!detail?.context.agentMemory) throw new AgentWorkspaceToolError("当前 Agent 未配置持久记忆", "invalid_arguments");
  return detail;
}

async function applyPatch(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["apply_patch"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["apply_patch"]> {
  try {
    const parsed = parseApplyPatchDocument(args.patch);
    const operations: AgentWorkspaceToolArguments["propose_patch"]["operations"] = [];
    for (const operation of parsed) {
      const relativePath = normalizeRelativePath(operation.relativePath);
      assertNotSensitive(relativePath);
      if (operation.kind === "add") {
        assertPatchContentSize(operation.content);
        operations.push({ kind: "create", relativePath, proposedContent: operation.content });
      } else if (operation.kind === "delete") {
        operations.push({ kind: "delete", relativePath });
      } else if (operation.kind === "move") {
        const targetRelativePath = normalizeRelativePath(operation.targetRelativePath);
        assertNotSensitive(targetRelativePath);
        operations.push({ kind: "rename", relativePath, targetRelativePath });
      } else {
        const proposedContent = applyPatchToText(
          await readWorkspaceText(projectId, relativePath, dataDir, args.rootId),
          operation.hunks,
          relativePath,
        );
        assertPatchContentSize(proposedContent);
        operations.push({ kind: "modify", relativePath, proposedContent });
      }
    }
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      rootId: args.rootId,
      title: args.title?.trim() || `应用补丁（${operations.length} 个文件操作）`,
      description: "由 Agent apply_patch 工具提出，已在内存中与当前文件内容精确匹配，等待用户审阅。",
      operations,
      source: "agent",
      sourceAgentId: "workspace-agent",
      sourceExecutionId: executionId,
    }, dataDir);
    return {
      changeSetId: changeSet.id,
      operationCount: operations.length,
      paths: operations.flatMap((operation) => operation.targetRelativePath
        ? [operation.relativePath, operation.targetRelativePath]
        : [operation.relativePath]),
      status: "proposed",
    };
  } catch (error) {
    if (error instanceof ApplyPatchError) {
      throw new AgentWorkspaceToolError(error.message, "invalid_arguments");
    }
    throw error;
  }
}

function assertPatchContentSize(content: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_TEXT_BYTES) {
    throw new AgentWorkspaceToolError("补丁生成的单个文件超过 1 MiB", "invalid_arguments");
  }
}

async function notebookEdit(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["notebook_edit"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["notebook_edit"]> {
  const relativePath = normalizeRelativePath(args.relativePath);
  if (!relativePath.toLocaleLowerCase().endsWith(".ipynb")) {
    throw new AgentWorkspaceToolError("NotebookEdit 仅支持 .ipynb 文件", "invalid_arguments");
  }
  const content = await readWorkspaceText(projectId, relativePath, dataDir, args.rootId);
  let notebook: unknown;
  try { notebook = JSON.parse(content); }
  catch { throw new AgentWorkspaceToolError("Notebook JSON 无效", "file_unreadable"); }
  if (!isObject(notebook) || !Array.isArray(notebook.cells) || !isObject(notebook.cells[args.cellIndex])) {
    throw new AgentWorkspaceToolError("Notebook 单元格索引无效", "invalid_arguments");
  }
  const cell = notebook.cells[args.cellIndex] as Record<string, unknown>;
  cell.source = toNotebookSource(args.source);
  const proposedContent = `${JSON.stringify(notebook, null, 2)}\n`;
  const changeSet = await createWorkspaceChangeSet({
    projectId,
    rootId: args.rootId,
    title: args.title?.trim() || `编辑 ${relativePath} 单元格 ${args.cellIndex}`,
    description: "由 Agent NotebookEdit 工具提出，等待用户审阅。",
    operations: [{ kind: "modify", relativePath, proposedContent }],
    source: "agent",
    sourceAgentId: "workspace-agent",
    sourceExecutionId: executionId,
  }, dataDir);
  return { changeSetId: changeSet.id, cellIndex: args.cellIndex, status: "proposed" };
}

async function searchKnowledge(projectId: string, args: AgentWorkspaceToolArguments["search_knowledge"], dataDir: string): Promise<AgentWorkspaceToolResult["search_knowledge"]> {
  const response = await searchProjectKnowledge({ projectId, query: args.query, limit: args.limit, budgetCharacters: args.budgetCharacters }, dataDir);
  return { results: response.results, consumedCharacters: response.consumedCharacters, budgetCharacters: response.budgetCharacters };
}

async function proposePatch(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["propose_patch"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["propose_patch"]> {
  if (!args || typeof args.title !== "string" || !Array.isArray(args.operations)) {
    throw new AgentWorkspaceToolError("Patch 提案无效", "invalid_arguments");
  }
  for (const operation of args.operations) {
    assertNotSensitive(normalizeRelativePath(operation.relativePath));
    if (operation.targetRelativePath) assertNotSensitive(normalizeRelativePath(operation.targetRelativePath));
  }
  const changeSet = await createWorkspaceChangeSet({
    projectId,
    rootId: args.rootId,
    title: args.title,
    description: args.description,
    operations: args.operations,
    source: "agent",
    sourceAgentId: "global-agent",
    sourceExecutionId: executionId,
  }, dataDir);
  return { changeSetId: changeSet.id, status: "proposed" };
}

async function gitDiff(
  projectId: string,
  args: AgentWorkspaceToolArguments["git_diff"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["git_diff"]> {
  const root = await requireReadableRoot(projectId, dataDir, args.rootId);
  if (!root.git.available) {
    return { state: "not_git_repository", diff: "", truncated: false };
  }
  let relativePaths = args.relativePaths?.map((entry) => normalizeRelativePath(entry));
  if (relativePaths?.some(isSensitiveWorkspacePath)) {
    throw new AgentWorkspaceToolError("敏感文件不能进入 Agent Diff", "sensitive_path");
  }
  if (!relativePaths?.length) {
    const { stdout } = await execFileAsync("git", ["-C", root.realPath, "diff", "--name-only", "HEAD", "--", "."], {
      encoding: "utf8",
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: MAX_DIFF_BYTES,
    });
    relativePaths = stdout.split(/\r?\n/).filter(Boolean).map((entry) => normalizeRelativePath(entry)).filter((entry) => !isSensitiveWorkspacePath(entry)).slice(0, 2_000);
  }
  if (relativePaths.length === 0) return { state: "ok", diff: "", truncated: false };
  try {
    const { stdout } = await execFileAsync("git", ["-C", root.realPath, "diff", "--no-ext-diff", "--unified=3", "HEAD", "--", ...relativePaths], {
      encoding: "utf8",
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: MAX_DIFF_BYTES,
    });
    return { state: "ok", diff: stdout.slice(0, MAX_DIFF_BYTES), truncated: stdout.length > MAX_DIFF_BYTES };
  } catch (error) {
    const partial = isObject(error) && typeof error.stdout === "string" ? error.stdout : "";
    if (partial) return { state: "ok", diff: partial.slice(0, MAX_DIFF_BYTES), truncated: true };
    throw error;
  }
}

async function proposeMemory(
  projectId: string,
  executionId: string,
  args: AgentWorkspaceToolArguments["propose_memory"],
  dataDir: string,
): Promise<AgentWorkspaceToolResult["propose_memory"]> {
  if (!args || typeof args.title !== "string" || typeof args.content !== "string" || !Array.isArray(args.sources)) {
    throw new AgentWorkspaceToolError("Memory 提案无效", "invalid_arguments");
  }
  const memory = await createProjectMemory({
    projectId,
    kind: args.kind,
    title: args.title,
    content: args.content,
    reason: args.reason ?? "Agent 根据执行结果提出长期记忆候选",
    createdBy: "agent",
    status: "candidate",
    sources: [
      ...args.sources,
      { kind: "execution", id: executionId, label: `Agent Execution ${executionId}` },
    ],
  }, dataDir);
  return { memoryId: memory.id, status: "candidate" };
}

async function requireWorkspaceBinding(projectId: string, dataDir: string) {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  if (!binding) throw new AgentWorkspaceToolError("Workspace 未绑定", "workspace_unavailable");
  return binding;
}

async function requireReadableRoot(projectId: string, dataDir: string, rootId?: string) {
  const binding = await requireWorkspaceBinding(projectId, dataDir);
  const root = resolveWorkspaceRoot(binding, rootId);
  if (!root || !canUseWorkspaceRootCapability(root, "read")) {
    throw new AgentWorkspaceToolError("Workspace Root 不存在、不可用或未授权读取", "workspace_unavailable");
  }
  return root;
}

async function requireReadableRoots(projectId: string, dataDir: string, rootId?: string) {
  const binding = await requireWorkspaceBinding(projectId, dataDir);
  if (rootId) return [await requireReadableRoot(projectId, dataDir, rootId)];
  const roots = listWorkspaceRoots(binding).filter((root) => canUseWorkspaceRootCapability(root, "read"));
  if (!roots.length) throw new AgentWorkspaceToolError("Workspace 没有可读的根目录", "workspace_unavailable");
  return roots;
}

function normalizeRelativePath(value: string, allowRoot = false) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new AgentWorkspaceToolError("Workspace 相对路径无效", "invalid_arguments");
  }
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (
    (!allowRoot && normalized === ".") ||
    path.posix.isAbsolute(normalized) ||
    (normalized !== "." && normalized.split("/").some((part) => !part || part === "." || part === ".."))
  ) {
    throw new AgentWorkspaceToolError("Workspace 相对路径无效", "invalid_arguments");
  }
  return normalized;
}

function assertNotSensitive(relativePath: string) {
  if (isSensitiveWorkspacePath(relativePath)) {
    throw new AgentWorkspaceToolError("敏感文件默认不提供给 Agent", "sensitive_path");
  }
}

async function readWorkspaceText(projectId: string, relativePath: string, dataDir: string, rootId?: string) {
  assertNotSensitive(relativePath);
  const root = await requireReadableRoot(projectId, dataDir, rootId);
  const filePath = await resolveExistingWorkspacePath(root.realPath, relativePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_WORKSPACE_TEXT_BYTES) {
    throw new AgentWorkspaceToolError("文件不可读或超过 1 MiB", "file_unreadable");
  }
  const content = decodeUtf8(await fs.readFile(filePath));
  if (content === null) throw new AgentWorkspaceToolError("文件不是 UTF-8 文本", "file_unreadable");
  return content;
}

function normalizeGlobPattern(value: string) {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new AgentWorkspaceToolError("Glob 模式无效", "invalid_arguments");
  }
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(normalized) || normalized.split("/").includes("..") || normalized.length > 1_000) {
    throw new AgentWorkspaceToolError("Glob 模式无效", "invalid_arguments");
  }
  return normalized;
}

function globToRegExp(pattern: string) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "i");
}

function toNotebookSource(source: string) {
  const lines = source.split("\n");
  return lines.map((line, index) => index < lines.length - 1 ? `${line}\n` : line).filter((line, index) => line || index < lines.length - 1);
}

function decodeUtf8(buffer: Buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function normalizeLine(value: number | undefined, minimum: number, maximum: number) {
  const line = value ?? minimum;
  if (!Number.isInteger(line) || line < minimum || line > maximum) {
    throw new AgentWorkspaceToolError("文件行号无效", "invalid_arguments");
  }
  return line;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
