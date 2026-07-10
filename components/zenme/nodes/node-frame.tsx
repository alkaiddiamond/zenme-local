"use client";

import type { ReactNode } from "react";

type NodeFrameProps = {
  children: ReactNode;
  className: string;
  selected?: boolean;
};

export function NodeFrame({ children, className, selected }: NodeFrameProps) {
  return (
    <div
      className={`group relative rounded-xl border bg-white text-zinc-950 shadow-xl ${
        selected ? "border-zinc-900" : "border-zinc-200"
      } ${className}`}
    >
      {children}
    </div>
  );
}
