"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleStop, ExternalLink, FileDiff, Loader2, RotateCcw, Square, Terminal, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { renderMarkdown } from "@/components/zenme/nodes/renderers/markdown";
import {
  appendProjectAgentEventFromApi,
  approveAgentCommandFromApi,
  executeAgentWorkspaceToolFromApi,
  getProjectAgentSessionFromApi,
  runProjectAgentTurnFromApi,
  rejectAgentCommandFromApi,
  stopProjectAgentBackgroundTaskFromApi,
} from "@/lib/zenme-api";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import { isProjectAgentShellCommandTool } from "@/lib/agent/project-context-policy";
import { openPreviewUrl } from "@/lib/open-preview";
import { ChangeSetDialog } from "@/components/zenme/change-set-dialog";
import { hasPendingProjectAgentBackgroundTask, hasPendingProjectAgentMemoryTask } from "@/components/zenme/agent-message-state";
import { normalizeAgentDisplayText } from "@/components/zenme/agent-display-text";
import { getActiveAgentToolLabel, getAgentToolLabel } from "@/components/zenme/agent-tool-labels";
import { McpElicitationForm, projectMcpElicitationFromEvent } from "@/components/zenme/mcp-elicitation-form";
import { AgentQuestionForm, agentQuestionsFromOutput, type AgentQuestionSubmission } from "@/components/zenme/agent-question-form";

const ACTIVE_TURN_REFRESH_MS = 250;

