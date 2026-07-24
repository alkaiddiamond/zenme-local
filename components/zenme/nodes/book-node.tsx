"use client";

import type { NodeProps } from "@xyflow/react";
import { Book } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import {
  NodeActionHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";

export function BookNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;

  return (
    <NodeFrame className="w-72 p-4" selected={Boolean(selected)}>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextTargetHandle />
      <div className="zenme-node-title-bar absolute -top-7 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <Book className="size-4" />
        </span>
        书籍
      </div>
      <div className="flex gap-3">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-600">
          {nodeData.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={nodeData.title}
              className="h-full w-full object-cover"
              src={nodeData.coverUrl}
            />
          ) : (
            <Book className="size-6" />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-normal text-zinc-950">
            {nodeData.title}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {nodeData.fileName ?? "阅读资料"}
          </p>
          {nodeData.readingError ? (
            <p className="mt-2 line-clamp-2 text-xs leading-4 text-red-600">
              {nodeData.readingError}
            </p>
          ) : null}
        </div>
      </div>
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}
