"use client";

import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
import { Loader2 } from "lucide-react";

import type { ReadingLoadProgress } from "./api";

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
          ? "zenme-reader-workspace zenme-shadow-node h-full w-full rounded-xl border-zinc-200"
          : "zenme-shadow-overlay absolute inset-4 z-30 rounded-xl border-zinc-200"
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

export function ReadingWorkspaceLoadingState({
  progress,
}: {
  progress: ReadingLoadProgress;
}) {
  const hasTotal = progress.totalBytes !== null && progress.totalBytes > 0;
  const percent = hasTotal
    ? Math.min(
        100,
        Math.round((progress.loadedBytes / progress.totalBytes!) * 100),
      )
    : null;
  const parsing = progress.phase === "parsing";
  const label = parsing
    ? `下载完成，正在解析${formatReadingBytes(progress.loadedBytes)}内容`
    : percent !== null
      ? `正在加载内容 ${percent}% · ${formatReadingBytes(progress.loadedBytes)} / ${formatReadingBytes(progress.totalBytes!)}`
      : `正在加载内容 · 已接收 ${formatReadingBytes(progress.loadedBytes)}`;

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-zinc-500">
      <div className="flex w-full max-w-sm flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span>{label}</span>
        </div>
        <div
          aria-label={label}
          aria-valuemax={percent === null ? undefined : 100}
          aria-valuenow={parsing ? undefined : percent ?? undefined}
          className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200"
          role="progressbar"
        >
          <div
            className={`h-full rounded-full bg-zinc-950 transition-[width] duration-150 ${
              percent === null || parsing ? "animate-pulse" : ""
            }`}
            style={{
              width: parsing
                ? "100%"
                : percent === null
                  ? "35%"
                  : `${percent}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

function formatReadingBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
