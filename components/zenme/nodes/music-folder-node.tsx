"use client";

import type { NodeProps } from "@xyflow/react";
import { Folder, Maximize2, Minimize2, Music } from "lucide-react";
import { useState } from "react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";

export function MusicFolderNode({ data, id, selected }: NodeProps) {
  const node = data as CanvasNodeData;
  const [isRenaming, setIsRenaming] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const members = node.musicFolderMembers ?? [];
  const sources = node.musicFolderSources ?? [];
  const items = [...sources, ...members];
  const count = items.length;
  const expanded = Boolean(node.musicFolderExpanded);

  return (
    <NodeFrame
      className={`${expanded ? "w-[460px]" : "w-72 p-4"} ${isRenaming ? "zenme-node-renaming" : ""}`}
      selected={Boolean(selected)}
    >
      <EditableNodeTitle
        fallbackTitle="文件夹"
        icon={<Folder className="size-4" />}
        onCommit={(title) => node.onUpdateMusicNode?.(id, { title })}
        onEditingChange={setIsRenaming}
        title={node.title}
      />
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge)} />
      <NodeEdgeSourceHandle
        revealOnHover
        visible={Boolean(node.hasOutgoingEdge)}
      />
      {!expanded ? (
        <div
          className="zenme-node-drag-surface flex items-center gap-3 pr-10"
          onDoubleClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            node.onToggleMusicFolderExpanded?.(id, true);
          }}
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-amber-50 text-amber-600">
            <Folder className="size-6 fill-current" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{node.title || "文件夹"}</p>
            <p className="mt-1 truncate text-xs text-zinc-500">
              {count} 个项目
            </p>
          </div>
        </div>
      ) : (
        <div className="nowheel overflow-hidden rounded-xl">
          <header className="zenme-node-drag-surface flex h-12 items-center gap-2 border-b border-zinc-200 px-3 pr-12">
            <div
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600"
              title={node.musicFolderPath || node.title}
            >
              <Folder className="size-4 shrink-0 text-amber-500" />
              <span className="truncate">
                {node.musicFolderPath || `此画布  ›  ${node.title || "文件夹"}`}
              </span>
            </div>
            <span className="shrink-0 text-[11px] text-zinc-400">{count} 项</span>
          </header>
          <div className="nodrag flex h-8 items-center border-b border-zinc-200 px-4 text-[11px] text-zinc-400">
            <span className="min-w-0 flex-1">名称</span>
            <span className="w-20">类型</span>
            <span className="w-16 text-right">大小</span>
          </div>
          <OverlayScrollArea
            className="zenme-node-drag-surface nowheel"
            contentKey={items.map((item) => item.id).join("|")}
            onClick={() => setSelectedItemId(null)}
            viewportClassName="h-60 overflow-y-auto"
          >
            {items.length ? (
              <ul aria-label="文件夹内容" className="px-2 py-1" role="listbox">
                {items.map((item) => (
                  <li
                    aria-selected={selectedItemId === item.id}
                    className={`nodrag flex h-9 items-center gap-2 rounded-md px-2 text-xs ${
                      selectedItemId === item.id
                        ? "bg-zinc-200 text-zinc-950"
                        : "hover:bg-zinc-100"
                    }`}
                    key={item.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedItemId(item.id);
                    }}
                    role="option"
                    title={item.fileName || item.title}
                  >
                    <Music className="size-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate">{item.fileName || item.title}</span>
                    <span className="w-20 shrink-0 truncate text-[11px] text-zinc-400">
                      {getFileType(item.fileName, item.mimeType)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-zinc-400">
                      {formatBytes(item.fileSize)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex h-full min-h-60 flex-col items-center justify-center text-zinc-400">
                <Folder className="mb-3 size-10 text-amber-300" />
                <p className="text-xs">此文件夹为空</p>
                <p className="mt-1 text-[11px]">将画布中的音乐拖到这里</p>
              </div>
            )}
          </OverlayScrollArea>
        </div>
      )}
      <div
        className={`zenme-text-node-floating-actions nodrag absolute z-30 flex items-center gap-1 ${
          expanded ? "right-3 top-2.5" : "right-3 top-1/2 -translate-y-1/2"
        }`}
      >
        <button
          aria-expanded={expanded}
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/80 text-zinc-400 opacity-55 backdrop-blur transition hover:bg-zinc-100 hover:text-zinc-900 hover:opacity-100 focus-visible:bg-zinc-100 focus-visible:text-zinc-900 focus-visible:opacity-100"
          onClick={() => node.onToggleMusicFolderExpanded?.(id, !expanded)}
          title={expanded ? "收起文件夹" : "展开文件夹"}
          type="button"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </div>
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function getFileType(fileName?: string, mimeType?: string) {
  const extension = fileName?.match(/\.([^.]+)$/)?.[1]?.toUpperCase();
  return extension ? `${extension} 音频` : mimeType?.startsWith("audio/") ? "音频" : "文件";
}

function formatBytes(bytes?: number) {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
