import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  clampMusicLyricsOverlayPosition,
  getActiveLyricIndex,
  getMusicPlaybackProgress,
} from "./music-lyrics-overlay";

const overlaySource = readFileSync(
  new URL("./music-lyrics-overlay.tsx", import.meta.url),
  "utf8",
);

describe("music lyrics overlay", () => {
  it("selects the synchronized lyric line even when explicit end times are absent", () => {
    const lines = [
      { start: 0, text: "第一句" },
      { start: 10, text: "第二句" },
      { start: 20, text: "第三句" },
    ];

    expect(getActiveLyricIndex(lines, 15)).toBe(1);
    expect(getActiveLyricIndex(lines, 30)).toBe(2);
  });

  it("keeps dragging within the visible canvas", () => {
    expect(clampMusicLyricsOverlayPosition({
      canvasHeight: 600,
      canvasWidth: 1000,
      overlayHeight: 180,
      overlayWidth: 680,
      x: 900,
      y: -20,
    })).toEqual({ x: 320, y: 0 });
  });

  it("normalizes playback progress for the separator-sized progress line", () => {
    expect(getMusicPlaybackProgress(30, 120)).toBe(25);
    expect(getMusicPlaybackProgress(-10, 120)).toBe(0);
    expect(getMusicPlaybackProgress(180, 120)).toBe(100);
    expect(getMusicPlaybackProgress(10, 0)).toBe(0);
  });

  it("handles pointer completion, cancellation, and close", () => {
    expect(overlaySource).toContain("onPointerCancel={stopDragging}");
    expect(overlaySource).toContain("onPointerUp={stopDragging}");
    expect(overlaySource).toContain('aria-label="关闭歌词覆层"');
    expect(overlaySource).toContain('data-thumbnail-hidden="true"');
    expect(overlaySource).toContain("bg-zinc-950/70");
  });

  it("provides previous, playback, and next controls", () => {
    expect(overlaySource).toContain('aria-label="上一首"');
    expect(overlaySource).toContain('aria-label={isPlaying ? "暂停" : "播放"}');
    expect(overlaySource).toContain('aria-label="下一首"');
    expect(overlaySource).toContain("onClick={onPrevious}");
    expect(overlaySource).toContain("onClick={onTogglePlayback}");
    expect(overlaySource).toContain("onClick={onNext}");
    expect(overlaySource.match(/disabled={!hasPlayableSource}/g)).toHaveLength(3);
    expect(overlaySource).not.toContain(
      'h-12 items-center justify-center gap-3 border-t',
    );
    expect(overlaySource).not.toContain(
      "cursor-move touch-none items-center gap-2 border-b",
    );
  });

  it("renders a compact docked player with lyrics and window actions", () => {
    expect(overlaySource).toContain('aria-label="最小化歌词覆层"');
    expect(overlaySource).toContain('aria-label="展开歌词覆层"');
    expect(overlaySource).toContain('aria-label="关闭歌词覆层"');
    expect(overlaySource).toContain("activeLyric || getLyricsFallbackText");
    expect(overlaySource).toContain(
      "style={{ bottom: 66, left: minimizedLeft, maxWidth: 310, right: 12 }}",
    );
    expect(overlaySource).toContain("group/music-mini");
    expect(overlaySource).toContain("absolute right-2 top-1/2");
    expect(overlaySource).toContain("group-hover/music-mini:opacity-100");
    expect(overlaySource).toContain("group-focus-within/music-mini:opacity-100");
    expect(overlaySource).not.toContain("min-h-24 min-w-0 flex-col");
    expect(overlaySource).toContain("mix-blend-difference");
    expect(overlaySource).toContain("<MusicLyricsPlaybackControls\n            floating");
    expect(overlaySource).toContain("bg-white/70");
    expect(overlaySource).toContain("opacity-70");
    expect(overlaySource).not.toContain("rounded-lg bg-white/90 p-1");
  });

  it("uses a one-pixel inverse theme gradient as playback progress", () => {
    expect(overlaySource).toContain('aria-label="播放进度"');
    expect(overlaySource).toContain("h-px w-full overflow-hidden");
    expect(overlaySource).toContain("bg-zinc-950 dark:bg-white");
    expect(overlaySource).toContain("bg-white");
    expect(overlaySource).toContain("from-white to-zinc-950");
    expect(overlaySource).toContain("dark:from-zinc-950 dark:to-white");
    expect(overlaySource).toContain('style={{ width: `${playbackProgress}%` }}');
  });

  it("applies the playback split only to the minimized background and inverts its content", () => {
    expect(overlaySource.match(/<MusicLyricsProgressBackground/g)).toHaveLength(1);
    expect(overlaySource).toContain(
      'className="pointer-events-none absolute inset-0 bg-zinc-950 opacity-80 dark:bg-white"',
    );
    expect(overlaySource).toContain("w-10 bg-gradient-to-r from-white to-zinc-950");
    expect(overlaySource.match(/mix-blend-difference/g)).toHaveLength(2);
  });
});
