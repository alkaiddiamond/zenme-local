"use client";

import { GripHorizontal, X } from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { MusicLyricLine } from "@/components/zenme/node-types";

export type MusicLyricsOverlayPosition = { x: number; y: number };

type MusicLyricsOverlayProps = {
  currentTime: number;
  error?: string;
  lines: MusicLyricLine[];
  onClose: () => void;
  onMove: (position: MusicLyricsOverlayPosition) => void;
  position: MusicLyricsOverlayPosition;
  songTitle: string;
  status: "idle" | "loading" | "succeeded" | "failed";
};

export function MusicLyricsOverlay({
  currentTime,
  error,
  lines,
  onClose,
  onMove,
  position,
  songTitle,
  status,
}: MusicLyricsOverlayProps) {
  const dragState = useRef<{
    offsetX: number;
    offsetY: number;
    pointerId: number;
  } | null>(null);
  const activeIndex = getActiveLyricIndex(lines, currentTime);
  const visibleLines = activeIndex < 0
    ? []
    : lines.slice(Math.max(0, activeIndex - 1), activeIndex + 2);

  function startDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const overlay = event.currentTarget.parentElement;
    if (!overlay) return;
    const overlayRect = overlay.getBoundingClientRect();
    dragState.current = {
      offsetX: event.clientX - overlayRect.left,
      offsetY: event.clientY - overlayRect.top,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function moveOverlay(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    const overlay = event.currentTarget.parentElement;
    const canvas = overlay?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !overlay || !canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    onMove(clampMusicLyricsOverlayPosition({
      canvasHeight: canvasRect.height,
      canvasWidth: canvasRect.width,
      overlayHeight: overlayRect.height,
      overlayWidth: overlayRect.width,
      x: event.clientX - canvasRect.left - drag.offsetX,
      y: event.clientY - canvasRect.top - drag.offsetY,
    }));
  }

  function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId !== event.pointerId) return;
    dragState.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <aside
      aria-label="歌词覆层"
      className="zenme-shadow-dropdown absolute z-30 w-[min(680px,calc(100%-32px))] overflow-hidden rounded-xl border border-white/10 bg-zinc-950/70 text-white backdrop-blur-md"
      data-thumbnail-hidden="true"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="flex h-9 cursor-move touch-none items-center gap-2 border-b border-white/10 px-3 text-xs text-zinc-300"
        onLostPointerCapture={() => {
          dragState.current = null;
        }}
        onPointerCancel={stopDragging}
        onPointerDown={startDragging}
        onPointerMove={moveOverlay}
        onPointerUp={stopDragging}
      >
        <GripHorizontal className="size-4 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate">{songTitle || "歌词"}</span>
        <button
          aria-label="关闭歌词覆层"
          className="flex size-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex min-h-32 flex-col items-center justify-center px-8 py-5 text-center">
        {visibleLines.length ? visibleLines.map((line) => {
          const active = line === lines[activeIndex];
          return (
            <p
              className={active
                ? "w-full py-1 text-2xl font-semibold leading-relaxed text-white"
                : "w-full truncate py-0.5 text-sm text-zinc-500"}
              key={line.id ?? `${line.start}-${line.text}`}
            >
              {line.text}
            </p>
          );
        }) : (
          <p className="text-sm text-zinc-400">
            {status === "loading"
              ? "正在获取当前歌曲歌词…"
              : status === "failed"
                ? error || "歌词获取失败"
                : "当前歌曲暂无歌词"}
          </p>
        )}
      </div>
    </aside>
  );
}

export function getActiveLyricIndex(lines: MusicLyricLine[], currentTime: number) {
  if (!lines.length) return -1;
  const matchedIndex = lines.findIndex((line, index) =>
    currentTime >= line.start &&
    currentTime < (line.end ?? lines[index + 1]?.start ?? Number.POSITIVE_INFINITY));
  if (matchedIndex >= 0) return matchedIndex;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (currentTime >= lines[index].start) return index;
  }
  return 0;
}

export function clampMusicLyricsOverlayPosition(input: {
  canvasHeight: number;
  canvasWidth: number;
  overlayHeight: number;
  overlayWidth: number;
  x: number;
  y: number;
}) {
  return {
    x: Math.max(0, Math.min(input.x, Math.max(0, input.canvasWidth - input.overlayWidth))),
    y: Math.max(0, Math.min(input.y, Math.max(0, input.canvasHeight - input.overlayHeight))),
  };
}
