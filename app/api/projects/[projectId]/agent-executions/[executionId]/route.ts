import { NextResponse } from "next/server";

import {
  AgentCommandError,
  stopRunningAgentCommands,
} from "@/lib/agent/command-runtime";
import {
  AgentExecutionError,
  getAgentExecution,
  stopAgentExecution,
} from "@/lib/agent/execution-store";
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
  if (error instanceof AgentExecutionError || error instanceof AgentCommandError) {
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
    invalid_input: "Agent Execution 操作参数无效",
    invalid_status: "Agent Execution 当前状态不允许此操作",
  };
  return messages[code] ?? "Agent Execution 操作失败";
}
