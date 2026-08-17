"use client";

import { useState, type FormEventHandler, type KeyboardEventHandler, type ReactNode } from "react";
import { AlertCircle, Box, Check, ExternalLink, Loader2, Send, Terminal, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ZenmeCopyButton,
  ZenmeModelPicker,
} from "@/components/zenme/visual-components";
import type { AgentMessage } from "@/components/zenme/agent-types";
import type { AiModelOption } from "@/components/zenme/use-ai-model-options";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import { normalizeAgentDisplayText } from "@/components/zenme/agent-display-text";
import { getActiveAgentToolLabel, getAgentToolLabel } from "@/components/zenme/agent-tool-labels";
import {
  projectTurnCompletedStepCount,
  projectTurnEventsForDisplay,
} from "@/components/zenme/nodes/agent-turn-timeline";
import { McpElicitationForm, projectMcpElicitationFromEvent } from "@/components/zenme/mcp-elicitation-form";
import { AgentQuestionForm, agentQuestionsFromOutput, type AgentQuestionSubmission } from "@/components/zenme/agent-question-form";

export function AgentPanelShell({ children }: { children: ReactNode }) {
  return (
    <aside
      className="zenme-shadow-overlay absolute inset-y-0 right-0 z-20 flex w-[420px] flex-col rounded-l-xl border-l border-zinc-200 bg-white text-zinc-950"
      data-thumbnail-hidden="true"
    >
      {children}
    </aside>
  );
}

export function AgentPanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="flex h-14 items-center justify-end px-5">
      <button
        className="flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
        onClick={onClose}
        type="button"
      >
        <X className="size-5" />
      </button>
    </header>
  );
}

export function AgentWelcomeState({ context }: { context?: string }) {
  return (
    <div className="flex h-full flex-col justify-end pb-8">
      <p className="mb-2 flex items-center gap-2 text-sm text-zinc-500">
        <Box className="size-5 text-zinc-600" />
        Hi alkaiddiamond!
      </p>
      <h2 className="text-base font-normal tracking-normal text-zinc-950">
        今天一起创作点什么？
      </h2>
      {context ? (
        <p className="mt-4 rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-500">
          已带入节点上下文：{context}
        </p>
      ) : null}
    </div>
  );
}

