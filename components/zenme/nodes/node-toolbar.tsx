"use client";

import {
  NodeToolbar,
  Position,
  type NodeToolbarProps,
} from "@xyflow/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function ZenmeNodeToolbar({
  children,
  className,
  offset = 12,
  position = Position.Top,
  ...props
}: NodeToolbarProps) {
  return (
    <NodeToolbar
      className={cn(
        "zenme-node-floating-control zenme-shadow-canvas nodrag nowheel z-30 flex max-w-[calc(100vw-48px)] items-center gap-1 overflow-hidden rounded-full border border-zinc-200 bg-white/95 p-1.5 text-zinc-600 backdrop-blur",
        className,
      )}
      offset={offset}
      position={position}
      {...props}
    >
      {children}
    </NodeToolbar>
  );
}

export function ZenmeNodeToolbarDivider() {
  return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-zinc-200" />;
}

export function ZenmeNodeToolbarButton({
  active = false,
  children,
  label,
  onPress,
}: {
  active?: boolean;
  children: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`flex size-7 items-center justify-center rounded-full transition hover:bg-zinc-100 hover:text-zinc-950 ${
        active ? "bg-zinc-950 text-white hover:bg-zinc-800 hover:text-white" : ""
      }`}
      onMouseDown={(event) => {
        event.preventDefault();
        onPress();
      }}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}
