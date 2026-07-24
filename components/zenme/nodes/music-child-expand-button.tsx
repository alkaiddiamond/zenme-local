"use client";

import { Maximize2, Minimize2 } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { cn } from "@/lib/utils";

export function MusicChildExpandButton({
  className,
  node,
  nodeId,
}: {
  className?: string;
  node: CanvasNodeData;
  nodeId: string;
}) {
  const expanded = Boolean(node.musicChildExpanded);

  return (
    <button
      aria-expanded={expanded}
      className={cn(
        "nodrag absolute right-3 top-3 z-20 flex size-7 items-center justify-center rounded-md bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-900",
        className,
      )}
      onClick={() => node.onToggleMusicChildExpanded?.(nodeId, !expanded)}
      title={expanded ? "收起为初始尺寸" : "展开为 A4 阅读面板"}
      type="button"
    >
      {expanded ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
    </button>
  );
}
