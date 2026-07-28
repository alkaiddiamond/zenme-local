import { describe, expect, it } from "vitest";

import { getPersistableCanvasNodes } from "@/components/zenme/canvas/persistence";
import type { CanvasNode } from "@/components/zenme/canvas/types";

describe("music canvas persistence", () => {
  it("removes transient multi-selection state from canvas snapshots", () => {
    const node: CanvasNode = {
      id: "text-1",
      type: "text",
      position: { x: 0, y: 0 },
      data: {
        isMultiSelection: true,
        kind: "text",
        title: "文本",
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.isMultiSelection).toBeUndefined();
  });

  it("does not persist high-frequency playback runtime state", () => {
    const node: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 0, y: 0 },
      data: {
        kind: "musicPlayer",
        musicCurrentTime: 42,
        musicDuration: 180,
        musicIsPlaying: true,
        title: "播放器",
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.musicCurrentTime).toBeUndefined();
    expect(persisted.data.musicIsPlaying).toBeUndefined();
    expect(persisted.data.musicDuration).toBe(180);
  });

  it("persists resolved lyrics", () => {
    const node: CanvasNode = {
      id: "lyrics-1",
      type: "lyrics",
      position: { x: 0, y: 0 },
      data: {
        kind: "lyrics",
        lyricsFetchStatus: "succeeded",
        musicLyrics: [{ start: 12, end: 18, text: "歌词" }],
        title: "歌词",
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.musicLyrics).toEqual([
      { start: 12, end: 18, text: "歌词" },
    ]);
  });

  it("persists the player selection and folded state without derived source summaries", () => {
    const node: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 0, y: 0 },
      data: {
        kind: "musicPlayer",
        musicLyricsOverlayOpen: true,
        musicSourceListExpanded: false,
        musicSourceNodeId: "music-2",
        musicSources: [{ id: "music-2", title: "第二首" }],
        title: "音乐播放器",
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.musicSourceListExpanded).toBe(false);
    expect(persisted.data.musicLyricsOverlayOpen).toBeUndefined();
    expect(persisted.data.musicSourceNodeId).toBe("music-2");
    expect(persisted.data.musicSources).toBeUndefined();
  });
});
