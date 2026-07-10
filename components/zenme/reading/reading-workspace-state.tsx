"use client";

import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import { Loader2 } from "lucide-react";

type ReadingWorkspaceShellProps = {
  children: ReactNode;
  nodeMode: boolean;
  onAuxClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseDownCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onWheelCapture: (event: ReactWheelEvent<HTMLDivElement>) => void;
  workspaceRef: RefObject<HTMLDivElement | null>;
};

export function ReadingWorkspaceShell({
  children,
  nodeMode,
  onAuxClickCapture,
  onMouseDownCapture,
  onWheelCapture,
  workspaceRef,
}: ReadingWorkspaceShellProps) {
  return (
    <div
      className={`relative isolate flex flex-col overflow-hidden border bg-white text-zinc-950 ${
        nodeMode
          ? "zenme-reader-workspace h-full w-full rounded-xl border-zinc-200 shadow-xl"
          : "absolute inset-4 z-30 rounded-2xl border-zinc-200 shadow-2xl"
      }`}
      onAuxClickCapture={onAuxClickCapture}
      onMouseDownCapture={onMouseDownCapture}
      onWheelCapture={onWheelCapture}
      ref={workspaceRef}
    >
      {children}
    </div>
  );
}

export function ReadingWorkspaceErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-red-600">
      {message}
    </div>
  );
}

export function ReadingWorkspaceLoadingState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
      <Loader2 className="size-4 animate-spin" />
      正在打开阅读界面
    </div>
  );
}

export function ReadingResizeGuides({
  notesDraftWidth,
  tocCollapsed,
  tocDraftWidth,
}: {
  notesDraftWidth: number | null;
  tocCollapsed: boolean;
  tocDraftWidth: number | null;
}) {
  return (
    <>
      {tocDraftWidth !== null && !tocCollapsed ? (
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-zinc-400"
          style={{ left: tocDraftWidth }}
        />
      ) : null}
      {notesDraftWidth !== null ? (
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-zinc-400"
          style={{ right: notesDraftWidth }}
        />
      ) : null}
    </>
  );
}