export function AgentMessageList({
  messages,
  onCopyMessage,
}: {
  messages: AgentMessage[];
  onCopyMessage: (content: string) => void;
}) {
  return (
    <div className="space-y-4">
      {messages.map((message, index) => (
        <div className="group" key={`${message.role}-${index}`}>
          <div
            className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-6 ${
              message.role === "user"
                ? "ml-10 bg-zinc-100 text-zinc-950"
                : "mr-8 bg-zinc-100 text-zinc-950"
            }`}
          >
            {normalizeAgentDisplayText(message.content)}
          </div>
          <div
            className={`mt-1 flex ${
              message.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <ZenmeCopyButton onClick={() => onCopyMessage(normalizeAgentDisplayText(message.content))} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentEventWaterfall({
  busyCommandId,
  busyQuestionId,
  events,
  onAnswerQuestion,
  messages,
  onApproveCommand,
  onRejectCommand,
  onCopyMessage,
}: {
  busyCommandId?: string;
  busyQuestionId?: string;
  events: ProjectAgentEvent[];
  messages: AgentMessage[];
  onAnswerQuestion?: (event: ProjectAgentEvent, answer: string | AgentQuestionSubmission) => void;
  onApproveCommand: (event: ProjectAgentEvent) => void;
  onRejectCommand?: (event: ProjectAgentEvent) => void;
  onCopyMessage: (content: string) => void;
}) {
  const turns = new Map<string, ProjectAgentEvent[]>();
  for (const event of events) {
    const turnEvents = turns.get(event.turnId) ?? [];
    turnEvents.push(event);
    turns.set(event.turnId, turnEvents);
  }
  const persistedMessageCount = events.filter((event) =>
    (event.type === "user" || event.type === "assistant") && Boolean(event.content),
  ).length;
  return (
    <div>
      {[...turns.entries()].map(([turnId, turnEvents]) => {
        const userMessages = turnEvents.flatMap((event): AgentMessage[] =>
          event.type === "user" && event.content ? [{ role: "user", content: event.content }] : [],
        );
        const assistantMessages = turnEvents.flatMap((event): AgentMessage[] =>
          event.type === "assistant" && event.content ? [{ role: "assistant", content: event.content }] : [],
        ).slice(-1);
        return (
          <div className="mb-5" key={turnId}>
            <AgentMessageList messages={userMessages} onCopyMessage={onCopyMessage} />
            <AgentActivityList busyCommandId={busyCommandId} busyQuestionId={busyQuestionId} events={turnEvents} onAnswerQuestion={onAnswerQuestion} onApproveCommand={onApproveCommand} onRejectCommand={onRejectCommand} />
            <AgentMessageList messages={assistantMessages} onCopyMessage={onCopyMessage} />
          </div>
        );
      })}
      {messages.length > persistedMessageCount ? <AgentMessageList messages={messages.slice(persistedMessageCount)} onCopyMessage={onCopyMessage} /> : null}
    </div>
  );
}

export function AgentActivityList({
  busyCommandId,
  busyQuestionId,
  events,
  onAnswerQuestion,
  onApproveCommand,
  onRejectCommand,
}: {
  busyCommandId?: string;
  busyQuestionId?: string;
  events: ProjectAgentEvent[];
  onAnswerQuestion?: (event: ProjectAgentEvent, answer: string | AgentQuestionSubmission) => void;
  onApproveCommand: (event: ProjectAgentEvent) => void;
  onRejectCommand?: (event: ProjectAgentEvent) => void;
}) {
  const activityEvents = events.filter((event) =>
    event.type === "thinking" || event.type === "toolCall" || event.type === "toolResult" ||
    event.type === "approval" || event.type === "status" || event.type === "compact" || event.type === "memory" || event.type === "todo",
  );
  const resolvedCommandIds = new Set(events.flatMap((event) =>
    event.type === "approval" && event.data?.status !== "pending" && typeof event.data?.commandRequestId === "string"
      ? [event.data.commandRequestId]
      : [],
  ));
  const activeEvents = projectTurnEventsForDisplay(events);
  const completedStepCount = projectTurnCompletedStepCount(events);
  if (!activityEvents.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {completedStepCount > 0 && activeEvents.length ? <p className="text-xs text-zinc-400">已完成 {completedStepCount} 个步骤</p> : null}
      {activeEvents.map((event) => <AgentActivityEventCard busyCommandId={busyCommandId} busyQuestionId={busyQuestionId} event={event} key={event.id} onAnswerQuestion={onAnswerQuestion} onApproveCommand={onApproveCommand} onRejectCommand={onRejectCommand} resolvedCommandIds={resolvedCommandIds} />)}
      <details className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs">
        <summary className="cursor-pointer text-zinc-500">执行记录 ({activityEvents.length})</summary>
        <div className="mt-2 space-y-2">
          {activityEvents.map((event) => <AgentActivityEventCard busyCommandId={busyCommandId} busyQuestionId={busyQuestionId} event={event} key={event.id} onAnswerQuestion={onAnswerQuestion} onApproveCommand={onApproveCommand} onRejectCommand={onRejectCommand} resolvedCommandIds={resolvedCommandIds} />)}
        </div>
      </details>
    </div>
  );
}

function AgentActivityEventCard({
  busyCommandId,
  busyQuestionId,
  event,
  onAnswerQuestion,
  onApproveCommand,
  onRejectCommand,
  resolvedCommandIds,
}: {
  busyCommandId?: string;
  busyQuestionId?: string;
  event: ProjectAgentEvent;
  onAnswerQuestion?: (event: ProjectAgentEvent, answer: string | AgentQuestionSubmission) => void;
  onApproveCommand: (event: ProjectAgentEvent) => void;
  onRejectCommand?: (event: ProjectAgentEvent) => void;
  resolvedCommandIds: ReadonlySet<string>;
}) {
  const [answer, setAnswer] = useState("");
  const commandId = typeof event.data?.commandRequestId === "string" ? event.data.commandRequestId : undefined;
  const pending = event.type === "approval" && event.data?.status === "pending" && commandId && !resolvedCommandIds.has(commandId);
  const question = event.type === "toolResult" && event.data?.name === "ask_user_question";
  const mcpElicitation = question ? projectMcpElicitationFromEvent(event) : null;
  const questions = question ? agentQuestionsFromOutput(event.data?.output) : [];
  const name = activityLabel(event);
  const todoItems = event.type === "todo" && Array.isArray(event.data?.items)
    ? event.data.items.flatMap((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && typeof (item as { content?: unknown }).content === "string"
      ? [{ id: (item as { id: string }).id, content: (item as { content: string }).content, status: String((item as { status?: unknown }).status) }]
      : [])
    : [];
  return (
    <div className={`rounded-lg border p-3 text-xs ${pending ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-white"}`}>
      <div className="flex items-center gap-2 font-medium">
        {event.type === "approval" ? <Terminal className="size-3.5" /> : event.type === "toolCall" ? <Loader2 className="size-3.5 animate-spin" /> : <Wrench className="size-3.5" />}
        <span>{name}</span>
        <span className="ml-auto text-zinc-500">{activityStatus(event)}</span>
      </div>
      {event.type === "approval" ? <code className="mt-2 block break-all rounded bg-white/70 px-2 py-1.5">{String(event.data?.executable ?? "")} {Array.isArray(event.data?.args) ? event.data.args.join(" ") : ""}</code> : null}
      {event.type === "approval" ? <p className="mt-2 text-zinc-500">权限边界：{event.data?.sandboxMode === "workspace-write" ? "Workspace 范围" : "单次完全访问"}</p> : null}
      {event.content ? <p className="mt-2 whitespace-pre-wrap text-zinc-600">{normalizeAgentDisplayText(event.content)}</p> : null}
      {todoItems.length ? <div className="mt-2 space-y-1.5">{todoItems.map((item) => <div className="flex items-start gap-2 text-zinc-500" key={item.id}>{item.status === "completed" ? <Check className="mt-0.5 size-3.5 shrink-0" /> : item.status === "in_progress" ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <span className="mt-1 size-2 shrink-0 rounded-full border border-zinc-400" />}<span className={item.status === "completed" ? "line-through text-zinc-400" : ""}>{item.content}</span></div>)}</div> : null}
      {question && onAnswerQuestion ? <div className="mt-3 space-y-2">{mcpElicitation?.mode === "url" && mcpElicitation.url ? <a className="flex w-fit items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-medium" href={mcpElicitation.url} onClick={() => onAnswerQuestion(event, "已完成")} rel="noreferrer" target="_blank"><ExternalLink className="size-3.5" />打开 MCP 授权页面</a> : null}{mcpElicitation?.mode === "form" ? <McpElicitationForm disabled={Boolean(busyQuestionId)} onChange={setAnswer} schema={mcpElicitation.requestedSchema} /> : null}{!mcpElicitation ? <AgentQuestionForm disabled={Boolean(busyQuestionId)} onSubmit={(submission) => onAnswerQuestion(event, submission)} questions={questions} /> : null}<div className="flex gap-2">{mcpElicitation?.mode === "form" ? <Button className="h-8 bg-zinc-950 px-3 text-white hover:bg-zinc-800" disabled={!answer.trim() || Boolean(busyQuestionId)} onClick={() => onAnswerQuestion(event, answer.trim())} type="button">{busyQuestionId === event.id ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}提交回答并继续</Button> : null}{mcpElicitation ? <Button className="h-8 border border-zinc-300 bg-white px-3 text-zinc-700" disabled={Boolean(busyQuestionId)} onClick={() => onAnswerQuestion(event, "取消")} type="button">取消</Button> : null}</div></div> : question && questions.length ? <div className="mt-3 flex flex-wrap gap-2">{questions.flatMap((item) => item.options).map((option) => <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-zinc-700" key={option.label}>{option.label}</span>)}</div> : null}
      {pending ? <div className="mt-3 flex gap-2"><Button className="h-8 bg-zinc-950 px-3 text-white hover:bg-zinc-800" disabled={busyCommandId === commandId} onClick={() => onApproveCommand(event)} type="button">{busyCommandId === commandId ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}批准并运行一次</Button>{onRejectCommand ? <Button className="h-8 border border-zinc-300 bg-white px-3 text-zinc-700 hover:bg-zinc-50" disabled={busyCommandId === commandId} onClick={() => onRejectCommand(event)} type="button">拒绝</Button> : null}</div> : null}
    </div>
  );
}

function activityLabel(event: ProjectAgentEvent) {
  if (event.type === "approval") return "等待命令批准";
  if (event.type === "thinking") return "思考过程";
  if (event.type === "compact") return "上下文已压缩";
  if (event.type === "memory") return "Project Memory";
  if (event.type === "todo") return "任务计划";
  if (event.type === "status") return ({
    planning: "正在规划",
    thinking: "正在思考",
    mcpDiscovery: "正在发现 MCP 工具",
    compacting: "正在压缩上下文",
    backgroundFollowUp: "正在处理后台任务结果",
    steering: "已收到补充指令",
    waitingApproval: "等待命令批准",
    waitingInput: "等待用户回答",
    completed: "运行完成",
    failed: "运行失败",
    stopped: "已停止",
  } as Record<string, string>)[String(event.data?.stage ?? "")] ?? "Agent 状态";
  const toolName = String(event.data?.name ?? "");
  return event.type === "toolCall" ? getActiveAgentToolLabel(toolName) : getAgentToolLabel(toolName);
}

function activityStatus(event: ProjectAgentEvent) {
  if (event.type === "thinking" || (event.type === "status" && !["completed", "failed", "stopped", "waitingInput"].includes(String(event.data?.stage)))) return "运行中";
  if (event.type === "toolCall") return "运行中";
  if (event.type === "toolResult") return event.data?.status === "failed" ? "失败" : "完成";
  if (event.type === "compact") return "完成";
  if (event.type === "memory") return event.data?.status === "running" ? "运行中" : event.data?.status === "failed" ? "失败" : event.data?.status === "candidate" ? "候选" : "已记录";
  if (event.type === "todo") return "已更新";
  if (event.type === "status") return event.data?.stage === "failed" ? "失败" : event.data?.stage === "stopped" ? "已停止" : "完成";
  return event.data?.status === "pending" ? "需确认" : "已处理";
}

export function AgentErrorNotice({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>{error}</span>
    </div>
  );
}

export function AgentComposer({
  allowSteering = false,
  input,
  isSteering = false,
  isSubmitting,
  model,
  models,
  onInputChange,
  onModelChange,
  onSubmit,
}: {
  allowSteering?: boolean;
  input: string;
  isSteering?: boolean;
  isSubmitting: boolean;
  model: string;
  models: AiModelOption[];
  onInputChange: (input: string) => void;
  onModelChange: (model: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  return (
    <form
      className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
      onSubmit={onSubmit}
    >
      <textarea
        className="min-h-20 w-full resize-none bg-transparent p-1 text-sm text-zinc-950 outline-none placeholder:text-zinc-500"
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={allowSteering ? "追加指令，Agent 将在当前步骤后接收…" : "描述创意或需求 / 使用技能，添加画布内容，@ 引用参考"}
        value={input}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        <ZenmeModelPicker
          icon={<Box className="size-4" />}
          model={model}
          models={models}
          onChange={onModelChange}
        />
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Check className="size-3.5" />
          Enter 发送
        </div>
        <Button
          className="size-9 rounded-full bg-zinc-950 p-0 text-white hover:bg-zinc-800"
          disabled={
            isSteering || (isSubmitting && !allowSteering) || !models.some((option) => option.id === model)
          }
          size="icon"
          type="submit"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </form>
  );
}
