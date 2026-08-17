"use client";

import { Activity, Bot, Loader2, Network, Pause, Play, Power, X } from "lucide-react";
import { useEffect, useState } from "react";

import { planGlobalAgentTasks } from "@/components/zenme/canvas/global-agent-runner";
import type { AiModelOption } from "@/components/zenme/use-ai-model-options";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import type { GlobalTaskPlanInput } from "@/lib/global-agent/types";
import type { ContinuousGlobalAgentState } from "@/lib/global-agent/continuous-types";
import {
  configureContinuousGlobalAgentFromApi,
  getContinuousGlobalAgentFromApi,
  getWorkspaceBindingFromApi,
  runContinuousGlobalAgentFromApi,
  updateContinuousGlobalAgentSuggestionFromApi,
} from "@/lib/zenme-api";
import type { WorkspaceBinding } from "@/lib/workspace/types";

export function GlobalAgentDialog({
  canvasContext,
  models,
  onClose,
  onStart,
  projectId,
}: {
  canvasContext: string;
  models: AiModelOption[];
  onClose: () => void;
  onStart: (input: { concurrencyLimit: number; goal: string; model: string; tasks: GlobalTaskPlanInput[] }) => Promise<void>;
  projectId: string;
}) {
  const [goal, setGoal] = useState("");
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [tasks, setTasks] = useState<GlobalTaskPlanInput[]>([]);
  const [concurrencyLimit, setConcurrencyLimit] = useState(2);
  const [busy, setBusy] = useState<"plan" | "start" | "">("");
  const [error, setError] = useState("");
  const [continuous, setContinuous] = useState<ContinuousGlobalAgentState | null>(null);
  const [continuousBusy, setContinuousBusy] = useState(false);
  const [continuousError, setContinuousError] = useState("");
  const [workspaceBinding, setWorkspaceBinding] = useState<WorkspaceBinding | null>(null);
  useEffect(() => { if (!model && models[0]?.id) setModel(models[0].id); }, [model, models]);
  useEffect(() => {
    let active = true;
    void getContinuousGlobalAgentFromApi(projectId)
      .then((state) => { if (active) setContinuous(state); })
      .catch((nextError) => { if (active) setContinuousError(nextError instanceof Error ? nextError.message : "持续 Agent 加载失败"); });
    return () => { active = false; };
  }, [projectId]);
  useEffect(() => {
    let active = true;
    void getWorkspaceBindingFromApi(projectId)
      .then((binding) => { if (active) setWorkspaceBinding(binding); })
      .catch(() => { if (active) setWorkspaceBinding(null); });
    return () => { active = false; };
  }, [projectId]);
  const workspaceRoots = workspaceBinding ? [
    { id: workspaceBinding.id, displayName: workspaceBinding.displayName, status: workspaceBinding.status, permissions: workspaceBinding.permissions },
    ...(workspaceBinding.additionalRoots ?? []),
  ].filter((root) => root.status === "resolved" && root.permissions.read) : [];
  const hasValidTaskRoots = tasks.every((task) => workspaceRoots.some((root) => root.id === task.rootId));

  async function configureContinuous(mode: "disabled" | "paused" | "enabled") {
    if (continuousBusy) return;
    setContinuousBusy(true); setContinuousError("");
    try {
      setContinuous(await configureContinuousGlobalAgentFromApi({ projectId, mode, modelId: model || continuous?.modelId }));
    } catch (nextError) {
      setContinuousError(nextError instanceof Error ? nextError.message : "持续 Agent 更新失败");
    } finally { setContinuousBusy(false); }
  }

  async function runContinuous() {
    if (continuousBusy) return;
    setContinuousBusy(true); setContinuousError("");
    try { setContinuous((await runContinuousGlobalAgentFromApi(projectId)).state); }
    catch (nextError) { setContinuousError(nextError instanceof Error ? nextError.message : "持续 Agent 运行失败"); }
    finally { setContinuousBusy(false); }
  }

  async function updateSuggestion(suggestionId: string, status: "accepted" | "dismissed") {
    setContinuousBusy(true); setContinuousError("");
    try { setContinuous(await updateContinuousGlobalAgentSuggestionFromApi({ projectId, suggestionId, status })); }
    catch (nextError) { setContinuousError(nextError instanceof Error ? nextError.message : "建议更新失败"); }
    finally { setContinuousBusy(false); }
  }

  async function plan() {
    if (!goal.trim() || !model || busy) return;
    setBusy("plan"); setError("");
    try {
      const planned = await planGlobalAgentTasks({ canvasContext, goal: goal.trim(), model, projectId });
      setTasks(planned.map((task) => ({
        ...task,
        rootId: workspaceRoots.some((root) => root.id === task.rootId) ? task.rootId : workspaceRoots[0]?.id,
      })));
    }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "任务拆分失败"); }
    finally { setBusy(""); }
  }

  async function start() {
    if (!tasks.length || !hasValidTaskRoots || busy) return;
    setBusy("start"); setError("");
    try { await onStart({ concurrencyLimit, goal: goal.trim(), model, tasks }); onClose(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Global Agent 启动失败"); setBusy(""); }
  }

  return (
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/25 p-6" data-desktop-no-drag>
      <section aria-modal="true" className="flex max-h-[86vh] w-[min(760px,92vw)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4"><Network className="size-5" /><div className="flex-1"><h2 className="text-sm font-semibold">Global Agent</h2><p className="text-xs text-zinc-500">先审阅任务拆分，再并行调度临时 Sub-agent。</p></div><button aria-label="关闭" className="rounded p-1 hover:bg-zinc-100" disabled={Boolean(busy)} onClick={onClose}><X className="size-5" /></button></header>
        <OverlayScrollArea className="min-h-0 flex-1" contentKey={`${tasks.length}:${error}`} viewportClassName="h-full overflow-auto p-5"><div className="space-y-4">
          <section className="space-y-3 rounded-xl border border-zinc-200 p-4">
            <div className="flex items-center gap-2"><Activity className="size-4" /><div className="flex-1"><p className="text-sm font-medium">持续观察</p><p className="text-xs text-zinc-500">基于项目事件生成候选；采纳后进入后续 Project Agent 上下文，但不会自动执行。</p></div><span className="rounded-full bg-zinc-100 px-2 py-1 text-[10px] text-zinc-600">{continuousStatusLabel(continuous)}</span></div>
            <div className="flex flex-wrap gap-2">
              {continuous?.mode === "enabled" ? <button className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs" disabled={continuousBusy} onClick={() => void configureContinuous("paused")}><Pause className="size-3.5" />暂停</button> : <button className="flex items-center gap-1 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white" disabled={!model || continuousBusy} onClick={() => void configureContinuous("enabled")}><Play className="size-3.5" />{continuous?.mode === "paused" ? "继续" : "启用"}</button>}
              <button className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-2 text-xs" disabled={continuousBusy || continuous?.mode !== "enabled" || continuous?.status === "running"} onClick={() => void runContinuous()}>{continuousBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}立即整理</button>
              {continuous?.mode !== "disabled" ? <button aria-label="禁用持续观察" className="flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-zinc-500 hover:bg-zinc-100" disabled={continuousBusy} onClick={() => void configureContinuous("disabled")}><Power className="size-3.5" />禁用</button> : null}
            </div>
            {continuous?.checkpoint.contextSummary ? <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{continuous.checkpoint.contextSummary}</p> : null}
            {continuous?.suggestions.filter((item) => item.status === "candidate" || item.status === "accepted").slice(-5).map((suggestion) => <div className="rounded-lg border border-zinc-200 p-3" key={suggestion.id}><div className="flex items-center gap-2"><p className="flex-1 text-xs font-medium">{suggestion.title}</p>{suggestion.status === "accepted" ? <span className="text-[10px] text-emerald-700">已采纳到后续工作</span> : null}</div><p className="mt-1 text-xs text-zinc-600">{suggestion.summary}</p>{suggestion.status === "candidate" ? <div className="mt-2 flex gap-2"><button className="text-xs font-medium text-zinc-900" disabled={continuousBusy} onClick={() => void updateSuggestion(suggestion.id, "accepted")}>采纳到后续工作</button><button className="text-xs text-zinc-500" disabled={continuousBusy} onClick={() => void updateSuggestion(suggestion.id, "dismissed")}>忽略</button></div> : null}</div>)}
            {continuousError ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{continuousError}</p> : null}
          </section>
          <textarea autoFocus className="h-28 w-full resize-none rounded-xl border border-zinc-200 p-3 text-sm outline-none focus:border-zinc-500" onChange={(event) => { setGoal(event.target.value); setTasks([]); }} placeholder="描述一个需要理解项目、拆分并协调多个任务的目标…" value={goal} />
          <div className="grid grid-cols-[1fr_160px] gap-3">
            <select className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm" onChange={(event) => { setModel(event.target.value); setTasks([]); }} value={model}>{models.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 px-3 text-xs text-zinc-500">并发上限<select className="ml-auto bg-transparent text-sm text-zinc-900" onChange={(event) => setConcurrencyLimit(Number(event.target.value))} value={concurrencyLimit}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option><option value={4}>4</option></select></label>
          </div>
          {tasks.length ? <div className="space-y-2"><p className="text-xs font-medium text-zinc-500">待确认的调度计划</p>{tasks.map((task, index) => <div className="rounded-xl border border-zinc-200 p-3" key={`${index}:${task.title}`}><div className="flex items-center gap-2"><Bot className="size-4" /><p className="text-sm font-medium">{index + 1}. {task.title}</p><span className="ml-auto text-[10px] text-zinc-500">{task.allowedPathPrefixes?.join(", ") || "."}</span></div><p className="mt-1 text-xs text-zinc-600">{task.instruction}</p><div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500"><span>Workspace Root</span>{workspaceRoots.length ? <select aria-label={`任务 ${index + 1} Workspace Root`} className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-zinc-800" onChange={(event) => setTasks((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, rootId: event.target.value } : item))} value={task.rootId ?? workspaceRoots[0]?.id}>{workspaceRoots.map((root) => <option key={root.id} value={root.id}>{root.displayName}</option>)}</select> : <span className="text-red-600">没有可读 Root</span>}</div>{task.dependsOn?.length ? <p className="mt-1 text-[10px] text-amber-700">依赖任务：{task.dependsOn.map((item) => item + 1).join(", ")}</p> : null}</div>)}</div> : null}
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">每个 Sub-agent 使用独立 Working Memory、路径能力和 ChangeSet；重叠文件会显示冲突，不会直接并发写入主 Workspace。</p>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div></OverlayScrollArea>
        <footer className="flex justify-end gap-2 border-t border-zinc-200 p-4"><button className="rounded-lg px-4 py-2 text-sm hover:bg-zinc-100" disabled={Boolean(busy)} onClick={onClose}>取消</button>{tasks.length ? <button className="flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm" disabled={Boolean(busy)} onClick={() => void plan()}>重新拆分</button> : null}<button className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!goal.trim() || !model || Boolean(busy) || (tasks.length > 0 && !hasValidTaskRoots)} onClick={() => void (tasks.length ? start() : plan())}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />}{tasks.length ? "确认并启动" : "拆分任务"}</button></footer>
      </section>
    </div>
  );
}

function continuousStatusLabel(state: ContinuousGlobalAgentState | null) {
  if (!state) return "加载中";
  return { disabled: "未启用", paused: "已暂停", idle: "观察中", running: "整理中", backoff: "退避中" }[state.status];
}
