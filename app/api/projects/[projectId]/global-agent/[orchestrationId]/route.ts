import { NextResponse } from "next/server";

import {
  getGlobalOrchestration,
  GlobalOrchestrationError,
  stopGlobalOrchestration,
} from "@/lib/global-agent/orchestration-store";
import { stopDelegatedOrchestrationRun } from "@/lib/global-agent/delegated-runtime";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; orchestrationId: string }> }) {
  try {
    const { projectId, orchestrationId } = await params;
    const value = await getGlobalOrchestration(projectId, orchestrationId);
    return value ? NextResponse.json(value) : NextResponse.json({ error: "Global Agent 调度不存在" }, { status: 404 });
  } catch (error) { return response(error, "Global Agent 调度加载失败"); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; orchestrationId: string }> }) {
  const { projectId, orchestrationId } = await params;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "stop") {
      stopDelegatedOrchestrationRun(projectId, orchestrationId);
      return NextResponse.json(await stopGlobalOrchestration(projectId, orchestrationId));
    }
    return NextResponse.json({ error: "Global Agent 操作参数无效" }, { status: 400 });
  } catch (error) { return response(error, "Global Agent 操作失败"); }
}

function response(error: unknown, fallback: string) {
  if (error instanceof GlobalOrchestrationError) {
    const messages = { invalid_input: "Global Agent 操作参数无效", not_found: "Global Agent 调度不存在", invalid_status: "Global Agent 当前状态不允许此操作", workspace_unavailable: "Workspace 未绑定或未授权读取" };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status: error.code === "not_found" ? 404 : 400 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
