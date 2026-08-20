import { NextResponse } from "next/server";

import {
  ContinuousGlobalAgentRuntimeError,
  getContinuousGlobalAgentRuntimeInstanceId,
  runContinuousGlobalAgentOnce,
} from "@/lib/global-agent/continuous-runtime";
import {
  appendContinuousProjectEvent,
  configureContinuousGlobalAgent,
  ContinuousGlobalAgentError,
  reconcileContinuousAgentRuntime,
  updateContinuousAgentSuggestion,
} from "@/lib/global-agent/continuous-store";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    return NextResponse.json(await reconcileContinuousAgentRuntime(
      projectId,
      getContinuousGlobalAgentRuntimeInstanceId(),
    ));
  } catch (error) {
    return response(error, "Continuous Agent 加载失败");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "configure") {
      const mode = optionalMode(body.mode);
      const modelId = typeof body.modelId === "string" || body.modelId === null ? body.modelId : undefined;
      const budget = isRecord(body.budget) ? numericBudget(body.budget) : undefined;
      if (body.mode !== undefined && !mode) return NextResponse.json({ error: "Continuous Agent 模式无效" }, { status: 400 });
      return NextResponse.json(await configureContinuousGlobalAgent({ projectId, mode, modelId, budget }));
    }
    if (body.action === "suggestion" && typeof body.suggestionId === "string" && isSuggestionStatus(body.status)) {
      return NextResponse.json(await updateContinuousAgentSuggestion({ projectId, suggestionId: body.suggestionId, status: body.status }));
    }
    return NextResponse.json({ error: "Continuous Agent 操作无效" }, { status: 400 });
  } catch (error) {
    return response(error, "Continuous Agent 更新失败");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "runOnce") {
      return NextResponse.json(await runContinuousGlobalAgentOnce({ projectId, signal: request.signal }));
    }
    if (body.action === "request") {
      const requestId = typeof body.requestId === "string" && body.requestId.trim() ? body.requestId.trim() : crypto.randomUUID();
      const event = await appendContinuousProjectEvent({
        projectId,
        type: "manual.requested",
        source: "user",
        sourceId: requestId,
        idempotencyKey: `manual:${requestId}`,
        data: typeof body.instruction === "string" ? { instruction: body.instruction.slice(0, 20_000) } : undefined,
      });
      return NextResponse.json(event, { status: 201 });
    }
    return NextResponse.json({ error: "Continuous Agent 操作无效" }, { status: 400 });
  } catch (error) {
    return response(error, "Continuous Agent 运行失败");
  }
}

function response(error: unknown, fallback: string) {
  if (error instanceof ContinuousGlobalAgentError) {
    const status = error.code === "project_not_found" ? 404 : error.code === "invalid_status" || error.code === "budget_exhausted" ? 409 : 400;
    const messages = {
      project_not_found: "项目不存在",
      invalid_input: "Continuous Agent 参数无效",
      invalid_status: "Continuous Agent 当前状态不允许此操作",
      budget_exhausted: "Continuous Agent 已达到运行预算",
    };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
  }
  if (error instanceof ContinuousGlobalAgentRuntimeError) {
    return NextResponse.json({
      error: error.code === "model_unavailable" ? "Continuous Agent 尚未配置可用模型" : "Continuous Agent 返回结果无效",
      code: error.code,
    }, { status: error.code === "model_unavailable" ? 409 : 502 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function optionalMode(value: unknown) { return value === "disabled" || value === "paused" || value === "enabled" ? value : undefined; }
function isSuggestionStatus(value: unknown): value is "candidate" | "accepted" | "rejected" | "dismissed" { return value === "candidate" || value === "accepted" || value === "rejected" || value === "dismissed"; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function numericBudget(value: Record<string, unknown>) {
  return {
    ...(typeof value.maxRunsPerHour === "number" ? { maxRunsPerHour: value.maxRunsPerHour } : {}),
    ...(typeof value.maxEventsPerRun === "number" ? { maxEventsPerRun: value.maxEventsPerRun } : {}),
    ...(typeof value.maxTokensPerHour === "number" ? { maxTokensPerHour: value.maxTokensPerHour } : {}),
    ...(typeof value.cooldownMs === "number" ? { cooldownMs: value.cooldownMs } : {}),
  };
}
