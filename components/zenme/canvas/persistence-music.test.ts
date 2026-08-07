import { describe, expect, it } from "vitest";

import {
  getPersistableCanvasNodes,
  intersectsCanvasThumbnailBounds,
} from "@/components/zenme/canvas/persistence";
import type { CanvasNode } from "@/components/zenme/canvas/types";

describe("music canvas persistence", () => {
  it("limits thumbnail cloning to the viewport and a small overscan", () => {
    const viewport = { bottom: 800, left: 0, right: 1200, top: 0 };
    expect(intersectsCanvasThumbnailBounds(
      { bottom: 200, left: 100, right: 400, top: 100 },
      viewport,
    )).toBe(true);
    expect(intersectsCanvasThumbnailBounds(
      { bottom: 200, left: 1300, right: 1600, top: 100 },
      viewport,
    )).toBe(false);
    expect(intersectsCanvasThumbnailBounds(
      { bottom: 200, left: 1250, right: 1500, top: 100 },
      viewport,
    )).toBe(true);
  });

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

  it("removes derived task parent presentation state from snapshots", () => {
    const node: CanvasNode = {
      id: "task-1",
      type: "task",
      position: { x: 0, y: 0 },
      data: {
        kind: "task",
        taskParentId: "task-parent",
        taskParentName: "父任务",
        taskParentOptions: [{ id: "task-parent", name: "父任务" }],
      },
    };

    const [persisted] = getPersistableCanvasNodes([node]);

    expect(persisted.data.taskParentId).toBe("task-parent");
    expect(persisted.data.taskParentName).toBeUndefined();
    expect(persisted.data.taskParentOptions).toBeUndefined();
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
