"use client";

import type { NodeProps } from "@xyflow/react";
import { Group as GroupIcon } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";

export function GroupNode({ data, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;

  return (
    <div
      className={`pointer-events-none relative h-full w-full rounded-xl border bg-zinc-50/35 text-zinc-950 ${
        selected ? "border-zinc-900" : "border-zinc-200"
      }`}
    >
      <div className="pointer-events-auto absolute -top-7 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <GroupIcon className="size-4 shrink-0 text-zinc-500" />
        </span>
        <span className="truncate">{nodeData.title || "新建组"}</span>
      </div>
      <div className="pointer-events-auto absolute inset-x-0 -top-2 h-4" />
      <div className="pointer-events-auto absolute inset-x-0 -bottom-2 h-4" />
      <div className="pointer-events-auto absolute inset-y-0 -left-2 w-4" />
      <div className="pointer-events-auto absolute inset-y-0 -right-2 w-4" />
    </div>
  );
}
