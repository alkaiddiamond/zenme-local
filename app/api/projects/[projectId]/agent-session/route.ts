import { NextResponse } from "next/server";

import {
  appendProjectAgentEvent,
  createProjectAgentCompactCheckpoint,
  getEffectiveProjectAgentContext,
  getProjectAgentModelContext,
  getProjectAgentSession,
  ProjectAgentSessionError,
  recordProjectAgentCompactionFailure,
  updateProjectAgentContext,
} from "@/lib/agent/project-session-store";
import type { ProjectAgentEventType } from "@/lib/agent/project-session-types";
import { reconcileProjectAgentBackgroundNotifications } from "@/lib/agent/project-turn-runtime";
import { AgentCommandError, stopAgentBackgroundTask } from "@/lib/agent/command-runtime";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    if (url.searchParams.get("modelContext") === "1") {
      return NextResponse.json(await getProjectAgentModelContext(projectId));
    }
    if (url.searchParams.get("effectiveContext") === "1") {
      return NextResponse.json(await getEffectiveProjectAgentContext(projectId));
    }
    await reconcileProjectAgentBackgroundNotifications(projectId);
    return NextResponse.json(await getProjectAgentSession(projectId));
  } catch (error) {
    return response(error, "项目 Agent Session 加载失败");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "appendEvent") {
      if (!isEventType(body.type) || (body.content !== undefined && typeof body.content !== "string") ||
        (body.data !== undefined && !isObject(body.data))) {
        return NextResponse.json({ error: "Agent 事件参数无效" }, { status: 400 });
      }
      const event = await appendProjectAgentEvent({
        projectId,
        type: body.type,
        turnId: typeof body.turnId === "string" ? body.turnId : undefined,
        content: body.content,
        data: body.data,
      });
      return NextResponse.json(event, { status: 201 });
    }
    if (body.action === "compact") {
      if (typeof body.summary !== "string" || typeof body.compactedThroughSequence !== "number" ||
        typeof body.sourceTokenEstimate !== "number") {
        return NextResponse.json({ error: "上下文压缩参数无效" }, { status: 400 });
      }
      const checkpoint = await createProjectAgentCompactCheckpoint({
        projectId,
        summary: body.summary,
        compactedThroughSequence: body.compactedThroughSequence,
        sourceTokenEstimate: body.sourceTokenEstimate,
        turnId: typeof body.turnId === "string" ? body.turnId : undefined,
      });
      return NextResponse.json(checkpoint, { status: 201 });
    }
    if (body.action === "updateContext") {
      const context = await updateProjectAgentContext({
        projectId,
        modelId: typeof body.modelId === "string" || body.modelId === null ? body.modelId : undefined,
        permissionMode: optionalPermissionMode(body.permissionMode),
        contextWindowTokens: typeof body.contextWindowTokens === "number" || body.contextWindowTokens === null
          ? body.contextWindowTokens
          : undefined,
        inputTokens: typeof body.inputTokens === "number" ? body.inputTokens : undefined,
        outputTokens: typeof body.outputTokens === "number" ? body.outputTokens : undefined,
        estimatedEffectiveTokens: typeof body.estimatedEffectiveTokens === "number"
          ? body.estimatedEffectiveTokens
          : undefined,
      });
      return NextResponse.json(context);
    }
    if (body.action === "compactionFailed") {
      if (typeof body.code !== "string") {
        return NextResponse.json({ error: "上下文压缩失败参数无效" }, { status: 400 });
      }
      return NextResponse.json(await recordProjectAgentCompactionFailure({ projectId, code: body.code }));
    }
    if (body.action === "stopBackgroundTask") {
      if (typeof body.taskId !== "string" || !body.taskId.trim()) {
        return NextResponse.json({ error: "后台任务参数无效" }, { status: 400 });
      }
      return NextResponse.json(await stopAgentBackgroundTask(projectId, body.taskId.trim()));
    }
    return NextResponse.json({ error: "Agent Session 操作无效" }, { status: 400 });
  } catch (error) {
    return response(error, "项目 Agent Session 更新失败");
  }
}

function optionalPermissionMode(value: unknown) {
  return value === "untrusted" || value === "onRequest" || value === "neverAsk" ? value : undefined;
}

function isEventType(value: unknown): value is ProjectAgentEventType {
  return typeof value === "string" && [
    "user", "assistant", "thinking", "toolCall", "toolResult", "approval", "status", "compact", "memory",
  ].includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function response(error: unknown, fallback: string) {
  if (error instanceof AgentCommandError) {
    return NextResponse.json(
      { error: publicAgentCommandError(error.code), code: error.code },
      { status: error.code === "command_not_found" ? 404 : 400 },
    );
  }
  if (error instanceof ProjectAgentSessionError) {
    const status = error.code === "project_not_found" ? 404 : error.code === "capacity_exceeded" ? 409 : 400;
    const messages = {
      invalid_input: "项目 Agent Session 参数无效",
      project_not_found: "项目不存在",
      capacity_exceeded: "项目 Agent Session 已达到容量上限",
    };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function publicAgentCommandError(code: AgentCommandError["code"]) {
  return ({
    approval_required: "后台任务操作需要批准",
    command_not_found: "后台任务不存在",
    execute_not_allowed: "Workspace 未授权执行命令",
    git_write_not_allowed: "Workspace Root 未授权 Git 写操作",
    external_workspace_approval_required: "后台任务需要 Workspace 外目录授权",
    invalid_command: "后台任务命令无效",
    invalid_status: "后台任务不存在或当前不可停止",
    workspace_unavailable: "Workspace 不可用",
  } as const)[code];
}
