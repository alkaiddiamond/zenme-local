import { NextResponse } from "next/server";

import {
  AgentCommandError,
  approveAgentCommand,
  rejectAgentCommand,
  stopRunningAgentCommands,
} from "@/lib/agent/command-runtime";
import {
  AgentExecutionError,
  getAgentExecution,
  stopAgentExecution,
} from "@/lib/agent/execution-store";
import { updateProjectAgentEvent } from "@/lib/agent/project-session-store";
import { formatCommandProgress } from "@/lib/agent/project-turn-runtime";
import type { AgentWorkspaceToolName } from "@/lib/agent/types";
import {
  AGENT_WORKSPACE_TOOL_NAMES,
  AgentWorkspaceToolError,
  executeAgentWorkspaceTool,
} from "@/lib/agent/workspace-tools";
import { AgentWebSearchError } from "@/lib/agent/web-search";
import { stopDelegatedSubagentRun } from "@/lib/global-agent/delegated-runtime";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ executionId: string; projectId: string }> },
) {
  try {
    const { executionId, projectId } = await params;
    const execution = await getAgentExecution(projectId, executionId);
    if (!execution) return NextResponse.json({ error: "Agent Execution 不存在" }, { status: 404 });
    return NextResponse.json(execution);
  } catch (error) {
    return agentErrorResponse(error, "Agent Execution 加载失败");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ executionId: string; projectId: string }> },
) {
  const { executionId, projectId } = await params;
  try {
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "tool":
        if (!isToolName(body.name) || !isObject(body.arguments)) return invalidAction();
        return NextResponse.json(await executeAgentWorkspaceTool({
          projectId,
          executionId,
          name: body.name,
          arguments: body.arguments as never,
          signal: request.signal,
          ...(body.name === "run_approved_command" && typeof body.progressEventId === "string"
            ? {
                onCommandProgress: async (progress) => {
                  await updateProjectAgentEvent({
                    projectId,
                    eventId: body.progressEventId as string,
                    content: formatCommandProgress(progress.stdout, progress.stderr),
                    data: {
                      progress: true,
                      elapsedMs: progress.elapsedMs,
                      outputFilePath: progress.outputFilePath,
                      stdoutTail: tailText(progress.stdout, 4_000),
                      stderrTail: tailText(progress.stderr, 4_000),
                    },
                  });
                },
              }
            : {}),
        }));
      case "approveCommand":
        if (typeof body.commandId !== "string" || (body.scope !== undefined && body.scope !== "once" && body.scope !== "project")) return invalidAction();
        return NextResponse.json(await approveAgentCommand(projectId, executionId, body.commandId, undefined, body.scope ?? "once"));
      case "rejectCommand":
        if (typeof body.commandId !== "string") return invalidAction();
        return NextResponse.json(await rejectAgentCommand(projectId, executionId, body.commandId));
      case "stop":
        stopDelegatedSubagentRun(projectId, executionId);
        await stopRunningAgentCommands(projectId, executionId);
        return NextResponse.json(await stopAgentExecution(projectId, executionId));
      default:
        return invalidAction();
    }
  } catch (error) {
    return agentErrorResponse(error, "Agent Execution 操作失败");
  }
}

function invalidAction() {
  return NextResponse.json({ error: "Agent Execution 操作参数无效" }, { status: 400 });
}

function agentErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AgentExecutionError || error instanceof AgentCommandError || error instanceof AgentWorkspaceToolError || error instanceof AgentWebSearchError) {
    const status = "code" in error && (error.code === "execution_not_found" || error.code === "command_not_found") ? 404 : 400;
    return NextResponse.json({ error: publicAgentError(error.code), code: error.code }, { status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function publicAgentError(code: string) {
  const messages: Record<string, string> = {
    approval_required: "命令需要用户批准且只能执行一次",
    command_not_found: "命令请求不存在",
    execute_not_allowed: "Workspace 未授权运行命令",
    git_write_not_allowed: "Workspace Root 未授权 Git 写操作",
    external_workspace_approval_required: "命令需要 Workspace 外目录授权",
    execution_not_found: "Agent Execution 不存在",
    file_unreadable: "文件不可读、不是 UTF-8 文本或超过大小限制",
    git_unavailable: "Workspace 不是 Git 仓库",
    invalid_arguments: "Agent 工具参数无效",
    invalid_command: "命令不符合允许规则",
    invalid_input: "Agent Execution 操作参数无效",
    invalid_status: "Agent Execution 当前状态不允许此操作",
    sensitive_path: "敏感文件不能提供给 Agent",
    workspace_unavailable: "Workspace 未绑定或未授权读取",
    web_search_unavailable: "当前服务商没有配置可用的网页搜索工具",
    web_search_failed: "网页搜索失败",
  };
  return messages[code] ?? "Agent Execution 操作失败";
}

function isToolName(value: unknown): value is AgentWorkspaceToolName {
  return typeof value === "string" && AGENT_WORKSPACE_TOOL_NAMES.includes(value as AgentWorkspaceToolName);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tailText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : value.slice(-maxLength);
}
