import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatLyricsForClipboard, groupLyrics } from "./lyrics-node";
import { formatCompactDuration } from "./use-music-job";

const lyricsNodeSource = readFileSync(
  new URL("./lyrics-node.tsx", import.meta.url),
  "utf8",
);

describe("groupLyrics", () => {
  it("accepts dedicated context connections from downstream text nodes", () => {
    expect(lyricsNodeSource).toContain("<NodeContextTargetHandle />");
  });

  it("groups adjacent timestamped lines by structure section", () => {
    expect(groupLyrics([
      { start: 0, text: "Intro", section: "前奏" },
      { start: 4, text: "Line one", section: "主歌" },
      { start: 8, text: "Line two", section: "主歌" },
      { start: 12, text: "Hook", section: "副歌" },
    ])).toEqual([
      { label: "前奏", lines: [{ start: 0, text: "Intro", section: "前奏" }] },
      { label: "主歌", lines: [
        { start: 4, text: "Line one", section: "主歌" },
        { start: 8, text: "Line two", section: "主歌" },
      ] },
      { label: "副歌", lines: [{ start: 12, text: "Hook", section: "副歌" }] },
    ]);
  });

  it("uses a stable fallback section", () => {
    expect(groupLyrics([{ start: 1, text: "Line" }])[0]?.label).toBe("歌词");
  });

  it("formats every lyric line with timestamps and omits structure headings", () => {
    expect(
      formatLyricsForClipboard([
        { start: 4, text: "Line one", section: "主歌" },
        { start: 8, text: "Line two", section: "主歌" },
        { start: 65, text: "Hook", section: "副歌" },
      ]),
    ).toBe("0:04 Line one\n0:08 Line two\n1:05 Hook");
  });
});

describe("formatCompactDuration", () => {
  it("uses compact latin units for external node timing", () => {
    expect(formatCompactDuration(57_666)).toBe("58s");
    expect(formatCompactDuration(62_000)).toBe("1m 2s");
  });
});
