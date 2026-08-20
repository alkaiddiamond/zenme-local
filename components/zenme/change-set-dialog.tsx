"use client";

import { AlertTriangle, Check, FileDiff, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import { refreshWorkspaceFileDocuments } from "@/components/zenme/workspace-file-document-store";
import {
  listWorkspaceChangeSetsFromApi,
  updateWorkspaceChangeSetFromApi,
} from "@/lib/zenme-api";
import type { ChangeSetOperation, WorkspaceChangeSet } from "@/lib/workspace/change-set-types";

export function ChangeSetDialog({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const [changeSets, setChangeSets] = useState<WorkspaceChangeSet[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listWorkspaceChangeSetsFromApi(projectId);
      setChangeSets(result.changeSets);
      setSelectedId((current) => current || result.changeSets[0]?.id || "");
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "ChangeSet 加载失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  const selected = changeSets.find((entry) => entry.id === selectedId) ?? changeSets[0];

  async function act(action: "approve" | "apply" | "reject" | "revert") {
    if (!selected || mutating) return;
    setMutating(true);
    setError("");
    try {
      const updated = await updateWorkspaceChangeSetFromApi(projectId, selected.id, action);
      setChangeSets((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      if (action === "apply" || action === "revert") {
        await refreshWorkspaceFileDocuments(projectId);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "ChangeSet 操作失败");
      await load();
    } finally {
      setMutating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 p-8" data-desktop-no-drag onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section aria-modal="true" className="flex h-[min(760px,86vh)] w-[min(1080px,92vw)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <aside className="flex w-72 shrink-0 flex-col border-r border-zinc-200">
          <header className="flex h-16 items-center gap-2 border-b border-zinc-200 px-4"><FileDiff className="size-5" /><h2 className="font-medium">ChangeSets</h2></header>
          <OverlayScrollArea className="min-h-0 flex-1" contentKey={changeSets.map((entry) => `${entry.id}:${entry.status}`).join("|")} viewportClassName="h-full overflow-auto p-2">
            {changeSets.map((entry) => (
              <button className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${entry.id === selected?.id ? "bg-zinc-100" : "hover:bg-zinc-50"}`} key={entry.id} onClick={() => setSelectedId(entry.id)} type="button">
                <p className="truncate text-sm font-medium">{entry.title}</p><p className="mt-1 text-[11px] text-zinc-500">{statusLabel(entry.status)} · {entry.operations.length} 个文件操作</p>
              </button>
            ))}
            {!loading && changeSets.length === 0 ? <p className="p-5 text-center text-sm text-zinc-500">暂无 ChangeSet</p> : null}
          </OverlayScrollArea>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center border-b border-zinc-200 px-5">
            <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{selected?.title ?? "ChangeSet 审阅"}</h2><p className="text-xs text-zinc-500">{selected ? `${statusLabel(selected.status)} · ${selected.source === "agent" ? "Agent 提案" : "用户提案"}` : ""}</p></div>
            <button className="rounded p-1 hover:bg-zinc-100" onClick={onClose} aria-label="关闭"><X className="size-5" /></button>
          </header>
          {error ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mr-1 inline size-4" />{error}</p> : null}
          <OverlayScrollArea className="min-h-0 flex-1" contentKey={selected?.updatedAt} viewportClassName="h-full overflow-auto p-5">
            {loading ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin" /></div> : selected ? (
              <div className="space-y-4">
                {selected.description ? <p className="text-sm text-zinc-600">{selected.description}</p> : null}
                {selected.operations.map((operation) => <OperationDiff key={operation.id} operation={operation} />)}
                {selected.error ? <p className="rounded bg-amber-50 p-3 text-xs text-amber-800">{selected.error}</p> : null}
              </div>
            ) : null}
          </OverlayScrollArea>
          {selected ? (
            <footer className="flex items-center justify-end gap-2 border-t border-zinc-200 p-4">
              {(selected.status === "proposed" || selected.status === "approved") ? <button className="rounded-md px-3 py-2 text-sm text-red-700 hover:bg-red-50" disabled={mutating} onClick={() => void act("reject")} type="button">拒绝</button> : null}
              {selected.status === "proposed" ? <button className="flex items-center gap-1 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white" disabled={mutating} onClick={() => void act("approve")} type="button"><Check className="size-4" />整体批准</button> : null}
              {selected.status === "approved" ? <button className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white" disabled={mutating} onClick={() => void act("apply")} type="button">应用到 Workspace</button> : null}
              {selected.status === "applied" ? <button className="flex items-center gap-1 rounded-md border border-zinc-200 px-4 py-2 text-sm" disabled={mutating} onClick={() => void act("revert")} type="button"><RotateCcw className="size-4" />Revert</button> : null}
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function OperationDiff({ operation }: { operation: ChangeSetOperation }) {
  return <section className="overflow-hidden rounded-lg border border-zinc-200"><header className="flex items-center gap-2 bg-zinc-50 px-3 py-2 text-xs font-medium"><span className="rounded bg-white px-1.5 py-0.5 uppercase text-zinc-500">{operation.kind}</span><span>{operation.relativePath}{operation.targetRelativePath ? ` → ${operation.targetRelativePath}` : ""}</span></header><pre className="zenme-overlay-scroll-container max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5">{operationDiff(operation)}</pre></section>;
}

function operationDiff(operation: ChangeSetOperation) {
  if (operation.kind === "rename") return `rename ${operation.relativePath}\n    to ${operation.targetRelativePath}`;
  if (operation.kind === "delete") return (operation.beforeContent ?? "").split("\n").map((line) => `- ${line}`).join("\n");
  if (operation.kind === "create") return (operation.proposedContent ?? "").split("\n").map((line) => `+ ${line}`).join("\n");
  const before = (operation.beforeContent ?? "").split("\n");
  const after = (operation.proposedContent ?? "").split("\n");
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => before[index] === after[index] ? `  ${after[index] ?? ""}` : `${before[index] === undefined ? "" : `- ${before[index]}\n`}${after[index] === undefined ? "" : `+ ${after[index]}`}`).join("\n");
}

function statusLabel(status: WorkspaceChangeSet["status"]) {
  return ({ proposed: "待审阅", approved: "已批准", applying: "应用中", applied: "已应用", reverting: "回退中", rejected: "已拒绝", conflict: "冲突", reverted: "已回退" } as const)[status];
}
