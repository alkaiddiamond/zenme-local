"use client";

import { FileCode2, Folder, Loader2, LockKeyhole, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getWorkspaceBindingFromApi, getWorkspaceFilesFromApi, openWorkspaceFileFromApi } from "@/lib/zenme-api";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import type { WorkspaceFileDocumentView, WorkspaceFileEntry } from "@/lib/workspace/file-document-types";

export function WorkspaceFilePicker({
  onClose,
  onPick,
  projectId,
}: {
  onClose: () => void;
  onPick: (view: WorkspaceFileDocumentView) => void;
  projectId: string;
}) {
  const [entries, setEntries] = useState<WorkspaceFileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openingPath, setOpeningPath] = useState("");
  const [rootNames, setRootNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    getWorkspaceBindingFromApi(projectId)
      .then(async (binding) => {
        if (!binding) throw new Error("Workspace 未绑定");
        const roots = [
          { id: binding.id, displayName: binding.displayName, status: binding.status, permissions: binding.permissions },
          ...(binding.additionalRoots ?? []),
        ].filter((root) => root.status === "resolved" && root.permissions.read);
        const results = await Promise.all(roots.map(async (root) => ({
          root,
          entries: (await getWorkspaceFilesFromApi(projectId, root.id)).entries,
        })));
        if (active) {
          setEntries(results.flatMap((result) => result.entries));
          setRootNames(Object.fromEntries(results.map(({ root }) => [root.id, root.displayName])));
        }
      })
      .catch((nextError) => { if (active) setError(nextError instanceof Error ? nextError.message : "文件加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => !normalized || entry.relativePath.toLocaleLowerCase().includes(normalized));
  }, [entries, query]);

  async function pick(entry: WorkspaceFileEntry) {
    if (entry.kind !== "file" || openingPath) return;
    const openingKey = `${entry.rootId}:${entry.relativePath}`;
    setOpeningPath(openingKey);
    setError("");
    try {
      onPick(await openWorkspaceFileFromApi(projectId, entry.relativePath, entry.rootId));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "文件打开失败");
      setOpeningPath("");
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex h-[min(680px,82vh)] w-[min(760px,88vw)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4">
          <Folder className="size-5 text-zinc-500" />
          <div className="flex-1"><h2 className="text-sm font-semibold">从 Workspace 打开文件</h2><p className="text-xs text-zinc-500">创建 Live File 节点；磁盘是已保存内容的真相源。</p></div>
          <button className="rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={onClose} aria-label="关闭"><X className="size-5" /></button>
        </header>
        <div className="m-4 flex items-center gap-2 rounded-lg border border-zinc-200 px-3">
          <Search className="size-4 text-zinc-400" />
          <input className="h-10 flex-1 bg-transparent text-sm outline-none" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索相对路径" autoFocus />
        </div>
        {error ? <p className="mx-4 mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        <OverlayScrollArea
          className="min-h-0 flex-1"
          contentKey={`${query}:${visible.length}:${openingPath}`}
          viewportClassName="h-full overflow-auto px-3 pb-4"
        >
          {loading ? <div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-zinc-400" /></div> : visible.map((entry) => (
            <button
              key={`${entry.rootId}:${entry.kind}:${entry.relativePath}`}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${entry.kind === "file" ? "hover:bg-zinc-100" : "cursor-default text-zinc-500"}`}
              disabled={entry.kind !== "file" || Boolean(openingPath)}
              onClick={() => void pick(entry)}
              style={{ paddingLeft: `${12 + Math.max(0, entry.relativePath.split("/").length - 1) * 14}px` }}
            >
              {entry.kind === "directory" ? <Folder className="size-4" /> : <FileCode2 className="size-4" />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              <span className="max-w-28 truncate text-[11px] text-zinc-400" title={rootNames[entry.rootId]}>{rootNames[entry.rootId]}</span>
              {entry.sensitive ? <LockKeyhole className="size-4 text-amber-600" /> : null}
              {openingPath === `${entry.rootId}:${entry.relativePath}` ? <Loader2 className="size-4 animate-spin" /> : null}
            </button>
          ))}
          {!loading && visible.length === 0 ? <p className="py-12 text-center text-sm text-zinc-500">没有匹配的文件</p> : null}
        </OverlayScrollArea>
      </section>
    </div>
  );
}
