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
import {
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type { MusicLyricLine } from "@/components/zenme/node-types";

export type MusicLyricsOverlayPosition = { x: number; y: number };

const MINIMIZED_FLOATING_ACTION_CLASS =
  "zenme-music-lyrics-floating-action flex size-8 shrink-0 items-center justify-center rounded-md opacity-70 backdrop-blur transition hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-30";

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
        className="zenme-music-lyrics-mini group/music-mini zenme-shadow-dropdown absolute z-30 isolate overflow-hidden rounded-xl border outline-none backdrop-blur-md"
        data-thumbnail-hidden="true"
        style={{ bottom: 66, left: minimizedLeft, maxWidth: 310, right: 12 }}
        tabIndex={0}
      >
        <MusicLyricsProgressBackground progress={playbackProgress} />
        <MusicLyricsMiniContent
          activeLyric={activeLyric}
          error={error}
          songTitle={songTitle}
          status={status}
        />
        <MusicLyricsMiniContent
          activeLyric={activeLyric}
          ariaHidden
          className="absolute inset-0 z-10 text-[var(--lyrics-progress-fill-foreground)]"
          error={error}
          songTitle={songTitle}
          status={status}
          style={{ clipPath: `inset(0 ${100 - playbackProgress}% 0 0)` }}
        />
        <div className="pointer-events-none absolute right-2 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover/music-mini:pointer-events-auto group-hover/music-mini:opacity-100 group-focus-within/music-mini:pointer-events-auto group-focus-within/music-mini:opacity-100">
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
      className="zenme-music-lyrics-overlay zenme-shadow-dropdown absolute z-30 w-[min(680px,calc(100%-32px))] overflow-hidden rounded-xl border backdrop-blur-md"
      data-thumbnail-hidden="true"
      style={{ left: position.x, top: position.y }}
    >
      <div
        className="flex h-9 cursor-move touch-none items-center gap-2 px-3 text-xs text-[var(--color-text-secondary)]"
        onLostPointerCapture={() => {
          dragState.current = null;
        }}
        onPointerCancel={stopDragging}
        onPointerDown={startDragging}
        onPointerMove={moveOverlay}
        onPointerUp={stopDragging}
      >
        <GripHorizontal className="size-4 shrink-0 text-[var(--color-text-tertiary)]" />
        <span className="min-w-0 flex-1 truncate">{songTitle || "歌词"}</span>
        <button
          aria-label="最小化歌词覆层"
          className="zenme-music-lyrics-icon-button flex size-7 items-center justify-center rounded-md transition"
          onClick={onMinimize}
          title="最小化"
          type="button"
        >
          <Minus className="size-4" />
        </button>
        <button
          aria-label="关闭歌词覆层"
          className="zenme-music-lyrics-icon-button flex size-7 items-center justify-center rounded-md transition"
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
                ? "w-full py-1 text-2xl font-semibold leading-relaxed text-[var(--color-text-primary)]"
                : "w-full truncate py-0.5 text-sm text-[var(--color-text-tertiary)]"}
              key={line.id ?? `${line.start}-${line.text}`}
            >
              {line.text}
            </p>
          );
        }) : (
          <p className="text-sm text-[var(--color-text-secondary)]">
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
        className="zenme-music-lyrics-progress-track h-px w-full overflow-hidden"
        role="progressbar"
      >
        <div
          className="zenme-music-lyrics-progress-fill relative h-full transition-[width] duration-100 ease-linear"
          style={{ width: `${playbackProgress}%` }}
        >
          <span className="zenme-music-lyrics-progress-fade absolute left-full top-0 h-full w-6" />
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

function MusicLyricsMiniContent({
  activeLyric,
  ariaHidden = false,
  className = "relative z-10 text-[var(--lyrics-progress-track-foreground)]",
  error,
  songTitle,
  status,
  style,
}: {
  activeLyric?: string;
  ariaHidden?: boolean;
  className?: string;
  error?: string;
  songTitle: string;
  status: MusicLyricsOverlayProps["status"];
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden={ariaHidden || undefined}
      className={`${className} flex h-16 min-w-0 flex-col justify-center px-3 py-2`}
      style={style}
    >
      <p className="truncate text-xs font-medium">{songTitle || "歌词"}</p>
      <p className="mt-1 truncate text-sm">
        {activeLyric || getLyricsFallbackText(status, error)}
      </p>
    </div>
  );
}

function MusicLyricsProgressBackground({ progress }: { progress: number }) {
  return (
    <div
      aria-hidden
      className="zenme-music-lyrics-progress-track pointer-events-none absolute inset-0 opacity-80"
    >
      <div
        className="zenme-music-lyrics-progress-fill relative h-full transition-[width] duration-100 ease-linear"
        style={{ width: `${progress}%` }}
      >
        <span className="zenme-music-lyrics-progress-fade absolute left-full top-0 h-full w-10" />
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
    : "zenme-music-lyrics-icon-button flex size-8 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30";
  const playbackButtonClassName = floating
    ? MINIMIZED_FLOATING_ACTION_CLASS
    : "zenme-music-lyrics-playback-button flex size-9 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30";

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