export function AgentTurnTimeline({
  failure,
  fallback,
  onRetry,
  onTurnSettled,
  projectId,
  turnId,
}: {
  failure?: string;
  fallback?: string;
  onRetry?: () => Promise<void> | void;
  onTurnSettled?: (state: {
    answer?: string;
    error?: string;
    status: "waitingApproval" | "waitingInput" | "done" | "failed";
  }) => void;
  projectId: string;
  turnId: string;
}) {
  const [events, setEvents] = useState<ProjectAgentEvent[]>([]);
  const [busyCommandId, setBusyCommandId] = useState("");
  const [busyQuestionId, setBusyQuestionId] = useState("");
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [showChangeSets, setShowChangeSets] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const [stoppingTaskId, setStoppingTaskId] = useState("");
  const settledKeyRef = useRef("");
  const terminal = projectTurnIsTerminal(events);
  const hasPendingBackgroundTask = hasPendingProjectAgentBackgroundTask(events);
  const hasPendingMemoryTask = hasPendingProjectAgentMemoryTask(events);

  const refresh = useCallback(async () => {
    if (!projectId || !turnId) return;
    const session = await getProjectAgentSessionFromApi(projectId);
    setEvents(session.events.filter((event) => event.turnId === turnId));
  }, [projectId, turnId]);

  useEffect(() => {
    let cancelled = false;
    void refresh().catch((nextError) => {
      if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Turn 记录加载失败");
    });
    if (terminal && !busyQuestionId && !hasPendingBackgroundTask && !hasPendingMemoryTask) return () => { cancelled = true; };
    const timer = window.setInterval(() => void refresh().catch(() => undefined), ACTIVE_TURN_REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [busyQuestionId, hasPendingBackgroundTask, hasPendingMemoryTask, refresh, terminal]);

  const resolvedCommands = useMemo(() => new Set(events.flatMap((event) =>
    event.type === "approval" && event.data?.status !== "pending" && typeof event.data?.commandRequestId === "string"
      ? [event.data.commandRequestId]
      : [],
  )), [events]);
  const finalAnswer = projectAgentTurnAnswer(events, turnId, fallback);
  const liveAnswerDraft = projectAgentTurnAnswerDraft(events, turnId);
  const displayedAnswer = finalAnswer || liveAnswerDraft;
  const outputTargets = useMemo(() => extractAssistantOutputTargets(finalAnswer), [finalAnswer]);
  const terminalError = projectTurnTerminalError(events, failure, finalAnswer);
  const evidenceEvents = useMemo(() => projectTurnEvidenceEvents(events), [events]);
  const visibleEvents = useMemo(() =>
    terminal && showEvidence ? evidenceEvents : projectTurnEventsForDisplay(events),
  [evidenceEvents, events, showEvidence, terminal]);
  const completedStepCount = useMemo(() => projectTurnCompletedStepCount(events), [events]);
  const changeSetIds = useMemo(() => projectTurnChangeSetIds(events), [events]);
  const backgroundTasks = useMemo(() => projectTurnRunningBackgroundTasks(events), [events]);

  useEffect(() => {
    const terminalState = projectTurnSettledState(events, failure, finalAnswer);
    if (!terminalState || !onTurnSettled) return;
    const key = JSON.stringify(terminalState);
    if (settledKeyRef.current === key) return;
    settledKeyRef.current = key;
    onTurnSettled(terminalState);
  }, [events, failure, finalAnswer, onTurnSettled]);

  async function approveAndRun(event: ProjectAgentEvent, scope: "once" | "project") {
    const executionId = typeof event.data?.executionId === "string" ? event.data.executionId : "";
    const commandId = typeof event.data?.commandRequestId === "string" ? event.data.commandRequestId : "";
    if (!executionId || !commandId || busyCommandId) return;
    setBusyCommandId(commandId);
    setError("");
    try {
      await approveAgentCommandFromApi(projectId, executionId, commandId, scope);
      await appendProjectAgentEventFromApi({
        projectId,
        turnId,
        type: "approval",
        content: event.content || "命令已批准",
        data: { commandRequestId: commandId, executionId, status: "approved", approvalScope: scope },
      });
      const toolEvent = await appendProjectAgentEventFromApi({
        projectId,
        turnId,
        type: "toolCall",
        content: "命令正在运行",
        data: {
          executionId,
          name: "shell_command",
          status: "running",
          arguments: {
            command: event.data?.command,
            executable: event.data?.executable,
            args: event.data?.args,
            cwd: event.data?.cwd,
          },
        },
      });
      const result = await executeAgentWorkspaceToolFromApi({
        arguments: { commandRequestId: commandId },
        executionId,
        name: "run_approved_command",
        progressEventId: toolEvent.id,
        projectId,
      });
      await appendProjectAgentEventFromApi({
        projectId,
        turnId,
        type: "toolResult",
        content: result.stdout || result.stderr || (result.status === "running" ? `后台任务已启动：${result.id}` : "命令执行完成"),
        data: {
          executionId,
          toolCallEventId: toolEvent.id,
          name: "shell_command",
          output: result,
          status: result.status === "succeeded" || result.status === "running" ? "succeeded" : "failed",
        },
      });
      const userEvent = events.find((candidate) => candidate.type === "user");
      const model = typeof userEvent?.data?.model === "string" ? userEvent.data.model : "";
      if (userEvent?.content && model) {
        await runProjectAgentTurnFromApi({ projectId, turnId, prompt: userEvent.content, model, resume: true });
      } else {
        await appendProjectAgentEventFromApi({
          projectId,
          turnId,
          type: "status",
          data: { stage: result.status === "succeeded" || result.status === "running" ? "completed" : "failed" },
        });
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "命令执行失败");
    } finally {
      setBusyCommandId("");
    }
  }

  async function rejectAndResume(event: ProjectAgentEvent) {
    const executionId = typeof event.data?.executionId === "string" ? event.data.executionId : "";
    const commandId = typeof event.data?.commandRequestId === "string" ? event.data.commandRequestId : "";
    if (!executionId || !commandId || busyCommandId) return;
    const userEvent = events.find((candidate) => candidate.type === "user");
    const model = typeof userEvent?.data?.model === "string" ? userEvent.data.model : "";
    setBusyCommandId(commandId);
    setError("");
    try {
      const result = await rejectAgentCommandFromApi(projectId, executionId, commandId);
      await appendProjectAgentEventFromApi({
        projectId,
        turnId,
        type: "approval",
        content: "用户拒绝执行命令",
        data: { commandRequestId: commandId, executionId, status: "rejected" },
      });
      await appendProjectAgentEventFromApi({
        projectId,
        turnId,
        type: "toolResult",
        content: "用户拒绝执行命令",
        data: { executionId, name: "shell_command", output: result, status: "failed" },
      });
      if (model) {
        await runProjectAgentTurnFromApi({
          projectId,
          turnId,
          prompt: "用户拒绝了上一条命令。请不要重复请求相同命令；基于现有上下文继续，或说明无法完成的部分。",
          model,
          resume: true,
        });
      } else {
        await appendProjectAgentEventFromApi({ projectId, turnId, type: "status", data: { stage: "failed" } });
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "命令拒绝失败");
    } finally {
      setBusyCommandId("");
    }
  }

  async function stopBackgroundTask(taskId: string) {
    if (stoppingTaskId) return;
    setStoppingTaskId(taskId);
    setError("");
    try {
      await stopProjectAgentBackgroundTaskFromApi(projectId, taskId);
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "后台任务停止失败");
    } finally {
      setStoppingTaskId("");
    }
  }

  async function answerQuestion(event: ProjectAgentEvent, explicitAnswer?: string, structuredAnswer?: AgentQuestionSubmission) {
    const answer = (explicitAnswer ?? questionAnswer).trim();
    if ((!answer && !structuredAnswer) || busyQuestionId) return;
    const userEvent = events.find((candidate) => candidate.type === "user");
    const model = typeof userEvent?.data?.model === "string" ? userEvent.data.model : "";
    if (!model) {
      setError("无法恢复当前 Turn：缺少原始模型信息");
      return;
    }
    setBusyQuestionId(event.id);
    setError("");
    try {
      await runProjectAgentTurnFromApi({
        projectId,
        turnId,
        prompt: `用户对上一条问题的回答：${structuredAnswer ? Object.entries(structuredAnswer.answers).map(([question, value]) => `${question} → ${value}`).join("；") : answer}`,
        model,
        resume: true,
        questionAnswer: { eventId: event.id, ...(structuredAnswer ? structuredAnswer : { value: answer }) },
      });
      setQuestionAnswer("");
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "回答提交失败");
    } finally {
      setBusyQuestionId("");
    }
  }

  async function retryTurn() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    setError("");
    try {
      await onRetry();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Agent Turn 重试失败");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <>
    <div className="space-y-3">
      {!terminal && completedStepCount > 0 ? (
        <div className="text-xs text-zinc-400">已完成 {completedStepCount} 个步骤</div>
      ) : null}
      {visibleEvents.map((event) => {
        if (event.type === "user" || event.type === "assistant") return null;
        if (event.type === "compact") {
          const sourceTokens = typeof event.data?.sourceTokenEstimate === "number"
            ? event.data.sourceTokenEstimate
            : null;
          const microcompact = event.data?.kind === "microcompact";
          return (
            <div className="flex items-start gap-2 text-xs text-zinc-500" key={event.id}>
              <Check className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">{microcompact ? "已清理旧工具结果" : "已压缩早期上下文"}</p>
                {sourceTokens ? <p className="mt-0.5 text-zinc-400">{microcompact ? "释放" : "整理了"}约 {sourceTokens.toLocaleString("zh-CN")} tokens</p> : null}
              </div>
            </div>
          );
        }
        if (event.type === "memory") {
          const failed = event.data?.status === "failed";
          const running = event.data?.status === "running";
          return (
            <div className={`flex items-start gap-2 text-xs ${failed ? "text-red-600" : "text-zinc-500"}`} key={event.id}>
              {running ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : failed ? <CircleStop className="mt-0.5 size-3.5 shrink-0" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
              <div className="min-w-0">
                <p className="font-medium">{running ? "正在整理 Project Memory" : event.data?.status === "candidate" ? "已生成 Project Memory 候选" : failed ? "Project Memory 整理失败" : "Project Memory 已更新"}</p>
                {event.content ? <p className="mt-0.5 text-zinc-400">{agentEventContentForDisplay(event.content)}</p> : null}
              </div>
            </div>
          );
        }
        if (event.type === "todo") return <TaskPlanEvent event={event} key={event.id} />;
        if (event.type === "status") {
          const stage = String(event.data?.stage ?? "thinking");
          const nextEvent = events.find((candidate) => candidate.sequence > event.sequence);
          const isActive = !nextEvent && !terminal;
          return (
            <div className="flex items-center gap-2 text-xs text-zinc-500" key={event.id}>
              {isActive ? <Loader2 className="size-3.5 animate-spin" /> : stage === "completed" ? <Check className="size-3.5" /> : <CircleStop className="size-3.5" />}
              {stage === "delegating"
                ? delegationStatusLabel(event)
                : (stage === "planning" || stage === "thinking") && !isActive
                ? `${stage === "planning" ? "规划" : "思考"} ${eventDurationLabel(event, nextEvent)}`
                : statusLabel(stage)}
            </div>
          );
        }
        if (event.type === "thinking") {
          return <details className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs" key={event.id}><summary className="cursor-pointer text-zinc-600">思考过程</summary><p className="mt-2 whitespace-pre-wrap text-zinc-500">{agentEventContentForDisplay(event.content)}</p></details>;
        }
        if (event.type !== "toolCall" && event.type !== "toolResult" && event.type !== "approval") return null;
        const commandId = typeof event.data?.commandRequestId === "string" ? event.data.commandRequestId : "";
        const pending = event.type === "approval" && event.data?.status === "pending" && !resolvedCommands.has(commandId);
        const externalRoot = event.type === "approval" && event.data?.externalRoot && typeof event.data.externalRoot === "object"
          ? event.data.externalRoot as { displayName?: string; rootPath?: string }
          : null;
        const toolName = getAgentToolLabel(String(event.data?.name ?? "Workspace tool"));
        const question = event.type === "toolResult" &&
          ["ask_user_question", "exit_plan_mode"].includes(String(event.data?.name));
        const questions = question ? agentQuestionsFromOutput(event.data?.output) : [];
        const mcpElicitation = question ? projectMcpElicitationFromEvent(event) : null;
        const compactActivity = event.type !== "approval" &&
          !isProjectAgentShellCommandTool(event.data?.name) &&
          event.data?.name !== "apply_patch" &&
          event.data?.name !== "propose_patch" &&
          event.data?.name !== "propose_memory" &&
          !question;
        if (compactActivity) {
          const failed = event.type === "toolResult" && event.data?.status === "failed";
          const running = event.type === "toolCall";
          return (
            <div className={`flex items-start gap-2 text-xs ${failed ? "text-red-600" : "text-zinc-500"}`} key={event.id}>
              {running ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : failed ? <CircleStop className="mt-0.5 size-3.5 shrink-0" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
              <div className="min-w-0">
                <p className="font-medium">{running ? getActiveAgentToolLabel(String(event.data?.name ?? "")) : toolName}</p>
                {event.content ? <p className="mt-0.5 line-clamp-2 text-zinc-400">{agentEventContentForDisplay(event.content)}</p> : null}
              </div>
            </div>
          );
        }
        return (
          <div className={`rounded-lg border p-3 text-xs ${pending ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-white"}`} key={event.id}>
            <div className="flex items-center gap-2 font-medium">
              {event.type === "approval" ? <Terminal className="size-3.5" /> : <Wrench className="size-3.5" />}
              <span>{event.type === "approval" ? approvalLabel(event, pending) : toolName}</span>
              <span className="ml-auto text-zinc-500">{eventStatus(event)}</span>
            </div>
            {event.type === "approval" ? <code className="mt-2 block whitespace-pre-wrap break-all rounded bg-white/70 px-2 py-1.5">{projectTurnCommandForDisplay(event.data)}</code> : null}
            {event.type === "approval" ? <p className="mt-2 text-zinc-500">权限边界：{event.data?.sandboxMode === "workspace-write" ? "Workspace 范围" : "单次完全访问"}</p> : null}
            {externalRoot ? <p className="mt-2 break-all text-amber-800">Workspace 外目录：{externalRoot.rootPath ?? externalRoot.displayName}</p> : null}
            {event.content ? <p className="mt-2 whitespace-pre-wrap text-zinc-600">{agentEventContentForDisplay(event.content)}</p> : null}
            {question ? (
              <div className="mt-3 space-y-3">
                {mcpElicitation?.mode === "url" && mcpElicitation.url ? (
                  <a className="flex w-fit items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-medium text-zinc-800 hover:bg-zinc-50" href={mcpElicitation.url} onClick={() => void answerQuestion(event, "已完成")} rel="noreferrer" target="_blank">
                    <ExternalLink className="size-3.5" />打开 MCP 授权页面
                  </a>
                ) : null}
                {mcpElicitation?.mode === "form" ? (
                  <McpElicitationForm
                    disabled={Boolean(busyQuestionId)}
                    onChange={setQuestionAnswer}
                    schema={mcpElicitation.requestedSchema}
                  />
                ) : null}
                {!mcpElicitation ? <AgentQuestionForm disabled={Boolean(busyQuestionId)} onSubmit={(submission) => void answerQuestion(event, undefined, submission)} questions={questions} /> : null}
                <div className="flex flex-wrap gap-2">
                  {mcpElicitation?.mode === "form" ? <Button className="h-8 bg-zinc-950 px-3 text-white hover:bg-zinc-800" disabled={!questionAnswer.trim() || Boolean(busyQuestionId)} onClick={() => void answerQuestion(event)} type="button">{busyQuestionId === event.id ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}提交回答并继续</Button> : null}
                  {mcpElicitation ? <Button className="h-8 border border-zinc-300 bg-white px-3 text-zinc-700 hover:bg-zinc-50" disabled={Boolean(busyQuestionId)} onClick={() => void answerQuestion(event, "取消")} type="button">取消</Button> : null}
                </div>
              </div>
            ) : null}
            {pending ? <div className="mt-3 flex flex-wrap gap-2"><Button className="h-8 bg-zinc-950 px-3 text-white hover:bg-zinc-800" disabled={Boolean(busyCommandId)} onClick={() => void approveAndRun(event, "once")} type="button">{busyCommandId === commandId ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Check className="mr-1 size-3.5" />}批准并运行一次</Button>{externalRoot ? <Button className="h-8 border border-zinc-300 bg-white px-3 text-zinc-800 hover:bg-zinc-50" disabled={Boolean(busyCommandId)} onClick={() => void approveAndRun(event, "project")} type="button">加入项目并运行</Button> : null}<Button className="h-8 border border-zinc-300 bg-white px-3 text-zinc-700 hover:bg-zinc-50" disabled={Boolean(busyCommandId)} onClick={() => void rejectAndResume(event)} type="button">拒绝</Button></div> : null}
          </div>
        );
      })}
      {backgroundTasks.map((task) => (
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600" key={task.id}>
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">后台任务运行中</p>
            <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400" title={task.command}>{task.command}</p>
          </div>
          <button aria-label={`停止后台任务 ${task.command}`} className="rounded p-1.5 hover:bg-zinc-100 disabled:opacity-50" disabled={Boolean(stoppingTaskId)} onClick={() => void stopBackgroundTask(task.id)} title="停止后台任务" type="button">
            {stoppingTaskId === task.id ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
          </button>
        </div>
      ))}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {terminalError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{agentEventContentForDisplay(terminalError)}</p> : null}
      {projectTurnCanRetry(events) && onRetry ? <Button className="h-8 w-fit border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50" disabled={retrying} onClick={() => void retryTurn()} type="button">{retrying ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 size-3.5" />}重试</Button> : null}
      {displayedAnswer ? <div className="zenme-agent-response-text text-sm leading-6 text-zinc-800">{renderMarkdown(agentEventContentForDisplay(displayedAnswer))}{liveAnswerDraft && !finalAnswer ? <span aria-label="正在生成" className="ml-1 inline-block h-4 w-0.5 animate-pulse bg-zinc-400 align-middle" /> : null}</div> : terminal ? null : events.length ? <div className="flex items-center gap-2 py-2 text-xs text-zinc-500"><Loader2 className="size-3.5 animate-spin" />Agent 正在处理…</div> : null}
      {terminal && evidenceEvents.length ? <Button className="h-8 w-fit border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50" onClick={() => setShowEvidence((value) => !value)} type="button"><Wrench className="mr-1.5 size-3.5" />{showEvidence ? "收起执行证据" : `查看执行证据 (${evidenceEvents.length})`}</Button> : null}
      {outputTargets.map((target) => (
        <button
          className="flex w-fit max-w-full items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50"
          key={target.url}
          onClick={() => void openPreviewUrl(target.url).catch((nextError) => setError(nextError instanceof Error ? nextError.message : "预览页面打开失败"))}
          type="button"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          <span className="truncate">打开预览 · {target.label}</span>
        </button>
      ))}
      {changeSetIds.length ? <Button className="h-8 border border-zinc-200 bg-white px-3 text-xs text-zinc-700 hover:bg-zinc-50" onClick={() => setShowChangeSets(true)} type="button"><FileDiff className="mr-1.5 size-3.5" />审阅 ChangeSet ({changeSetIds.length})</Button> : null}
    </div>
    {showChangeSets ? <ChangeSetDialog onClose={() => setShowChangeSets(false)} projectId={projectId} /> : null}
    </>
  );
}

export function projectAgentTurnAnswer(
  events: ProjectAgentEvent[],
  turnId: string,
  fallback?: string,
) {
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  const requiresFinalAnswer = ["completed", "failed", "stopped"].includes(String(terminalStage));
  return [...events].reverse().find((event) =>
    event.turnId === turnId && event.type === "assistant" && event.content?.trim() &&
      (!requiresFinalAnswer || event.data?.checkpoint !== true),
  )?.content ?? fallback;
}

export function projectAgentTurnAnswerDraft(
  events: ProjectAgentEvent[],
  turnId: string,
) {
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  if (["completed", "failed", "stopped", "waitingApproval", "waitingInput"].includes(String(terminalStage))) return "";
  const latestDraft = [...events].reverse().find((event) =>
    event.turnId === turnId && event.type === "assistantDraft" && event.content?.trim(),
  );
  if (!latestDraft) return "";
  const supersedingActivity = events.some((event) =>
    event.turnId === turnId && event.sequence > latestDraft.sequence &&
    (event.type === "toolCall" || event.type === "toolResult" || event.type === "assistant"),
  );
  return supersedingActivity ? "" : latestDraft.content ?? "";
}

export function extractAssistantOutputTargets(answer?: string) {
  if (!answer?.trim()) return [];
  const withoutCodeBlocks = answer.replace(/```[\s\S]*?```/g, " ");
  const candidates = withoutCodeBlocks.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s<>'"`)\]]*)?/gi) ?? [];
  const targets = new Map<string, { label: string; url: string }>();
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[.,;:!?，。；：！？]+$/u, "");
    try {
      const parsed = new URL(cleaned);
      if (parsed.hostname === "[::1]" || parsed.hostname === "::1") parsed.hostname = "localhost";
      const url = parsed.toString();
      targets.set(url, { label: `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`, url });
    } catch {
      // Ignore malformed model output instead of creating a broken preview action.
    }
  }
  return [...targets.values()];
}

export function projectTurnSettledState(
  events: ProjectAgentEvent[],
  failure?: string,
  finalAnswer?: string,
) {
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  if (terminalStage === "completed") return { status: "done" as const, ...(finalAnswer?.trim() ? { answer: finalAnswer } : {}) };
  if (terminalStage === "failed") return { status: "failed" as const, error: projectTurnTerminalError(events, failure, finalAnswer) };
  if (terminalStage === "stopped") return { status: "done" as const };
  if (terminalStage === "waitingApproval") return { status: "waitingApproval" as const };
  if (terminalStage === "waitingInput") return { status: "waitingInput" as const };
  return null;
}

export function projectTurnTerminalError(
  events: ProjectAgentEvent[],
  failure?: string,
  finalAnswer?: string,
) {
  if (finalAnswer?.trim()) return "";
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  if (terminalStage !== "failed") return "";
  const failedTool = [...events].reverse().find((event) =>
    event.type === "toolResult" && event.data?.status === "failed" && event.content?.trim(),
  );
  const failedStatus = [...events].reverse().find((event) => event.type === "status" && event.data?.stage === "failed");
  const storedFailure = typeof failedStatus?.data?.error === "string" ? failedStatus.data.error.trim() : "";
  return failedTool?.content?.trim() || storedFailure || failure?.trim() || "Agent 执行失败，请重试";
}

export function projectTurnEventsForDisplay(events: ProjectAgentEvent[]) {
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  if (terminalStage === "waitingInput") {
    const question = [...events].reverse().find((event) =>
      event.type === "toolResult" &&
      ["ask_user_question", "exit_plan_mode"].includes(String(event.data?.name)) &&
      event.data?.status === "waitingInput",
    );
    return question ? [question] : [];
  }
  const finished = ["completed", "failed", "stopped"].includes(String(terminalStage));
  const resolvedToolCallIds = new Set(events.flatMap((event) =>
    event.type === "toolResult" && typeof event.data?.toolCallEventId === "string"
      ? [event.data.toolCallEventId]
      : [],
  ));

  if (finished) {
    return [];
  }

  const pendingApproval = unresolvedProjectTurnApprovals(events)[0];
  if (pendingApproval) return [pendingApproval];
  const activeToolCall = [...events].reverse().find((event) =>
    event.type === "toolCall" && !resolvedToolCallIds.has(event.id),
  );
  if (activeToolCall?.data?.name === "delegate_tasks") {
    const delegationActivity = [...events].reverse().find((event) =>
      event.sequence > activeToolCall.sequence && (
        (event.type === "status" && event.data?.stage === "delegating") ||
        ((event.type === "toolCall" || event.type === "toolResult") && event.data?.delegated === true)
      ),
    );
    if (delegationActivity) return [delegationActivity];
  }
  if (activeToolCall) return [activeToolCall];
  const latestActivity = [...events].reverse().find((event) =>
    event.type === "toolResult" || event.type === "status" || event.type === "thinking" || event.type === "compact" || event.type === "memory" || event.type === "todo",
  );
  return latestActivity ? [latestActivity] : [];
}

export function projectTurnEvidenceEvents(events: ProjectAgentEvent[]) {
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  if (!["completed", "failed", "stopped"].includes(String(terminalStage))) return [];
  return events.filter((event) => {
    if (event.type === "user" || event.type === "assistant" || event.type === "thinking") return false;
    if (event.type === "status") return false;
    if (event.type === "toolResult" && (
      event.data?.backgroundTaskNotification === true ||
      event.data?.queueMessageId ||
      event.data?.hookLifecycle === true
    )) return false;
    return ["toolCall", "toolResult", "approval", "compact", "memory", "todo"].includes(event.type);
  }).sort((left, right) => left.sequence - right.sequence);
}

export function unresolvedProjectTurnApprovals(events: ProjectAgentEvent[]) {
  const pendingByCommand = new Map<string, ProjectAgentEvent>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type !== "approval") continue;
    const commandId = typeof event.data?.commandRequestId === "string" && event.data.commandRequestId
      ? event.data.commandRequestId
      : event.id;
    if (event.data?.status === "pending") pendingByCommand.set(commandId, event);
    else pendingByCommand.delete(commandId);
  }
  return [...pendingByCommand.values()].sort((left, right) => left.sequence - right.sequence);
}

function TaskPlanEvent({ event }: { event: ProjectAgentEvent }) {
  const items = Array.isArray(event.data?.items) ? event.data.items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as { id?: unknown; content?: unknown; status?: unknown };
    if (typeof value.id !== "string" || typeof value.content !== "string") return [];
    return [{ id: value.id, content: value.content, status: String(value.status) }];
  }) : [];
  const completed = items.filter((item) => item.status === "completed").length;
  return <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs">
    <p className="font-medium text-zinc-700">任务计划 · {completed}/{items.length}</p>
    <div className="mt-2 space-y-1.5">{items.map((item) => <div className="flex items-start gap-2 text-zinc-500" key={item.id}>{item.status === "completed" ? <Check className="mt-0.5 size-3.5 shrink-0" /> : item.status === "in_progress" ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" /> : <span className="mt-1 size-2 shrink-0 rounded-full border border-zinc-400" />}<span className={item.status === "completed" ? "line-through text-zinc-400" : ""}>{item.content}</span></div>)}</div>
  </div>;
}

export function projectTurnIsTerminal(events: ProjectAgentEvent[]) {
  const latestStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  return ["completed", "failed", "stopped", "waitingInput"].includes(String(latestStage));
}

export function projectTurnCanRetry(events: ProjectAgentEvent[]) {
  const latestStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  return latestStage === "failed" || latestStage === "stopped";
}

export function agentEventContentForDisplay(content?: string) {
  return normalizeAgentDisplayText(content);
}

export function projectTurnCompletedStepCount(events: ProjectAgentEvent[]) {
  const terminalStage = [...events].reverse().find((event) => event.type === "status")?.data?.stage;
  if (["completed", "failed", "stopped"].includes(String(terminalStage))) return 0;
  return events.filter((event) =>
    event.type === "toolResult" && event.data?.status !== "waitingInput" && event.data?.status !== "interrupted",
  ).length;
}

export function projectTurnChangeSetIds(events: ProjectAgentEvent[]) {
  return [...new Set(events.flatMap((event) => {
    const output = event.data?.output;
    if (event.type !== "toolResult" || !output || typeof output !== "object") return [];
    const directId = (output as { changeSetId?: unknown }).changeSetId;
    const directIds = typeof directId === "string" && directId.length > 0 ? [directId] : [];
    if (event.data?.name !== "delegate_tasks") return directIds;
    const tasks = (output as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) return directIds;
    return [...directIds, ...tasks.flatMap((task) => {
      if (!task || typeof task !== "object") return [];
      const ids = (task as { changeSetIds?: unknown }).changeSetIds;
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
    })];
  }))];
}

export function projectTurnRunningBackgroundTasks(events: ProjectAgentEvent[]) {
  const tasks = new Map<string, { command: string; executionId?: string; id: string }>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    if (event.type !== "toolResult" || !event.data?.output || typeof event.data.output !== "object") continue;
    const output = event.data.output as {
      args?: unknown;
      command?: unknown;
      executable?: unknown;
      id?: unknown;
      status?: unknown;
    };
    if (typeof output.id !== "string") continue;
    if (isProjectAgentShellCommandTool(event.data.name) && output.status === "running") {
      tasks.set(output.id, {
        id: output.id,
        executionId: typeof event.data.executionId === "string" ? event.data.executionId : undefined,
        command: projectTurnCommandForDisplay(output),
      });
    }
    if (event.data.backgroundTaskNotification === true || event.data.name === "task_stop") {
      tasks.delete(output.id);
    }
  }
  return [...tasks.values()];
}

export function projectTurnCommandForDisplay(value: unknown) {
  if (!value || typeof value !== "object") return "后台命令";
  const command = "command" in value && typeof value.command === "string" ? value.command.trim() : "";
  if (command) return command;
  const executable = "executable" in value && typeof value.executable === "string" && value.executable.trim()
    ? value.executable.trim()
    : "后台命令";
  const args = "args" in value && Array.isArray(value.args)
    ? value.args.filter((item): item is string => typeof item === "string")
    : [];
  return [executable, ...args].join(" ");
}

export const projectTurnDelegatedChangeSetIds = projectTurnChangeSetIds;

function statusLabel(stage: string) {
  return ({
    workspace_status: "Workspace 状态",
    planning: "正在规划",
    thinking: "正在思考",
    mcpDiscovery: "正在发现 MCP 工具",
    backgroundFollowUp: "正在处理后台任务结果",
    steering: "已收到补充指令",
    compacting: "正在压缩上下文",
    waitingApproval: "等待命令批准",
    waitingInput: "等待用户回答",
    completed: "运行完成",
    failed: "运行失败",
    stopped: "已停止",
  } as Record<string, string>)[stage] ?? stage;
}

function delegationStatusLabel(event: ProjectAgentEvent) {
  const completed = typeof event.data?.completedCount === "number" ? event.data.completedCount : 0;
  const total = typeof event.data?.totalCount === "number" ? event.data.totalCount : 0;
  const running = Array.isArray(event.data?.runningTitles)
    ? event.data.runningTitles.filter((title): title is string => typeof title === "string").slice(0, 3)
    : [];
  return `并行 Sub-agent ${completed}/${total}${running.length ? ` · ${running.join("、")}` : ""}`;
}

function eventStatus(event: ProjectAgentEvent) {
  if (event.type === "toolCall") {
    const elapsedMs = typeof event.data?.elapsedMs === "number" ? event.data.elapsedMs : 0;
    return elapsedMs >= 1_000 ? `运行 ${formatElapsedMilliseconds(elapsedMs)}` : "运行中";
  }
  if (event.type === "toolResult") return event.data?.status === "failed"
    ? "失败"
    : event.data?.status === "waitingInput"
      ? "等待回答"
      : event.data?.status === "interrupted"
        ? "已中断"
        : "完成";
  return event.data?.status === "pending" ? "需确认" : "已执行";
}

function formatElapsedMilliseconds(elapsedMs: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function approvalLabel(event: ProjectAgentEvent, pending: boolean) {
  if (pending) return "等待命令批准";
  if (event.data?.status === "autoApproved") return "命令已自动授权";
  if (event.data?.status === "rejected") return "命令已拒绝";
  return event.data?.approvalScope === "project" ? "已加入项目并执行" : "已批准并执行一次";
}

function eventDurationLabel(event: ProjectAgentEvent, nextEvent?: ProjectAgentEvent) {
  const startedAt = new Date(event.createdAt).getTime();
  const endedAt = nextEvent ? new Date(nextEvent.createdAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1_000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
