import { NextResponse } from "next/server";

import {
  AgentExecutionError,
  createAgentExecution,
  listAgentExecutions,
} from "@/lib/agent/execution-store";
import { AGENT_TOOL_NAMES } from "@/lib/agent/tool-registry";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    return NextResponse.json({ executions: await listAgentExecutions(projectId) });
  } catch (error) {
    return agentErrorResponse(error, "Agent Execution 加载失败");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.instruction !== "string" || typeof body.resultNodeId !== "string" || typeof body.triggerNodeId !== "string") {
      return NextResponse.json({ error: "Agent 任务参数无效" }, { status: 400 });
    }
    const created = await createAgentExecution({
      projectId,
      instruction: body.instruction,
      resultNodeId: body.resultNodeId,
      triggerNodeId: body.triggerNodeId,
      agentId: optionalString(body.agentId),
      allowedPathPrefixes: stringArray(body.allowedPathPrefixes),
      allowedTools: toolArray(body.allowedTools),
      canvasContext: optionalString(body.canvasContext),
      selectedNodeIds: stringArray(body.selectedNodeIds),
      orchestrationId: optionalString(body.orchestrationId),
      subtaskId: optionalString(body.subtaskId),
      workspaceRootId: optionalString(body.workspaceRootId),
      fileDocumentIds: stringArray(body.fileDocumentIds),
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return agentErrorResponse(error, "Agent Execution 创建失败");
  }
}

function agentErrorResponse(error: unknown, fallback: string) {
  if (error instanceof AgentExecutionError) {
    const status = error.code === "execution_not_found" ? 404 : error.code === "workspace_unavailable" ? 409 : 400;
    return NextResponse.json({ error: publicAgentError(error.code), code: error.code }, { status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function publicAgentError(code: string) {
  if (code === "execution_not_found") return "Agent Execution 不存在";
  if (code === "workspace_unavailable") return "Workspace 未绑定或未授权读取";
  if (code === "invalid_status") return "Agent Execution 当前状态不允许此操作";
  return "Agent 任务参数无效";
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;
}

function toolArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is import("@/lib/agent/types").AgentWorkspaceToolName =>
        typeof entry === "string" && AGENT_TOOL_NAMES.includes(entry as import("@/lib/agent/types").AgentWorkspaceToolName))
    : undefined;
}
