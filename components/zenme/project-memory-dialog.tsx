"use client";

import { AlertTriangle, Brain, Check, Loader2, Pencil, Pin, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import type { ProjectMemory, ProjectMemoryKind, ProjectMemorySourceKind } from "@/lib/memory/types";
import {
  createProjectMemoryFromApi,
  deleteProjectMemoryFromApi,
  listProjectMemoriesFromApi,
  updateProjectMemoryFromApi,
} from "@/lib/zenme-api";

const KIND_LABELS: Record<ProjectMemoryKind, string> = { file: "文件", architecture: "架构", decision: "决策", todo: "TODO" };
const STATUS_LABELS: Record<ProjectMemory["status"], string> = { candidate: "候选", confirmed: "已确认", needsReview: "待复核", stale: "已过期", rejected: "已拒绝" };

export function ProjectMemoryDialog({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const [memories, setMemories] = useState<ProjectMemory[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [kind, setKind] = useState<ProjectMemoryKind>("decision");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceKind, setSourceKind] = useState<ProjectMemorySourceKind>("decision");
  const [sourceId, setSourceId] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [revising, setRevising] = useState(false);
  const [revisionTitle, setRevisionTitle] = useState("");
  const [revisionContent, setRevisionContent] = useState("");

  const load = useCallback(async (validate = false) => {
    setLoading(true);
    try {
      const result = await listProjectMemoriesFromApi(projectId, validate);
      setMemories(result.memories);
      setSelectedId((current) => result.memories.some((memory) => memory.id === current) ? current : result.memories[0]?.id ?? "");
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Project Memory 加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(true); }, [load]);
  const selected = memories.find((memory) => memory.id === selectedId) ?? memories[0];

  async function createMemory() {
    if (!title.trim() || !content.trim() || !sourceId.trim() || mutating) return;
    setMutating(true);
    try {
      await createProjectMemoryFromApi(projectId, {
        kind, title, content, status: "candidate",
        sources: [{
          kind: sourceKind,
          id: sourceId,
          label: sourceLabel.trim() || sourceId,
          relativePath: sourceKind === "workspaceFile" ? sourceId : undefined,
        }],
      });
      setTitle(""); setContent(""); setSourceId(""); setSourceLabel(""); setShowCreate(false);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Project Memory 创建失败");
    } finally { setMutating(false); }
  }

  async function act(action: "confirm" | "reject") {
    if (!selected || mutating) return;
    setMutating(true);
    try { await updateProjectMemoryFromApi(projectId, selected.id, { action }); await load(true); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Project Memory 更新失败"); }
    finally { setMutating(false); }
  }

  async function togglePin() {
    if (!selected || mutating) return; setMutating(true);
    try { await updateProjectMemoryFromApi(projectId, selected.id, { action: selected.pinned ? "unpin" : "pin" }); await load(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Project Memory 固定失败"); }
    finally { setMutating(false); }
  }

  async function revise() {
    if (!selected || !revisionTitle.trim() || !revisionContent.trim() || mutating) return; setMutating(true);
    try { await updateProjectMemoryFromApi(projectId, selected.id, { action: "revise", title: revisionTitle, content: revisionContent, reason: "用户在 Project Memory 中修订" }); setRevising(false); await load(true); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Project Memory 修订失败"); }
    finally { setMutating(false); }
  }

  async function remove() {
    if (!selected || mutating) return;
    setMutating(true);
    try { await deleteProjectMemoryFromApi(projectId, selected.id); await load(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : "Project Memory 删除失败"); }
    finally { setMutating(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 p-8" data-desktop-no-drag onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-modal="true" className="flex h-[min(780px,88vh)] w-[min(1120px,94vw)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-200">
          <header className="flex h-16 items-center gap-2 border-b border-zinc-200 px-4"><Brain className="size-5" /><h2 className="flex-1 font-medium">Project Memory</h2><button className="rounded-md bg-zinc-900 px-2.5 py-1.5 text-xs text-white" onClick={() => setShowCreate((value) => !value)} type="button">{showCreate ? "取消" : "新增"}</button></header>
          {showCreate ? <CreateForm content={content} kind={kind} mutating={mutating} onContent={setContent} onCreate={() => void createMemory()} onKind={setKind} onSourceId={setSourceId} onSourceKind={setSourceKind} onSourceLabel={setSourceLabel} onTitle={setTitle} sourceId={sourceId} sourceKind={sourceKind} sourceLabel={sourceLabel} title={title} /> : null}
          <OverlayScrollArea className="min-h-0 flex-1" contentKey={memories.map((memory) => `${memory.id}:${memory.updatedAt}`).join("|")} viewportClassName="h-full overflow-auto p-2">
            {memories.map((memory) => <button className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${memory.id === selected?.id ? "bg-zinc-100" : "hover:bg-zinc-50"}`} key={memory.id} onClick={() => { setSelectedId(memory.id); setRevising(false); }} type="button"><p className="truncate text-sm font-medium">{memory.pinned ? "📌 " : ""}{memory.title}</p><p className="mt-1 text-[11px] text-zinc-500">{KIND_LABELS[memory.kind]} · {STATUS_LABELS[memory.status]} · r{memory.currentRevision}</p></button>)}
            {!loading && memories.length === 0 ? <p className="p-5 text-center text-sm text-zinc-500">暂无长期记忆。Agent 推断会先进入候选，需用户确认。</p> : null}
          </OverlayScrollArea>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center border-b border-zinc-200 px-5"><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{selected?.title ?? "记忆详情"}</h2><p className="text-xs text-zinc-500">{selected ? `${KIND_LABELS[selected.kind]} · ${STATUS_LABELS[selected.status]} · 当前修订 r${selected.currentRevision}` : ""}</p></div><button className="mr-2 rounded p-1 hover:bg-zinc-100" disabled={loading} onClick={() => void load(true)} title="重新验证来源" type="button"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} /></button><button aria-label="关闭" className="rounded p-1 hover:bg-zinc-100" onClick={onClose} type="button"><X className="size-5" /></button></header>
          {error ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mr-1 inline size-4" />{error}</p> : null}
          <OverlayScrollArea className="min-h-0 flex-1" contentKey={selected?.updatedAt} viewportClassName="h-full overflow-auto p-5">
            {loading ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin" /></div> : selected ? <div className="space-y-5">{revising ? <div className="space-y-2 rounded-lg border border-zinc-200 p-3"><input className="h-9 w-full rounded border border-zinc-200 px-2 text-sm" onChange={(event) => setRevisionTitle(event.target.value)} value={revisionTitle} /><textarea className="h-40 w-full resize-none rounded border border-zinc-200 p-2 text-sm" onChange={(event) => setRevisionContent(event.target.value)} value={revisionContent} /><div className="flex justify-end gap-2"><button className="rounded px-3 py-1.5 text-xs hover:bg-zinc-100" onClick={() => setRevising(false)} type="button">取消</button><button className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white" disabled={mutating} onClick={() => void revise()} type="button">保存为新修订</button></div></div> : <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">{selected.content}</p>}{selected.invalidationReason ? <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{selected.invalidationReason}</p> : null}<section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">来源与版本</h3><div className="space-y-2">{selected.sources.map((source, index) => <div className="rounded-lg border border-zinc-200 p-3 text-xs" key={`${source.kind}:${source.id}:${index}`}><p className="font-medium">{source.label}</p><p className="mt-1 break-all text-zinc-500">{source.kind} · {source.relativePath ?? source.id}</p><p className="mt-1 break-all font-mono text-[10px] text-zinc-400">{source.contentHash ? `sha256:${source.contentHash}` : `version:${source.version ?? "未提供"}`}</p></div>)}</div></section><section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">修订历史</h3>{selected.revisions.map((revision, index) => <div className="mb-2 border-l-2 border-zinc-200 pl-3 text-xs" key={`${revision.revision}:${index}`}><p>r{revision.revision} · {STATUS_LABELS[revision.status]} · {revision.createdBy}</p><p className="mt-1 text-zinc-500">{revision.reason}</p></div>)}</section></div> : null}
          </OverlayScrollArea>
          {selected ? <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 p-4"><button className="mr-auto flex items-center gap-1 rounded-md px-3 py-2 text-sm text-red-700 hover:bg-red-50" disabled={mutating} onClick={() => void remove()} type="button"><Trash2 className="size-4" />删除记忆</button><button className="flex items-center gap-1 rounded-md px-3 py-2 text-sm hover:bg-zinc-100" disabled={mutating} onClick={() => void togglePin()} type="button"><Pin className="size-4" />{selected.pinned ? "取消固定" : "固定"}</button><button className="flex items-center gap-1 rounded-md px-3 py-2 text-sm hover:bg-zinc-100" disabled={mutating} onClick={() => { setRevisionTitle(selected.title); setRevisionContent(selected.content); setRevising(true); }} type="button"><Pencil className="size-4" />修订</button>{selected.status !== "rejected" ? <button className="rounded-md px-3 py-2 text-sm text-red-700 hover:bg-red-50" disabled={mutating} onClick={() => void act("reject")} type="button">拒绝</button> : null}{selected.status !== "confirmed" ? <button className="flex items-center gap-1 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white" disabled={mutating} onClick={() => void act("confirm")} type="button"><Check className="size-4" />确认并用于上下文</button> : null}</footer> : null}
        </div>
      </section>
    </div>
  );
}

function CreateForm(props: { content: string; kind: ProjectMemoryKind; mutating: boolean; onContent: (value: string) => void; onCreate: () => void; onKind: (value: ProjectMemoryKind) => void; onSourceId: (value: string) => void; onSourceKind: (value: ProjectMemorySourceKind) => void; onSourceLabel: (value: string) => void; onTitle: (value: string) => void; sourceId: string; sourceKind: ProjectMemorySourceKind; sourceLabel: string; title: string }) {
  return <div className="space-y-2 border-b border-zinc-200 p-3"><select className="h-8 w-full rounded border border-zinc-200 px-2 text-xs" onChange={(event) => props.onKind(event.target.value as ProjectMemoryKind)} value={props.kind}>{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input className="h-8 w-full rounded border border-zinc-200 px-2 text-xs" onChange={(event) => props.onTitle(event.target.value)} placeholder="标题" value={props.title} /><textarea className="h-20 w-full resize-none rounded border border-zinc-200 p-2 text-xs" onChange={(event) => props.onContent(event.target.value)} placeholder="记忆正文" value={props.content} /><select className="h-8 w-full rounded border border-zinc-200 px-2 text-xs" onChange={(event) => props.onSourceKind(event.target.value as ProjectMemorySourceKind)} value={props.sourceKind}><option value="decision">用户决策</option><option value="workspaceFile">Workspace 文件</option><option value="canvasNode">画布节点</option><option value="task">任务</option><option value="execution">执行</option><option value="changeSet">ChangeSet</option><option value="gitCommit">Git Commit</option></select><input className="h-8 w-full rounded border border-zinc-200 px-2 text-xs" onChange={(event) => props.onSourceId(event.target.value)} placeholder={props.sourceKind === "workspaceFile" ? "Workspace 相对路径" : "来源 ID"} value={props.sourceId} /><input className="h-8 w-full rounded border border-zinc-200 px-2 text-xs" onChange={(event) => props.onSourceLabel(event.target.value)} placeholder="来源名称（可选）" value={props.sourceLabel} /><button className="h-8 w-full rounded bg-zinc-900 text-xs text-white disabled:opacity-50" disabled={props.mutating || !props.title.trim() || !props.content.trim() || !props.sourceId.trim()} onClick={props.onCreate} type="button">创建候选记忆</button></div>;
}
