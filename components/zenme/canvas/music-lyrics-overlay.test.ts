import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  clampMusicLyricsOverlayPosition,
  getActiveLyricIndex,
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

  it("handles pointer completion, cancellation, and close", () => {
    expect(overlaySource).toContain("onPointerCancel={stopDragging}");
    expect(overlaySource).toContain("onPointerUp={stopDragging}");
    expect(overlaySource).toContain('aria-label="关闭歌词覆层"');
    expect(overlaySource).toContain('data-thumbnail-hidden="true"');
    expect(overlaySource).toContain("bg-zinc-950/70");
  });
});
