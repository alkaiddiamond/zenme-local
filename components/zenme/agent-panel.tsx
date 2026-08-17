"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AgentComposer,
  AgentErrorNotice,
  AgentEventWaterfall,
  AgentPanelHeader,
  AgentPanelShell,
  AgentWelcomeState,
} from "@/components/zenme/agent-panel-parts";
import type { AgentQuestionSubmission } from "@/components/zenme/agent-question-form";
import {
  appendAgentAssistantMessage,
  appendAgentUserMessage,
  getActiveProjectAgentTurnId,
  hasPendingProjectAgentBackgroundTask,
  hasPendingProjectAgentMemoryTask,
} from "@/components/zenme/agent-message-state";
import type { AgentMessage } from "@/components/zenme/agent-types";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import {
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { writeTextToClipboard } from "@/lib/clipboard";
import {
  getProjectAgentSessionFromApi,
  appendProjectAgentEventFromApi,
  approveAgentCommandFromApi,
  executeAgentWorkspaceToolFromApi,
  runProjectAgentTurnFromApi,
  rejectAgentCommandFromApi,
  steerProjectAgentTurnFromApi,
} from "@/lib/zenme-api";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

export type { AgentMessage } from "@/components/zenme/agent-types";

type AgentPanelProps = {
  onClose: () => void;
  context?: string;
  error: string | null;
  input: string;
  isSubmitting: boolean;
  messages: Message[];
  model: string;
  projectId: string;
  setError: (error: string | null) => void;
  setInput: (input: string) => void;
  setIsSubmitting: (isSubmitting: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setModel: (model: string) => void;
};

type Message = AgentMessage;

export function AgentPanel({
  context,
  error,
  input,
  isSubmitting,
  messages,
  model,
  onClose,
  projectId,
  setError,
  setInput,
  setIsSubmitting,
  setMessages,
  setModel,
}: AgentPanelProps) {
  const abortRef = useRef<AbortController | null>(null);
  const [events, setEvents] = useState<ProjectAgentEvent[]>([]);
  const [busyCommandId, setBusyCommandId] = useState<string>();
  const [busyQuestionId, setBusyQuestionId] = useState<string>();
  const [isSteering, setIsSteering] = useState(false);
  const configuredModels = useAiModelOptions();
  const pickerModels = configuredModels;
  const activeTurnId = useMemo(() => getActiveProjectAgentTurnId(events), [events]);
  const hasActiveTurn = Boolean(activeTurnId);
  const hasPendingBackgroundTask = useMemo(() => hasPendingProjectAgentBackgroundTask(events), [events]);
  const hasPendingMemoryTask = useMemo(() => hasPendingProjectAgentMemoryTask(events), [events]);

  const loadSession = useCallback(async () => {
    const session = await getProjectAgentSessionFromApi(projectId);
    setEvents(session.events);
    setMessages(session.events.flatMap((event): Message[] => {
      if ((event.type !== "user" && event.type !== "assistant") || !event.content) return [];
      return [{ role: event.type, content: event.content }];
    }));
  }, [projectId, setMessages]);

  useEffect(() => {
    let cancelled = false;
    void loadSession().catch((loadError) => {
      if (!cancelled) {
        setError(loadError instanceof Error ? loadError.message : "项目 Agent 会话加载失败");
      }
    });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [loadSession, setError]);

  useEffect(() => {
    if (!isSubmitting) void loadSession().catch(() => undefined);
  }, [isSubmitting, loadSession]);

  useEffect(() => {
    if (!isSubmitting && !hasActiveTurn && !hasPendingBackgroundTask && !hasPendingMemoryTask) return;
    const timer = window.setInterval(() => {
      void loadSession().catch(() => undefined);
    }, 750);
    return () => window.clearInterval(timer);
  }, [hasActiveTurn, hasPendingBackgroundTask, hasPendingMemoryTask, isSubmitting, loadSession]);

  async function approveCommand(event: ProjectAgentEvent) {
    const executionId = typeof event.data?.executionId === "string" ? event.data.executionId : "";
    const commandId = typeof event.data?.commandRequestId === "string" ? event.data.commandRequestId : "";
    if (!executionId || !commandId || busyCommandId) return;
    setBusyCommandId(commandId);
    setError(null);
    try {
      await approveAgentCommandFromApi(projectId, executionId, commandId);
      const result = await executeAgentWorkspaceToolFromApi({
        arguments: { commandRequestId: commandId },
        executionId,
        name: "run_approved_command",
        projectId,
      });
      await appendProjectAgentEventFromApi({
        projectId,
        turnId: event.turnId,
        type: "approval",
        content: result.stdout || result.stderr || (result.status === "running" ? `后台任务已启动：${result.id}` : "命令执行完成"),
        data: { commandRequestId: commandId, executionId, status: result.status },
      });
      await appendProjectAgentEventFromApi({
        projectId,
        turnId: event.turnId,
        type: "toolResult",
        content: result.stdout || result.stderr || (result.status === "running" ? `后台任务已启动：${result.id}` : "命令执行完成"),
        data: {
          executionId,
          name: "shell_command",
          output: result,
          status: result.status === "succeeded" || result.status === "running" ? "succeeded" : "failed",
        },
      });
      const session = await getProjectAgentSessionFromApi(projectId);
      const userEvent = session.events.find((candidate) => candidate.turnId === event.turnId && candidate.type === "user");
      const turnModel = typeof userEvent?.data?.model === "string" ? userEvent.data.model : model;
      if (userEvent?.content && turnModel) {
        await runProjectAgentTurnFromApi({ projectId, turnId: event.turnId, prompt: userEvent.content, model: turnModel, resume: true });
      }
      await loadSession();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "命令执行失败");
    } finally {
      setBusyCommandId(undefined);
    }
  }

  async function rejectCommand(event: ProjectAgentEvent) {
    const executionId = typeof event.data?.executionId === "string" ? event.data.executionId : "";
    const commandId = typeof event.data?.commandRequestId === "string" ? event.data.commandRequestId : "";
    if (!executionId || !commandId || busyCommandId) return;
    setBusyCommandId(commandId);
    setError(null);
    try {
      const result = await rejectAgentCommandFromApi(projectId, executionId, commandId);
      await appendProjectAgentEventFromApi({ projectId, turnId: event.turnId, type: "approval", content: "用户拒绝执行命令", data: { commandRequestId: commandId, executionId, status: "rejected" } });
      await appendProjectAgentEventFromApi({ projectId, turnId: event.turnId, type: "toolResult", content: "用户拒绝执行命令", data: { executionId, name: "shell_command", output: result, status: "failed" } });
      const session = await getProjectAgentSessionFromApi(projectId);
      const userEvent = session.events.find((candidate) => candidate.turnId === event.turnId && candidate.type === "user");
      const turnModel = typeof userEvent?.data?.model === "string" ? userEvent.data.model : model;
      if (turnModel) await runProjectAgentTurnFromApi({ projectId, turnId: event.turnId, prompt: "用户拒绝了上一条命令。不要重复请求相同命令；请继续或说明受阻原因。", model: turnModel, resume: true });
      await loadSession();
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "命令拒绝失败");
    } finally {
      setBusyCommandId(undefined);
    }
  }

  async function answerQuestion(event: ProjectAgentEvent, answer: string | AgentQuestionSubmission) {
    const answerText = typeof answer === "string" ? answer.trim() : Object.entries(answer.answers).map(([question, value]) => `${question} → ${value}`).join("；");
    if (!answerText || busyQuestionId) return;
    const userEvent = events.find((candidate) => candidate.turnId === event.turnId && candidate.type === "user");
    const turnModel = typeof userEvent?.data?.model === "string" ? userEvent.data.model : model;
    if (!turnModel) return;
    setBusyQuestionId(event.id);
    setError(null);
    try {
      await runProjectAgentTurnFromApi({ projectId, turnId: event.turnId, prompt: `用户对上一条问题的回答：${answerText}`, model: turnModel, resume: true, questionAnswer: { eventId: event.id, ...(typeof answer === "string" ? { value: answer.trim() } : answer) } });
      await loadSession();
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "回答提交失败");
    } finally {
      setBusyQuestionId(undefined);
    }
  }

  async function copyMessage(content: string) {
    try {
      const copied = await writeTextToClipboard(content);
      if (!copied) {
        throw new Error("Clipboard write failed");
      }
    } catch {
      setError("复制失败，请检查浏览器权限");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = input.trim();
    if (!content || isSteering || (isSubmitting && !hasActiveTurn)) {
      return;
    }

    if (hasActiveTurn) {
      if (!activeTurnId) return;
      setInput("");
      setIsSteering(true);
      setError(null);
      try {
        await steerProjectAgentTurnFromApi({ projectId, prompt: content, turnId: activeTurnId });
        await loadSession();
      } catch (steeringError) {
        setInput(content);
        setError(steeringError instanceof Error ? steeringError.message : "补充指令提交失败");
      } finally {
        setIsSteering(false);
      }
      return;
    }

    const nextMessages = appendAgentUserMessage(messages, content);
    setMessages(nextMessages);
    setInput("");
    setIsSubmitting(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await runProjectAgentTurnFromApi({
        canvasContext: context,
        model,
        projectId,
        prompt: content,
        signal: controller.signal,
      });
      const assistantContent = response.status === "waitingApproval"
        ? "任务需要执行命令，已等待你的确认。"
        : response.status === "waitingInput" ? response.question?.trim() : response.answer?.trim();
      if (assistantContent) {
        setMessages((current) => appendAgentAssistantMessage(current, assistantContent));
      }
      await loadSession();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError(err instanceof Error ? err.message : "调用失败");
      }
    } finally {
      setIsSubmitting(false);
      abortRef.current = null;
    }
  }

  return (
    <AgentPanelShell>
      <AgentPanelHeader onClose={onClose} />
      <div className="flex flex-1 flex-col justify-end overflow-hidden px-6 pb-5">
        <OverlayScrollArea
          className="min-h-0 flex-1"
          contentKey={messages.map((message) => message.content).join("\u0000")}
          viewportClassName="h-full overflow-auto pb-8"
        >
          {messages.length === 0 ? (
            <AgentWelcomeState context={context} />
          ) : (
            <>
              <AgentEventWaterfall
                busyCommandId={busyCommandId}
                busyQuestionId={busyQuestionId}
                events={events}
                messages={messages}
                onAnswerQuestion={(event, answer) => void answerQuestion(event, answer)}
                onApproveCommand={(event) => void approveCommand(event)}
                onCopyMessage={copyMessage}
                onRejectCommand={(event) => void rejectCommand(event)}
              />
            </>
          )}
        </OverlayScrollArea>

        <AgentErrorNotice error={error} />
        <AgentComposer
          allowSteering={hasActiveTurn}
          input={input}
          isSteering={isSteering}
          isSubmitting={isSubmitting}
          model={model}
          models={pickerModels}
          onInputChange={setInput}
          onModelChange={setModel}
          onSubmit={handleSubmit}
        />
      </div>
    </AgentPanelShell>
  );
}
