"use client";

import type { NodeProps } from "@xyflow/react";
import { AlertTriangle, FileCode2, Loader2, LockKeyhole, RotateCcw, Save } from "lucide-react";
import { useState } from "react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import {
  NodeActionHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { useWorkspaceFileDocument } from "@/components/zenme/workspace-file-document-store";
import { createWorkspaceChangeSetFromApi } from "@/lib/zenme-api";

export function WorkspaceFileNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const state = useWorkspaceFileDocument(
    nodeData.projectId,
    nodeData.workspaceFileDocumentId,
  );
  const view = state.view;
  const [showDiff, setShowDiff] = useState(false);
  const [proposalStatus, setProposalStatus] = useState("");
  const relativePath = view?.document.relativePath ?? nodeData.workspaceRelativePath ?? nodeData.title;

  return (
    <NodeFrame className="flex h-full w-full flex-col overflow-hidden" selected={Boolean(selected)}>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-3">
        <FileCode2 className="size-4 text-zinc-500" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{relativePath}</p>
          <p className="truncate text-[11px] text-zinc-500">
            {fileStatusLabel(state.loading, state.error, view?.contentKind, view?.change, view?.writable)}
          </p>
        </div>
        {view?.gitStatus ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            Git {view.gitStatus}
          </span>
        ) : null}
        {view?.sensitive ? <LockKeyhole className="size-4 text-amber-600" aria-label="敏感文件" /> : null}
      </div>
      {view?.contentKind === "text" ? (
        <div className="nodrag flex items-center gap-2 border-b border-zinc-200 px-3 py-2 text-[11px]">
          <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40" disabled={!view.writable || !state.dirty || state.conflict || state.saving} onClick={() => void state.save()} type="button"><Save className="size-3" />{state.saving ? "保存中" : "保存"}</button>
          <button
            className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40"
            disabled={!state.dirty || state.conflict || !nodeData.projectId || !nodeData.workspaceFileDocumentId}
            onClick={() => {
              if (!nodeData.projectId || !nodeData.workspaceFileDocumentId) return;
              setProposalStatus("创建中…");
              void createWorkspaceChangeSetFromApi(nodeData.projectId, {
                title: `修改 ${relativePath}`,
                operations: [{
                  fileDocumentId: nodeData.workspaceFileDocumentId,
                  kind: "modify",
                  proposedContent: state.buffer,
                  relativePath,
                }],
              }).then(() => setProposalStatus("已创建 ChangeSet"))
                .catch((error) => setProposalStatus(error instanceof Error ? error.message : "创建失败"));
            }}
            type="button"
          >
            提交 ChangeSet
          </button>
          <button className="rounded px-2 py-1 hover:bg-zinc-100" disabled={!state.dirty} onClick={() => setShowDiff((value) => !value)} type="button">{showDiff ? "编辑" : "Diff"}</button>
          <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-100" disabled={!state.dirty} onClick={state.revert} type="button"><RotateCcw className="size-3" />Revert</button>
          <span className="ml-auto text-zinc-500">{proposalStatus || (state.conflict ? "外部冲突" : state.dirty ? "未保存" : view.writable ? "已同步" : "只读")}</span>
        </div>
      ) : null}
      {state.conflict ? (
        <div className="nodrag flex items-center gap-2 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <AlertTriangle className="size-3.5" />磁盘内容已变化。
          <button className="underline" onClick={state.reload} type="button">Reload</button>
          <button className="underline" onClick={state.keepMine} type="button">Keep Mine</button>
        </div>
      ) : null}
      <OverlayScrollArea
        className="min-h-0 flex-1 bg-zinc-50"
        contentKey={`${view?.document.relativePath ?? ""}:${view?.modifiedAt ?? ""}:${view?.contentKind ?? ""}`}
        viewportClassName="nodrag nowheel h-full overflow-auto p-4"
      >
        {state.loading && !view ? (
          <div className="flex h-full items-center justify-center text-zinc-400"><Loader2 className="size-5 animate-spin" /></div>
        ) : state.error ? (
          <StatusMessage icon={<AlertTriangle className="size-5" />} text={state.error} />
        ) : view?.contentKind === "text" && showDiff ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-800">{createSimpleDiff(state.baselineContent, state.buffer)}</pre>
        ) : view?.contentKind === "text" && view.writable ? (
          <textarea
            aria-label={`编辑 ${relativePath}`}
            className="zenme-overlay-scroll-container min-h-full w-full resize-none bg-transparent font-mono text-xs leading-5 text-zinc-800 outline-none"
            onChange={(event) => state.edit(event.target.value)}
            spellCheck={false}
            value={state.buffer}
          />
        ) : view?.contentKind === "text" ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-zinc-800">{state.buffer}</pre>
        ) : (
          <StatusMessage
            icon={<AlertTriangle className="size-5" />}
            text={view?.contentKind === "large" ? "文件超过 1 MiB，未加载正文" : view?.contentKind === "binary" ? "二进制或非 UTF-8 文件，未加载正文" : "文件已被删除或移动后无法识别"}
          />
        )}
      </OverlayScrollArea>
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function StatusMessage({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-zinc-500">{icon}<span>{text}</span></div>;
}

function fileStatusLabel(
  loading: boolean,
  error: string | null,
  contentKind?: string,
  change?: string,
  writable?: boolean,
) {
  if (loading) return "正在读取工作区文件…";
  if (error) return "文件状态不可用";
  if (change === "modified") return "检测到外部修改";
  if (change === "renamed") return "检测到外部重命名";
  if (contentKind === "missing") return "文件不存在";
  return writable ? "可编辑 · 保存到磁盘" : "只读 · 与磁盘同步";
}

function createSimpleDiff(before: string, after: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const length = Math.max(beforeLines.length, afterLines.length);
  const output: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const previous = beforeLines[index];
    const next = afterLines[index];
    if (previous === next) {
      if (next !== undefined) output.push(`  ${next}`);
    } else {
      if (previous !== undefined) output.push(`- ${previous}`);
      if (next !== undefined) output.push(`+ ${next}`);
    }
  }
  return output.join("\n") || "无变更";
}
