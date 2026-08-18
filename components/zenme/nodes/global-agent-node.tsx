"use client";

import type { NodeProps } from "@xyflow/react";
import { AlertTriangle, Archive, ChevronsDownUp, ChevronsUpDown, FileDiff, GitMerge, Loader2, Network, Pin, Sparkles, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ChangeSetDialog } from "@/components/zenme/change-set-dialog";
import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { NodeActionHandle, NodeContextHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import type { AgentExecutionDetail } from "@/lib/agent/types";
import type { GlobalOrchestration } from "@/lib/global-agent/types";
import {
  getAgentExecutionFromApi,
  getGlobalOrchestrationFromApi,
  updateGlobalOrchestrationFromApi,
} from "@/lib/zenme-api";

export function GlobalAgentNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const projectId = nodeData.projectId ?? "";
  const orchestrationId = nodeData.globalOrchestrationId ?? "";
  const [orchestration, setOrchestration] = useState<GlobalOrchestration>();
  const [details, setDetails] = useState<Record<string, AgentExecutionDetail>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showChangeSets, setShowChangeSets] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId || !orchestrationId) return;
    try {
      const next = await getGlobalOrchestrationFromApi(projectId, orchestrationId);
      setOrchestration(next);
      const pairs = await Promise.all(next.tasks.filter((task) => task.agentExecutionId).map(async (task) => [task.id, await getAgentExecutionFromApi(projectId, task.agentExecutionId!)] as const));
      setDetails(Object.fromEntries(pairs));
      setError("");
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Global Agent 状态加载失败"); }
  }, [orchestrationId, projectId]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), orchestration?.status === "running" ? 1_000 : 4_000); return () => window.clearInterval(timer); }, [orchestration?.status, refresh]);

  async function stopLegacyOrchestration() {
    setBusy("stop");
    try {
      await updateGlobalOrchestrationFromApi({ action: "stop", orchestrationId, projectId });
      await refresh();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Global Agent 操作失败"); }
    finally { setBusy(""); }
  }

  const changeSetCount = orchestration?.tasks.reduce((count, task) => count + task.changeSetIds.length, 0) ?? 0;
  const folded = Boolean(nodeData.agentDetailsFolded);
  const terminal = orchestration && ["completed", "failed", "stopped", "interrupted"].includes(orchestration.status);
  function applyConvergence() {
    const proposal = orchestration?.convergenceProposal;
    if (!proposal) return;
    nodeData.onToggleAgentDetailsFolded?.(id, proposal.foldExecutionDetails);
    nodeData.onUpdateNodeLifecycle?.(id, proposal.suggestedLifecycle);
  }
  return <>
    <NodeFrame className="flex h-full w-full flex-col overflow-hidden" selected={Boolean(selected)}>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} /><NodeContextHandle selected={Boolean(selected)} /><NodeActionHandle selected={Boolean(selected)} /><NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <header className="flex items-center gap-3 border-b border-zinc-200 px-4 py-3"><Network className="size-4" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{nodeData.globalGoal || "Global Agent"}</p><p className="text-[11px] text-zinc-500">{orchestration ? `${globalStatusLabel(orchestration.status)} · ${orchestration.tasks.length} 个 Sub-agent · 并发 ${orchestration.concurrencyLimit}` : "加载调度状态"}</p></div>{orchestration?.status === "running" ? <Loader2 className="size-4 animate-spin" /> : null}</header>
      {!folded && (error || orchestration?.error) ? <p className="m-3 mb-0 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mr-1 inline size-3.5" />{error || orchestration?.error}</p> : null}
      {!folded && orchestration?.conflicts.length ? <p className="mx-3 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><GitMerge className="mr-1 inline size-3.5" />检测到 {orchestration.conflicts.length} 组文件范围冲突；请按建议顺序审阅，不会静默覆盖。</p> : null}
      {!folded ? <OverlayScrollArea className="min-h-0 flex-1" contentKey={orchestration?.updatedAt} viewportClassName="nodrag nowheel h-full overflow-auto p-4"><div className="space-y-2">{orchestration?.tasks.map((task, index) => {
        const detail = details[task.id]; const command = detail?.commandRequests.find((item) => item.status === "proposed");
        return <div className="rounded-lg border border-zinc-200 p-3 text-xs" key={task.id}><div className="flex items-center gap-2"><span className="flex size-5 items-center justify-center rounded-full bg-zinc-100 text-[10px]">{index + 1}</span><span className="font-medium">{task.title}</span><span className="ml-auto text-zinc-500">{subtaskStatusLabel(task.status)}</span></div><p className="mt-1 truncate text-[10px] text-zinc-500">{task.rootDisplayName ? `${task.rootDisplayName} · ` : ""}{task.allowedPathPrefixes.join(", ")}</p>{task.resultSummary ? <p className="mt-2 text-emerald-700">{task.resultSummary}</p> : null}{task.error ? <p className="mt-2 text-red-600">{task.error}</p> : null}{command && task.agentExecutionId ? <div className="mt-2 rounded bg-amber-50 p-2 text-amber-900"><code className="whitespace-pre-wrap break-all">{command.command ?? `${command.executable} ${command.args.join(" ")}`}</code><p className="mt-2 text-[11px]">旧版 Global Agent 记录仅供审计；当前版本不会批准或续跑这条命令。</p></div> : null}</div>;
      })}{orchestration?.convergenceProposal ? <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 text-xs text-violet-950"><div className="flex items-center gap-1 font-medium"><Sparkles className="size-3.5" />画布收敛建议</div><p className="mt-1">{orchestration.convergenceProposal.summary}</p><ul className="mt-2 list-disc space-y-1 pl-4 text-[11px]">{orchestration.convergenceProposal.rationale.map((item) => <li key={item}>{item}</li>)}</ul><p className="mt-2 text-[10px]">保留 {orchestration.convergenceProposal.preserveChangeSetIds.length} 个 ChangeSet；关联 {orchestration.convergenceProposal.promoteMemoryIds.length} 条 Memory。</p><button className="mt-2 rounded bg-violet-900 px-2.5 py-1.5 text-white" onClick={applyConvergence} type="button">确认收敛</button></div> : null}</div></OverlayScrollArea> : <p className="min-h-0 flex-1 truncate px-4 py-3 text-xs text-zinc-600">{orchestration?.resultSummary || "调度详情已折叠，Sub-agent 与审批历史仍可追溯。"}</p>}
      <footer className="nodrag flex items-center gap-2 border-t border-zinc-200 px-3 py-2 text-xs">{!folded && changeSetCount ? <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-100" onClick={() => setShowChangeSets(true)}><FileDiff className="size-3.5" />分别审阅 ({changeSetCount})</button> : null}<button className={`${folded ? "" : "ml-auto"} rounded p-1.5 hover:bg-zinc-100`} onClick={() => nodeData.onToggleAgentDetailsFolded?.(id, !folded)} title={folded ? "展开调度详情" : "折叠调度详情"} type="button">{folded ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}</button>{terminal ? <button className="rounded p-1.5 hover:bg-zinc-100" onClick={() => nodeData.onUpdateNodeLifecycle?.(id, "knowledge")} title="Promote 为长期知识" type="button"><Sparkles className="size-3.5" /></button> : null}{terminal ? <button className="rounded p-1.5 hover:bg-zinc-100" onClick={() => nodeData.onUpdateNodeLifecycle?.(id, "pinned")} title="固定在主画布" type="button"><Pin className="size-3.5" /></button> : null}{terminal ? <button className="rounded p-1.5 hover:bg-zinc-100" onClick={() => nodeData.onUpdateNodeLifecycle?.(id, "archived")} title="归档（不删除调度记录）" type="button"><Archive className="size-3.5" /></button> : null}<span className="text-[10px] text-zinc-500">{nodeData.nodeLifecycle ?? "working"}</span>{orchestration && ["planning", "running", "waitingReview"].includes(orchestration.status) ? <button aria-label="停止旧版调度" className="rounded p-1.5 hover:bg-zinc-100" disabled={Boolean(busy)} onClick={() => void stopLegacyOrchestration()}><Square className="size-3.5" /></button> : null}</footer>
    </NodeFrame>{showChangeSets ? <ChangeSetDialog onClose={() => setShowChangeSets(false)} projectId={projectId} /> : null}
  </>;
}

function globalStatusLabel(status: GlobalOrchestration["status"]) { return ({ planning: "规划", running: "调度中", waitingReview: "等待审阅", completed: "完成", failed: "部分失败", stopped: "已停止", interrupted: "已中断" })[status]; }
function subtaskStatusLabel(status: GlobalOrchestration["tasks"][number]["status"]) { return ({ queued: "排队", dispatching: "启动中", running: "运行中", waitingApproval: "等待批准", waitingInput: "等待回答", succeeded: "完成", failed: "失败", timedOut: "超时", stopped: "停止", interrupted: "中断" })[status]; }
