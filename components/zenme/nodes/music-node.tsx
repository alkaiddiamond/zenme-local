"use client";

import type { NodeProps } from "@xyflow/react";
import { Music } from "lucide-react";
import { useState } from "react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";

export function MusicNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const [isRenaming, setIsRenaming] = useState(false);
  return (
    <NodeFrame className={`h-28 w-[360px] p-4 ${isRenaming ? "zenme-node-renaming" : ""}`} selected={Boolean(selected)}>
      <EditableNodeTitle fallbackTitle="音乐" icon={<Music className="size-4" />} onCommit={(title) => node.onUpdateMusicNode?.(id, { title })} onEditingChange={setIsRenaming} title={node.title} />
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-100"><Music className="size-5" /></div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{node.fileName || "本地音乐"}</p>
          <div className="mt-2 flex items-center gap-3 text-[11px] text-zinc-400">
            {node.musicDuration ? <span>{formatTime(node.musicDuration)}</span> : null}
            {node.fileSize ? <span>{formatBytes(node.fileSize)}</span> : null}
            {node.mimeType ? <span className="truncate">{node.mimeType}</span> : null}
          </div>
        </div>
      </div>
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
