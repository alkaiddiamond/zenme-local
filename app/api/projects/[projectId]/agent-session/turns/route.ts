import { NextResponse } from "next/server";

import { answerProjectAgentTurnRun, isProjectAgentTurnRunActive, ProjectAgentTurnError, startProjectAgentTurnRun, steerProjectAgentTurnRun, stopProjectAgentTurnRun } from "@/lib/agent/project-turn-runtime";
import { reconcileAgentExecutionsForTurn } from "@/lib/agent/execution-store";
import { appendProjectAgentEvent, getProjectAgentSession } from "@/lib/agent/project-session-store";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import { parseAgentContextSnapshot } from "@/lib/agent/context-model";
import type { ZenmeModelSpeed, ZenmeReasoningEffort, ZenmeSessionPermissionMode } from "@/lib/local/settings";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    const activeAnswer = optionalQuestionAnswer(body.questionAnswer);
    if (body.resume === true && typeof body.turnId === "string" && activeAnswer) {
      const answered = await answerProjectAgentTurnRun({
        projectId,
        turnId: body.turnId,
        ...activeAnswer,
      });
      if (answered) return NextResponse.json({ turnId: body.turnId, status: "running" }, { status: 202 });
    }
    if (body.steer === true) {
      if (typeof body.prompt !== "string" || typeof body.turnId !== "string") {
        return NextResponse.json({ error: "项目 Agent 补充指令无效" }, { status: 400 });
      }
      const result = await steerProjectAgentTurnRun({ projectId, prompt: body.prompt, turnId: body.turnId });
      return NextResponse.json({ ...result, status: "steered" }, { status: 202 });
    }
    if (typeof body.prompt !== "string" || typeof body.model !== "string") {
      return NextResponse.json({ error: "项目 Agent Turn 参数无效" }, { status: 400 });
    }
    const result = await startProjectAgentTurnRun({
      projectId,
      prompt: body.prompt,
      model: body.model,
      contextSnapshot: parseAgentContextSnapshot(body.contextSnapshot),
      canvasContext: optionalString(body.canvasContext),
      currentNodeContext: optionalString(body.currentNodeContext),
      connectedGraphContext: optionalString(body.connectedGraphContext),
      conversationId: optionalString(body.conversationId),
      parentConversationIds: stringArray(body.parentConversationIds),
      parentTurnId: optionalString(body.parentTurnId),
      resultNodeId: optionalString(body.resultNodeId),
      selectedNodeIds: stringArray(body.selectedNodeIds),
      sourceNodeId: optionalString(body.sourceNodeId),
      fileDocumentIds: stringArray(body.fileDocumentIds),
      imageDataUrls: stringArray(body.imageDataUrls),
      turnId: optionalString(body.turnId),
      reasoningEffort: optionalReasoningEffort(body.reasoningEffort),
      modelSpeed: optionalModelSpeed(body.modelSpeed),
      permissionMode: optionalPermissionMode(body.permissionMode),
      resume: body.resume === true,
      questionAnswer: optionalQuestionAnswer(body.questionAnswer),
    });
    return NextResponse.json({ turnId: result.turnId, status: "running" }, { status: result.started ? 202 : 200 });
  } catch (error) {
    if (error instanceof ProjectAgentTurnError) {
      const status = error.code === "busy" ? 409 : error.code === "invalid_input" ? 400 : 500;
      const messages = {
        invalid_input: "项目 Agent Turn 参数无效",
        busy: "项目 Agent 正在处理上一条消息",
        model_failed: "项目 Agent 模型调用失败",
        tool_failed: "项目 Agent 工具执行失败",
      };
      return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
    }
    return NextResponse.json({ error: "项目 Agent Turn 执行失败" }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const turnId = new URL(request.url).searchParams.get("turnId")?.trim() ?? "";
    if (!turnId) return NextResponse.json({ error: "项目 Agent Turn 参数无效" }, { status: 400 });
    const session = await getProjectAgentSession(projectId);
    const events = session.events.filter((event) => event.turnId === turnId);
    if (!events.length) return NextResponse.json({ error: "项目 Agent Turn 不存在" }, { status: 404 });
    const state = projectTurnState(turnId, events);
    if (isProjectAgentTurnRunActive(projectId, turnId)) {
      // A resumed server-owned job is newer than the durable waiting marker it
      // is consuming. Returning that stale marker makes the canvas reopen the
      // already-answered prompt while the same Turn is actively progressing.
      return NextResponse.json({ turnId, status: "running" });
    }
    if (state.status === "running") {
      const error = "本地服务已重启，当前 Project Agent Turn 无法续接；请重试。";
      await appendProjectAgentEvent({ projectId, turnId, type: "status", data: { stage: "failed", error } });
      await reconcileAgentExecutionsForTurn({ projectId, turnId, status: "failed", error, summary: error });
      return NextResponse.json({ turnId, status: "failed", error });
    }
    if (state.status === "completed") {
      await reconcileAgentExecutionsForTurn({ projectId, turnId, status: "succeeded", summary: state.answer });
    } else if (state.status === "failed") {
      await reconcileAgentExecutionsForTurn({ projectId, turnId, status: "failed", error: state.error, summary: state.error });
    } else if (state.status === "stopped") {
      await reconcileAgentExecutionsForTurn({ projectId, turnId, status: "stopped" });
    }
    return NextResponse.json(state);
  } catch {
    return NextResponse.json({ error: "项目 Agent Turn 状态加载失败" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const turnId = new URL(request.url).searchParams.get("turnId")?.trim() ?? "";
  if (!turnId) return NextResponse.json({ error: "项目 Agent Turn 参数无效" }, { status: 400 });
  return NextResponse.json({ stopped: stopProjectAgentTurnRun(projectId, turnId), turnId });
}

function projectTurnState(turnId: string, events: ProjectAgentEvent[]) {
  const statusEvent = events.findLast((event) => event.type === "status");
  const stage = typeof statusEvent?.data?.stage === "string" ? statusEvent.data.stage : "thinking";
  if (stage === "completed") {
    return { turnId, status: "completed", answer: events.findLast((event) => event.type === "assistant")?.content ?? "" };
  }
  if (stage === "waitingApproval") {
    const approval = events.findLast((event) => event.type === "approval" && event.data?.status === "pending");
    return {
      turnId,
      status: "waitingApproval",
      commandRequestId: optionalString(approval?.data?.commandRequestId),
      executionId: optionalString(approval?.data?.executionId),
    };
  }
  if (stage === "waitingInput") {
    const result = events.findLast((event) => event.type === "toolResult" &&
      ["ask_user_question", "exit_plan_mode"].includes(String(event.data?.name)) && event.data?.status === "waitingInput");
    const output = isObject(result?.data?.output) ? result.data.output : {};
    return {
      turnId,
      status: "waitingInput",
      eventId: result?.id,
      question: optionalString(output.question) ?? result?.content ?? "",
      options: Array.isArray(output.options) ? output.options : [],
      questions: Array.isArray(output.questions) ? output.questions : undefined,
      ...(isObject(output.mcpElicitation) ? { mcpElicitation: output.mcpElicitation } : {}),
    };
  }
  if (stage === "failed" || stage === "stopped") {
    return { turnId, status: stage, error: optionalString(statusEvent?.data?.error) };
  }
  return { turnId, status: "running" };
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function optionalReasoningEffort(value: unknown): ZenmeReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : undefined;
}

function optionalModelSpeed(value: unknown): ZenmeModelSpeed | undefined {
  return value === "standard" || value === "fast" ? value : undefined;
}

function optionalPermissionMode(value: unknown): ZenmeSessionPermissionMode | undefined {
  return value === "untrusted" || value === "onRequest" || value === "neverAsk" ? value : undefined;
}

function optionalQuestionAnswer(value: unknown) {
  if (!isObject(value) || typeof value.eventId !== "string") return undefined;
  const answers = isObject(value.answers) && Object.values(value.answers).every((item) => typeof item === "string")
    ? value.answers as Record<string, string>
    : undefined;
  const annotations = isObject(value.annotations) && Object.values(value.annotations).every((item) =>
    isObject(item) && (item.notes === undefined || typeof item.notes === "string") &&
    (item.preview === undefined || typeof item.preview === "string"))
    ? value.annotations as Record<string, { notes?: string; preview?: string }>
    : undefined;
  if (typeof value.value !== "string" && !answers) return undefined;
  return { eventId: value.eventId, ...(typeof value.value === "string" ? { value: value.value } : {}), ...(answers ? { answers } : {}), ...(annotations ? { annotations } : {}) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
