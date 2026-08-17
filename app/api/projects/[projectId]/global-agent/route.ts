import { NextResponse } from "next/server";

import {
  createGlobalOrchestration,
  GlobalOrchestrationError,
  listGlobalOrchestrations,
} from "@/lib/global-agent/orchestration-store";
import type { GlobalContextEvidence, GlobalTaskPlanInput } from "@/lib/global-agent/types";
import { GlobalAgentPlanningError, planGlobalAgentTasks } from "@/lib/global-agent/planning-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    return NextResponse.json({ orchestrations: await listGlobalOrchestrations(projectId) });
  } catch (error) {
    return response(error, "Global Agent 调度加载失败");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "plan") {
      if (typeof body.goal !== "string" || typeof body.model !== "string") {
        return NextResponse.json({ error: "Global Agent 计划参数无效" }, { status: 400 });
      }
      return NextResponse.json({ tasks: await planGlobalAgentTasks({
        projectId,
        goal: body.goal,
        model: body.model,
        canvasContext: optionalString(body.canvasContext),
        signal: request.signal,
      }) });
    }
    if (typeof body.goal !== "string" || typeof body.resultNodeId !== "string" || typeof body.triggerNodeId !== "string" || !Array.isArray(body.tasks)) {
      return NextResponse.json({ error: "Global Agent 计划参数无效" }, { status: 400 });
    }
    return NextResponse.json(await createGlobalOrchestration({
      projectId,
      goal: body.goal,
      resultNodeId: body.resultNodeId,
      triggerNodeId: body.triggerNodeId,
      concurrencyLimit: numberValue(body.concurrencyLimit),
      maxSubagents: numberValue(body.maxSubagents),
      canvasContext: optionalString(body.canvasContext),
      selectedNodeIds: stringArray(body.selectedNodeIds),
      fileDocumentIds: stringArray(body.fileDocumentIds),
      contextEvidence: body.contextEvidence as GlobalContextEvidence[] | undefined,
      tasks: body.tasks as GlobalTaskPlanInput[],
    }), { status: 201 });
  } catch (error) {
    return response(error, "Global Agent 计划创建失败");
  }
}

function response(error: unknown, fallback: string) {
  if (error instanceof GlobalAgentPlanningError) {
    return NextResponse.json({
      error: error.code === "invalid_input" ? "Global Agent 计划参数无效" : "Global Agent 返回的任务计划无效",
      code: error.code,
    }, { status: 400 });
  }
  if (error instanceof GlobalOrchestrationError) {
    const status = error.code === "not_found" ? 404 : error.code === "workspace_unavailable" ? 409 : 400;
    const messages = { invalid_input: "Global Agent 计划参数无效", not_found: "Global Agent 调度不存在", invalid_status: "Global Agent 当前状态不允许此操作", workspace_unavailable: "Workspace 未绑定或未授权读取" };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function optionalString(value: unknown) { return typeof value === "string" ? value : undefined; }
function numberValue(value: unknown) { return typeof value === "number" ? value : undefined; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined; }
