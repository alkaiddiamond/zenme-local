"use client";

import type { NodeProps } from "@xyflow/react";
import { Quote } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import {
  NodeActionHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { TextNodeComposer } from "@/components/zenme/nodes/text-node-composer";

export function NoteNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;

  return (
    <NodeFrame className="w-80 p-4" selected={Boolean(selected)}>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextTargetHandle />
      <div className="absolute -top-7 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox zenme-note-node-drag-handle">
          <Quote className="size-4" />
        </span>
        阅读笔记
      </div>
      <p className="text-sm font-normal text-zinc-950">{nodeData.title}</p>
      <p className="nodrag nowheel mt-2 select-text rounded-md bg-zinc-50 px-3 py-2 text-sm leading-6 text-zinc-700">
        {nodeData.selectedText}
      </p>
      {nodeData.comment ? (
        <p className="nodrag nowheel mt-3 select-text rounded-md bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-500">
          {nodeData.comment}
        </p>
      ) : null}
      <p className="mt-3 truncate text-xs text-zinc-400">
        {nodeData.sourceBookTitle}
        {nodeData.chapterTitle ? ` · ${nodeData.chapterTitle}` : ""}
      </p>
      {selected ? <TextNodeComposer nodeData={nodeData} nodeId={id} /> : null}
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}
