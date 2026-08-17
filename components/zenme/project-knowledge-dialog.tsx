"use client";

import { AlertTriangle, Database, Loader2, Pause, Play, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import type { KnowledgeSearchResponse } from "@/lib/knowledge/types";
import { getProjectKnowledgeStatusFromApi, searchProjectKnowledgeFromApi, type ProjectKnowledgeStatus, updateProjectKnowledgeFromApi } from "@/lib/zenme-api";

export function ProjectKnowledgeDialog({ onClose, projectId }: { onClose: () => void; projectId: string }) {
  const [status, setStatus] = useState<ProjectKnowledgeStatus | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchResponse | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [cloudAuthorized, setCloudAuthorized] = useState(false);
  const load = useCallback(async () => { try {
    const next = await getProjectKnowledgeStatusFromApi(projectId);
    setStatus(next);
    setEmbeddingModel((current) => {
      if (next.embeddingOptions.some((option) => option.id === current)) return current;
      if (next.embeddingProvider && next.embeddingOptions.some((option) => option.id === next.embeddingProvider?.id)) return next.embeddingProvider.id;
      return next.embeddingOptions[0]?.id ?? "";
    });
    setError("");
  } catch (nextError) { setError(message(nextError)); } }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function act(action: "rebuild" | "pause" | "resume" | "clear") {
    if (busy) return; setBusy(action); setError("");
    const selectedOption = status?.embeddingOptions.find((option) => option.id === embeddingModel);
    if (action === "rebuild" && selectedOption?.kind === "cloud" && !cloudAuthorized) {
      setBusy("");
      setError("使用云端 Embedding 前，请确认允许发送已排除敏感文件的项目文本分块与检索词。");
      return;
    }
    try { await updateProjectKnowledgeFromApi(projectId, action, action === "rebuild" ? {
      force: true,
      embeddingModel,
      cloudAuthorized: selectedOption?.kind === "cloud" && cloudAuthorized,
    } : {}); setResults(null); await load(); }
    catch (nextError) { setError(message(nextError)); }
    finally { setBusy(""); }
  }
  async function search() {
    if (!query.trim() || busy) return; setBusy("search"); setError("");
    try { setResults(await searchProjectKnowledgeFromApi(projectId, query.trim(), { limit: 30, budgetCharacters: 80_000 })); }
    catch (nextError) { setError(message(nextError)); }
    finally { setBusy(""); }
  }
  const selectedOption = status?.embeddingOptions.find((option) => option.id === embeddingModel);
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 p-8" data-desktop-no-drag onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section aria-modal="true" className="flex h-[min(760px,88vh)] w-[min(980px,94vw)] flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl" role="dialog"><header className="flex h-16 items-center gap-3 border-b border-zinc-200 px-5"><Database className="size-5" /><div className="flex-1"><h2 className="text-sm font-semibold">Project Knowledge</h2><p className="text-xs text-zinc-500">可删除、可重建的本地知识图谱与向量索引</p></div><button aria-label="关闭" className="rounded p-1 hover:bg-zinc-100" onClick={onClose} type="button"><X className="size-5" /></button></header><div className="border-b border-zinc-200 p-4"><div className="flex flex-wrap items-center gap-2 text-xs"><StatusCard label="状态" value={statusLabel(status?.status)} /><StatusCard label="实体 / 关系" value={`${status?.entities ?? 0} / ${status?.edges ?? 0}`} /><StatusCard label="向量块" value={String(status?.chunks ?? 0)} /><StatusCard label="磁盘" value={formatBytes(status?.diskBytes ?? 0)} /><StatusCard label="Embedding" value={status?.embeddingProvider?.id ?? "未构建"} /><span className="ml-auto flex gap-1"><button className="flex items-center gap-1 rounded-md border border-zinc-200 px-2.5 py-1.5 hover:bg-zinc-50 disabled:opacity-50" disabled={Boolean(busy) || !embeddingModel} onClick={() => void act("rebuild")} type="button"><RefreshCw className="size-3.5" />{status?.status === "missing" ? "构建" : "增量重建"}</button>{status?.status === "paused" ? <button className="flex items-center gap-1 rounded-md border px-2.5 py-1.5" disabled={Boolean(busy)} onClick={() => void act("resume")} type="button"><Play className="size-3.5" />恢复</button> : <button className="flex items-center gap-1 rounded-md border px-2.5 py-1.5" disabled={Boolean(busy) || status?.status === "missing"} onClick={() => void act("pause")} type="button"><Pause className="size-3.5" />暂停</button>}<button className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-red-700 hover:bg-red-50" disabled={Boolean(busy) || status?.status === "missing"} onClick={() => void act("clear")} type="button"><Trash2 className="size-3.5" />清除</button></span></div><p className="mt-2 text-[11px] text-zinc-500">敏感文件排除 {status?.ignoredSensitiveFiles ?? 0} 个 · 复用向量块 {status?.reusedChunks ?? 0} 个 · 索引不进入普通备份，也不是项目真相源。</p><div className="mt-3 flex items-start gap-3 rounded-lg bg-zinc-50 p-3"><label className="min-w-0 flex-1 text-xs text-zinc-600">Embedding 模型<select className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-800" onChange={(event) => { setEmbeddingModel(event.target.value); setCloudAuthorized(false); }} value={embeddingModel}>{status?.embeddingOptions.map((option) => <option key={option.id} value={option.id}>{option.label} · {option.kind === "local" ? "本地" : "云端"}</option>)}</select><span className="mt-1 block text-[11px] text-zinc-500">{selectedOption?.disclosure}</span></label>{selectedOption?.kind === "cloud" ? <label className="mt-5 flex max-w-72 items-start gap-2 text-[11px] leading-4 text-zinc-600"><input checked={cloudAuthorized} className="mt-0.5" onChange={(event) => setCloudAuthorized(event.target.checked)} type="checkbox" />允许向该服务发送已排除敏感文件的文本分块与检索词</label> : null}</div><div className="mt-3 flex gap-2"><div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /><input className="h-10 w-full rounded-lg border border-zinc-200 pl-9 pr-3 text-sm" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} placeholder="搜索文件、符号、决策、任务或历史变更" value={query} /></div><button className="w-24 rounded-lg bg-zinc-900 text-sm text-white disabled:opacity-50" disabled={!query.trim() || Boolean(busy) || status?.status !== "ready"} onClick={() => void search()} type="button">{busy === "search" ? <Loader2 className="mx-auto size-4 animate-spin" /> : "混合检索"}</button></div></div>{error ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><AlertTriangle className="mr-1 inline size-4" />{error}</p> : null}<OverlayScrollArea className="min-h-0 flex-1" contentKey={`${results?.query}:${results?.indexUpdatedAt}`} viewportClassName="h-full overflow-auto p-4">{results ? <div className="space-y-3"><p className="text-xs text-zinc-500">{results.results.length} 条结果 · 上下文 {results.consumedCharacters.toLocaleString()} / {results.budgetCharacters.toLocaleString()} 字符 · {results.embeddingProvider.kind === "local" ? "完全本地" : "云端"}</p>{results.results.map((result) => <article className="rounded-xl border border-zinc-200 p-3" key={result.entity.id}><div className="flex items-center gap-2"><span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-500">{result.entity.kind}</span><h3 className="min-w-0 flex-1 truncate text-sm font-medium">{result.entity.title}</h3><span className="text-xs tabular-nums text-zinc-500">{result.score.toFixed(3)}</span></div>{result.entity.relativePath ? <p className="mt-1 font-mono text-[11px] text-zinc-500">{result.entity.relativePath}</p> : null}<p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-zinc-700">{result.matchedChunk?.text ?? result.entity.text.slice(0, 800)}</p><p className="mt-2 text-[10px] text-zinc-500">{result.evidence.join(" · ")} · sha256:{result.entity.contentHash.slice(0, 12)}…</p></article>)}</div> : <div className="flex h-full items-center justify-center text-sm text-zinc-500">{status?.status === "missing" ? "先构建索引，再进行可解释检索。" : "输入目标，查看路径、关键词、图关系和向量共同召回的依据。"}</div>}</OverlayScrollArea></section></div>;
}
function StatusCard({ label, value }: { label: string; value: string }) { return <span className="rounded-md bg-zinc-100 px-2 py-1"><span className="text-zinc-500">{label}</span> {value}</span>; }
function statusLabel(status?: ProjectKnowledgeStatus["status"]) { return ({ missing: "未构建", ready: "就绪", paused: "已暂停", error: "错误" } as const)[status ?? "missing"]; }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1024 ** 2).toFixed(1)} MiB`; }
function message(error: unknown) { return error instanceof Error ? error.message : "Project Knowledge 操作失败"; }
