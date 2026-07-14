"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { WandSparkles } from "lucide-react";
import { useState } from "react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { MusicJobStatus, useMusicJob } from "@/components/zenme/nodes/use-music-job";

export function SunoPromptNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const [isRenaming, setIsRenaming] = useState(false);
  useMusicJob(id, node);

  return (
    <NodeFrame className={`flex h-full min-h-[280px] w-full min-w-[420px] flex-col p-4 ${isRenaming ? "zenme-node-renaming" : ""}`} selected={Boolean(selected)}>
      <EditableNodeTitle fallbackTitle="Suno 提示词" icon={<WandSparkles className="size-4" />} onCommit={(title) => node.onUpdateMusicNode?.(id, { title })} onEditingChange={setIsRenaming} title={node.title} />
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge || node.musicParentPlayerNodeId)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <p className="text-xs text-zinc-500">播放器生成提示词</p>
      <MusicJobStatus node={node} nodeId={id} />
      <div className="nodrag nowheel mt-3 min-h-0 flex-1 space-y-4 overflow-auto pr-1">
        <section>
          <p className="text-xs text-zinc-500">中文</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{node.sunoPromptZh || "等待分析结果"}</p>
        </section>
        <section>
          <p className="text-xs text-zinc-500">English</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{node.sunoPromptEn || "Waiting for analysis"}</p>
        </section>
      </div>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected)}
        lineClassName="zenme-text-resize-line"
        minHeight={280}
        minWidth={420}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}
