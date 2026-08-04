"use client";

import {
  GripHorizontal,
  Maximize2,
  Minus,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import type { MusicLyricLine } from "@/components/zenme/node-types";

export type MusicLyricsOverlayPosition = { x: number; y: number };

const MINIMIZED_FLOATING_ACTION_CLASS =
  "flex size-8 shrink-0 items-center justify-center rounded-md bg-white/70 text-zinc-500 opacity-70 backdrop-blur transition hover:bg-white/90 hover:text-zinc-950 hover:opacity-100 focus-visible:bg-white/90 focus-visible:text-zinc-950 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30";

type MusicLyricsOverlayProps = {
  currentTime: number;
  duration: number;
  error?: string;
  hasPlayableSource: boolean;
  isPlaying: boolean;
  lines: MusicLyricLine[];
  minimized: boolean;
  minimizedLeft: number;
  onClose: () => void;
  onExpand: () => void;
  onMinimize: () => void;
  onMove: (position: MusicLyricsOverlayPosition) => void;
  onNext: () => void;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  position: MusicLyricsOverlayPosition;
  songTitle: string;
  status: "idle" | "loading" | "succeeded" | "failed";
};

export function MusicLyricsOverlay({
  currentTime,
  duration,
  error,
  hasPlayableSource,
  isPlaying,
  lines,
  minimized,
  minimizedLeft,
  onClose,
  onExpand,
  onMinimize,
  onMove,
  onNext,
  onPrevious,
  onTogglePlayback,
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
  const activeLyric = activeIndex < 0 ? undefined : lines[activeIndex]?.text;
  const playbackProgress = getMusicPlaybackProgress(currentTime, duration);

  if (minimized) {
    return (
      <aside
        aria-label="最小化歌词覆层"
        className="group/music-mini zenme-shadow-dropdown absolute z-30 isolate overflow-hidden rounded-xl border border-zinc-500/30 text-white outline-none backdrop-blur-md"
        data-thumbnail-hidden="true"
        style={{ bottom: 66, left: minimizedLeft, maxWidth: 310, right: 12 }}
        tabIndex={0}
      >
        <MusicLyricsProgressBackground progress={playbackProgress} />
        <div className="relative z-10 flex h-16 min-w-0 flex-col justify-center px-3 py-2 mix-blend-difference">
          <p className="truncate text-xs font-medium text-white">
            {songTitle || "歌词"}
          </p>
          <p className="mt-1 truncate text-sm text-white">
            {activeLyric || getLyricsFallbackText(status, error)}
          </p>
        </div>
        <div className="pointer-events-none absolute right-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity mix-blend-difference group-hover/music-mini:pointer-events-auto group-hover/music-mini:opacity-100 group-focus-within/music-mini:pointer-events-auto group-focus-within/music-mini:opacity-100">
          <MusicLyricsPlaybackControls
            floating
            hasPlayableSource={hasPlayableSource}
            isPlaying={isPlaying}
            onNext={onNext}
            onPrevious={onPrevious}
            onTogglePlayback={onTogglePlayback}
          />
          <button
            aria-label="展开歌词覆层"
            className={MINIMIZED_FLOATING_ACTION_CLASS}
            onClick={onExpand}
            title="展开"
            type="button"
          >
            <Maximize2 className="size-4" />
          </button>
          <button
            aria-label="关闭歌词覆层"
            className={MINIMIZED_FLOATING_ACTION_CLASS}
            onClick={onClose}
            title="关闭"
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </aside>
    );
  }

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
        className="flex h-9 cursor-move touch-none items-center gap-2 px-3 text-xs text-zinc-300"
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
          aria-label="最小化歌词覆层"
          className="flex size-7 items-center justify-center rounded-md text-zinc-400 transition hover:bg-white/10 hover:text-white"
          onClick={onMinimize}
          title="最小化"
          type="button"
        >
          <Minus className="size-4" />
        </button>
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
      <div
        aria-label="播放进度"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={playbackProgress}
        className="h-px w-full overflow-hidden bg-zinc-950 dark:bg-white"
        role="progressbar"
      >
        <div
          className="relative h-full bg-white transition-[width] duration-100 ease-linear dark:bg-zinc-950"
          style={{ width: `${playbackProgress}%` }}
        >
          <span className="absolute left-full top-0 h-full w-6 bg-gradient-to-r from-white to-zinc-950 dark:from-zinc-950 dark:to-white" />
        </div>
      </div>
      <div className="flex h-12 items-center justify-center gap-3 px-4">
        <MusicLyricsPlaybackControls
          hasPlayableSource={hasPlayableSource}
          isPlaying={isPlaying}
          onNext={onNext}
          onPrevious={onPrevious}
          onTogglePlayback={onTogglePlayback}
        />
      </div>
    </aside>
  );
}

export function getMusicPlaybackProgress(currentTime: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (!Number.isFinite(currentTime)) return 0;
  return Math.min(100, Math.max(0, (currentTime / duration) * 100));
}

function MusicLyricsProgressBackground({ progress }: { progress: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 bg-zinc-950 opacity-80 dark:bg-white"
    >
      <div
        className="relative h-full bg-white transition-[width] duration-100 ease-linear dark:bg-zinc-950"
        style={{ width: `${progress}%` }}
      >
        <span className="absolute left-full top-0 h-full w-10 bg-gradient-to-r from-white to-zinc-950 dark:from-zinc-950 dark:to-white" />
      </div>
    </div>
  );
}

function MusicLyricsPlaybackControls({
  floating = false,
  hasPlayableSource,
  isPlaying,
  onNext,
  onPrevious,
  onTogglePlayback,
}: Pick<
  MusicLyricsOverlayProps,
  | "hasPlayableSource"
  | "isPlaying"
  | "onNext"
  | "onPrevious"
  | "onTogglePlayback"
> & { floating?: boolean }) {
  const secondaryButtonClassName = floating
    ? MINIMIZED_FLOATING_ACTION_CLASS
    : "flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30";
  const playbackButtonClassName = floating
    ? MINIMIZED_FLOATING_ACTION_CLASS
    : "flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <>
      <button
        aria-label="上一首"
        className={secondaryButtonClassName}
        disabled={!hasPlayableSource}
        onClick={onPrevious}
        type="button"
      >
        <SkipBack className="size-4" />
      </button>
      <button
        aria-label={isPlaying ? "暂停" : "播放"}
        className={playbackButtonClassName}
        disabled={!hasPlayableSource}
        onClick={onTogglePlayback}
        type="button"
      >
        {isPlaying ? (
          <Pause className="size-4" />
        ) : (
          <Play className="ml-0.5 size-4" />
        )}
      </button>
      <button
        aria-label="下一首"
        className={secondaryButtonClassName}
        disabled={!hasPlayableSource}
        onClick={onNext}
        type="button"
      >
        <SkipForward className="size-4" />
      </button>
    </>
  );
}

function getLyricsFallbackText(
  status: MusicLyricsOverlayProps["status"],
  error?: string,
) {
  if (status === "loading") return "正在获取当前歌曲歌词…";
  if (status === "failed") return error || "歌词获取失败";
  return "当前歌曲暂无歌词";
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
