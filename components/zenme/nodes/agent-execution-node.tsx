"use client";

import type { NodeProps } from "@xyflow/react";
import { AlertTriangle, Archive, Bot, Check, ChevronsDownUp, ChevronsUpDown, FileDiff, Loader2, Pin, Play, RotateCcw, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ChangeSetDialog } from "@/components/zenme/change-set-dialog";
import { runWorkspaceAgent } from "@/components/zenme/canvas/workspace-agent-runner";
import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { NodeActionHandle, NodeContextHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import {
  approveAgentCommandFromApi,
  executeAgentWorkspaceToolFromApi,
  getAgentExecutionFromApi,
  updateAgentExecutionFromApi,
} from "@/lib/zenme-api";
import type { AgentExecutionDetail } from "@/lib/agent/types";

export function AgentExecutionNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const projectId = nodeData.projectId ?? "";
  const executionId = nodeData.executionId ?? "";
  const [detail, setDetail] = useState<AgentExecutionDetail>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showChangeSets, setShowChangeSets] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId || !executionId) return;
    try {
      setDetail(await getAgentExecutionFromApi(projectId, executionId));
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "执行详情加载失败");
    }
  }, [executionId, projectId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), detail?.status === "running" ? 1_000 : 4_000);
    return () => window.clearInterval(timer);
  }, [detail?.status, refresh]);

  async function approveAndRun(commandId: string) {
    if (busy) return;
    setBusy(commandId);
    try {
      await approveAgentCommandFromApi(projectId, executionId, commandId);
      await executeAgentWorkspaceToolFromApi({
        arguments: { commandRequestId: commandId },
        executionId,
        name: "run_approved_command",
        projectId,
      });
      await runWorkspaceAgent({ executionId, model: nodeData.agentModel ?? "", projectId });
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "命令执行失败");
      await refresh();
    } finally {
      setBusy("");
    }
  }

  async function mutate(action: "retry" | "stop") {
    setBusy(action);
    try {
      await updateAgentExecutionFromApi({ action, executionId, projectId });
      if (action === "retry") {
        await runWorkspaceAgent({ executionId, model: nodeData.agentModel ?? "", projectId });
      }
      await refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "执行操作失败");
    } finally {
      setBusy("");
    }
  }

  const pendingCommand = detail?.commandRequests.find((command) => command.status === "proposed");
  const canRetry = detail && ["failed", "timedOut", "stopped", "interrupted"].includes(detail.status);
  const folded = Boolean(nodeData.agentDetailsFolded);
  const terminal = detail && ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(detail.status);

  return (
    <>
      <NodeFrame className="flex h-full w-full flex-col overflow-hidden" selected={Boolean(selected)}>
        <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
        <NodeContextHandle selected={Boolean(selected)} />
        <NodeActionHandle selected={Boolean(selected)} />
        <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
        <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3">
          <Bot className="size-4 text-zinc-600" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{nodeData.agentInstruction || "Workspace Agent"}</p><p className="text-[11px] text-zinc-500">{detail ? `${stageLabel(detail.stage)} · ${statusLabel(detail.status)}` : "正在加载执行状态"}</p></div>
          {detail?.status === "running" ? <Loader2 className="size-4 animate-spin text-zinc-500" /> : null}
        </header>
        {!folded && (error || detail?.error) ? <p className="m-3 mb-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mr-1 inline size-3.5" />{error || detail?.error}</p> : null}
        {!folded ? <OverlayScrollArea className="min-h-0 flex-1" contentKey={detail?.updatedAt} viewportClassName="nodrag nowheel h-full overflow-auto p-4">
          <div className="space-y-3 text-xs">
            {detail?.toolCalls.map((call) => (
              <div className="rounded-lg border border-zinc-200 p-3" key={call.id}>
                <div className="flex items-center gap-2"><span className="font-mono font-medium">{call.name}</span><span className="ml-auto text-zinc-500">{toolStatusLabel(call.status)}</span></div>
                {call.error ? <p className="mt-2 text-red-600">{call.error}</p> : null}
              </div>
            ))}
            {pendingCommand ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                <p className="font-medium">等待命令批准</p>
                <code className="mt-2 block whitespace-pre-wrap break-all">{pendingCommand.command ?? `${pendingCommand.executable} ${pendingCommand.args.join(" ")}`}</code>
                <p className="mt-1 text-[11px]">权限边界：{pendingCommand.sandboxMode === "workspace-write" ? "Workspace 范围" : "单次完全访问"}</p>
                <p className="mt-1 text-[11px]">{pendingCommand.reason}</p>
                <button className="mt-3 flex items-center gap-1 rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50" disabled={Boolean(busy)} onClick={() => void approveAndRun(pendingCommand.id)} type="button"><Check className="size-3.5" />批准并运行一次</button>
              </div>
            ) : null}
            {detail?.resultSummary ? <div className="rounded-lg bg-emerald-50 p-3 text-emerald-900"><p className="font-medium">执行结果</p><p className="mt-1 whitespace-pre-wrap">{detail.resultSummary}</p></div> : null}
            {!detail?.toolCalls.length && !pendingCommand && !detail?.resultSummary ? <p className="py-10 text-center text-zinc-400">Agent 正在规划第一步…</p> : null}
          </div>
        </OverlayScrollArea> : <p className="min-h-0 flex-1 truncate px-4 py-3 text-xs text-zinc-600">{detail?.resultSummary || detail?.error || "执行详情已折叠，完整记录仍可追溯。"}</p>}
        <footer className="nodrag flex items-center gap-2 border-t border-zinc-200 px-3 py-2 text-xs">
          {!folded && detail?.changeSetIds.length ? <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-100" onClick={() => setShowChangeSets(true)} type="button"><FileDiff className="size-3.5" />审阅 ChangeSet ({detail.changeSetIds.length})</button> : null}
          <button className={`${folded ? "" : "ml-auto"} rounded p-1.5 hover:bg-zinc-100`} onClick={() => nodeData.onToggleAgentDetailsFolded?.(id, !folded)} title={folded ? "展开执行详情" : "折叠执行详情"} type="button">{folded ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}</button>
          {terminal ? <button className="rounded p-1.5 hover:bg-zinc-100" onClick={() => nodeData.onUpdateNodeLifecycle?.(id, "knowledge")} title="Promote 为长期知识" type="button"><Sparkles className="size-3.5" /></button> : null}
          {terminal ? <button className="rounded p-1.5 hover:bg-zinc-100" onClick={() => nodeData.onUpdateNodeLifecycle?.(id, "pinned")} title="固定在主画布" type="button"><Pin className="size-3.5" /></button> : null}
          {terminal ? <button className="rounded p-1.5 hover:bg-zinc-100" onClick={() => nodeData.onUpdateNodeLifecycle?.(id, "archived")} title="归档（不删除执行记录）" type="button"><Archive className="size-3.5" /></button> : null}
          <span className="rounded bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500">{nodeData.nodeLifecycle ?? "working"}</span>
          {detail?.status === "running" && detail.stage !== "waitingApproval" ? <button aria-label="停止执行" className="rounded p-1.5 hover:bg-zinc-100" disabled={Boolean(busy)} onClick={() => void mutate("stop")} type="button"><Square className="size-3.5" /></button> : null}
          {canRetry ? <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-100" disabled={Boolean(busy)} onClick={() => void mutate("retry")} type="button">{busy === "retry" ? <Play className="size-3.5" /> : <RotateCcw className="size-3.5" />}重试</button> : null}
        </footer>
      </NodeFrame>
      {showChangeSets ? <ChangeSetDialog onClose={() => setShowChangeSets(false)} projectId={projectId} /> : null}
    </>
  );
}

function stageLabel(stage: AgentExecutionDetail["stage"]) {
  return ({ planning: "规划", searching: "搜索", reading: "读取", editing: "提议修改", waitingApproval: "等待批准", waitingInput: "等待用户回答", testing: "测试", completed: "完成", failed: "失败", stopped: "已停止", interrupted: "已中断" })[stage];
}

function statusLabel(status: AgentExecutionDetail["status"]) {
  return ({ queued: "排队", running: "运行中", polling: "轮询中", succeeded: "成功", failed: "失败", timedOut: "超时", stopped: "已停止", interrupted: "已中断" })[status];
}

function toolStatusLabel(status: AgentExecutionDetail["toolCalls"][number]["status"]) {
  return ({ running: "运行中", succeeded: "完成", failed: "失败", stopped: "停止" })[status];
}
