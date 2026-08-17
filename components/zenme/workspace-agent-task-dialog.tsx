"use client";

import { Bot, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { AiModelOption } from "@/components/zenme/use-ai-model-options";

export function WorkspaceAgentTaskDialog({
  models,
  onClose,
  onSubmit,
  sourceTitle,
}: {
  models: AiModelOption[];
  onClose: () => void;
  onSubmit: (instruction: string, model: string) => Promise<void>;
  sourceTitle?: string;
}) {
  const [instruction, setInstruction] = useState("");
  const [model, setModel] = useState(models[0]?.id ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!model && models[0]?.id) setModel(models[0].id); }, [model, models]);

  async function submit() {
    if (!instruction.trim() || !model || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(instruction.trim(), model);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Agent 任务创建失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/25 p-6" data-desktop-no-drag onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) onClose(); }}>
      <section aria-modal="true" className="w-[min(640px,90vw)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl" role="dialog">
        <header className="flex items-center gap-3 border-b border-zinc-200 px-5 py-4">
          <Bot className="size-5 text-zinc-600" />
          <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">运行 Workspace Agent</h2><p className="truncate text-xs text-zinc-500">上下文节点：{sourceTitle || "当前画布"}</p></div>
          <button aria-label="关闭" className="rounded p-1 hover:bg-zinc-100" disabled={submitting} onClick={onClose} type="button"><X className="size-5" /></button>
        </header>
        <div className="space-y-4 p-5">
          <textarea autoFocus className="h-40 w-full resize-none rounded-xl border border-zinc-200 p-3 text-sm outline-none focus:border-zinc-500" onChange={(event) => setInstruction(event.target.value)} placeholder="例如：分析当前实现，修复文件保存冲突，并创建可审阅的 ChangeSet。" value={instruction} />
          <label className="block text-xs text-zinc-500">模型
            <select className="mt-1 h-10 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm" onChange={(event) => setModel(event.target.value)} value={model}>
              {models.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Agent 只能读取 Workspace 并创建 ChangeSet；测试命令会暂停，等待你逐条批准。</p>
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        </div>
        <footer className="flex justify-end gap-2 border-t border-zinc-200 p-4">
          <button className="rounded-lg px-4 py-2 text-sm hover:bg-zinc-100" disabled={submitting} onClick={onClose} type="button">取消</button>
          <button className="flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={!instruction.trim() || !model || submitting} onClick={() => void submit()} type="button">{submitting ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}开始执行</button>
        </footer>
      </section>
    </div>
  );
}
