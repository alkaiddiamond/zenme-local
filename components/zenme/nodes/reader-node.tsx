"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { BookOpen, Maximize2 } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import {
  NodeActionHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { ReadingWorkspace } from "@/components/zenme/reading-workspace";

export function ReaderNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const isCollapsed = Boolean(nodeData.readerCollapsed);
  const readerBookTitle =
    nodeData.title.replace(/^阅读[:：]\s*/, "") || "阅读资料";

  if (isCollapsed) {
    return (
      <NodeFrame className="w-72 p-4" selected={Boolean(selected)}>
        <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
        <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
        <NodeContextTargetHandle />
        <div className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-500">
          <span className="zenme-node-title-icon-hitbox">
            <BookOpen className="size-4" />
          </span>
          阅读器
        </div>
        <div className="flex gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-600">
            <BookOpen className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-normal text-zinc-950">
              {readerBookTitle}
            </p>
            <p className="mt-1 truncate text-xs text-zinc-500">
              阅读器节点已收起
            </p>
          </div>
          <button
            aria-label="展开阅读器"
            className="nodrag flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            onClick={(event) => {
              event.stopPropagation();
              nodeData.onToggleReaderCollapse?.(id);
            }}
            title="展开阅读器"
            type="button"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
        <NodeActionHandle selected={Boolean(selected)} />
      </NodeFrame>
    );
  }

  return (
    <div className="zenme-reader-node group relative h-full w-full rounded-xl bg-white text-zinc-950">
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextTargetHandle />
      <div className="absolute inset-0 z-0">
        {nodeData.readingAssetId && nodeData.projectId ? (
          <ReadingWorkspace
            assetId={nodeData.readingAssetId}
            key={`${nodeData.projectId}:${nodeData.readingAssetId}`}
            nodeMode
            onCreateNoteNode={(note, asset) =>
              nodeData.onCreateNoteNode?.(note, asset, id)
            }
            onToggleCollapse={() => nodeData.onToggleReaderCollapse?.(id)}
            projectId={nodeData.projectId}
          />
        ) : (
          <div className="h-[240px] w-[360px] rounded-xl border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium text-zinc-500">
              <span className="zenme-node-title-icon-hitbox">
                <BookOpen className="size-4" />
              </span>
              阅读界面
            </div>
            <p className="text-sm font-medium text-zinc-950">
              {nodeData.title}
            </p>
            <p className="mt-2 text-xs leading-5 text-red-600">
              该阅读器节点缺少阅读资料，请从图书节点重新打开。
            </p>
          </div>
        )}
      </div>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-reader-resize-handle"
        isVisible
        lineClassName="zenme-reader-resize-line"
        minHeight={420}
        minWidth={680}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
}
