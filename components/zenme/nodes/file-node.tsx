"use client";

import type { NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import {
  NodeActionHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";

export function FileNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;

  return (
    <NodeFrame
      className="flex w-64 items-center gap-3 p-3"
      selected={Boolean(selected)}
    >
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <div className="flex size-10 items-center justify-center rounded-md bg-zinc-100">
        <FileText className="size-5 text-zinc-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{nodeData.title}</p>
      </div>
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}
