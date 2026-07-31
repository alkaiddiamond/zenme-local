import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import type { CanvasNode } from "./types";
import {
  createLyricsNodeUpdate,
  createMusicPlayerUpdate,
  getMusicApiErrorMessage,
  downsampleWaveform,
  extractMusicLyrics,
  findLyricsNodesNeedingRefresh,
  findLyricsNodesNeedingRecovery,
  getNextMusicLoopMode,
  getNextMusicSourceId,
  normalizeMusicPlaybackTimes,
  normalizeMusicLoopMode,
  resolveMusicSourceNode,
  resolveMusicSourceNodes,
} from "./music-workflow";

const musicNode: CanvasNode = {
  id: "music-1",
  type: "music",
  position: { x: 100, y: 200 },
  data: { kind: "music", title: "测试歌曲", fileId: "file-1" },
};

describe("music workflow", () => {
  it("creates lyrics nodes without changing the current canvas zoom", () => {
    const canvasClientSource = readFileSync(
      new URL("../canvas-client.tsx", import.meta.url),
      "utf8",
    );
    const createMusicChildSource = canvasClientSource.slice(
      canvasClientSource.indexOf("const createMusicChild = useCallback"),
      canvasClientSource.indexOf(
        "const locateMusicPlayer = useCallback",
      ),
    );

    expect(createMusicChildSource).toContain(
      "focusCanvasNode(update.focusNodeId, { preserveZoom: true })",
    );
  });

  it("preserves string and structured API error details", () => {
    expect(getMusicApiErrorMessage({ detail: "Unauthorized" })).toBe(
      "Unauthorized",
    );
    expect(
      getMusicApiErrorMessage({ detail: { message: "模型尚未安装" } }),
    ).toBe("模型尚未安装");
    expect(getMusicApiErrorMessage({ error: "服务未配置" })).toBe(
      "服务未配置",
    );
    expect(getMusicApiErrorMessage(null)).toBe("未找到同步歌词");
  });

  it("creates one deterministic player for a music asset", () => {
    const first = createMusicPlayerUpdate({
      edges: [], musicNode, nodes: [musicNode], projectId: "project-1",
    });
    const player = first.createdNodes[0];
    expect(player.id).toBe("music-player:music-1");
    expect(player.data).toMatchObject({
      musicLoopMode: "off",
      musicSourceListExpanded: true,
      musicSourceNodeId: musicNode.id,
      title: "音乐播放器",
    });
    expect(first.createdEdges[0]).toMatchObject({ source: "music-1", target: player.id });

    const repeated = createMusicPlayerUpdate({
      edges: first.createdEdges,
      musicNode,
      nodes: [musicNode, player],
      projectId: "project-1",
    });
    expect(repeated.createdNodes).toEqual([]);
    expect(repeated.focusNodeId).toBe(player.id);
  });

  it("resolves the upstream music asset for runtime player actions", () => {
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 500, y: 200 },
      data: { kind: "musicPlayer", title: "播放器" },
    };
    expect(resolveMusicSourceNode({
      edges: [{ id: "edge-1", source: musicNode.id, target: player.id }],
      nodes: [musicNode, player],
      playerNodeId: player.id,
    })).toBe(musicNode);
  });

  it("normalizes legacy loop state and cycles all three loop modes", () => {
    expect(normalizeMusicLoopMode(undefined, false)).toBe("off");
    expect(normalizeMusicLoopMode(undefined, true)).toBe("one");
    expect(normalizeMusicLoopMode("all", true)).toBe("all");
    expect([
      getNextMusicLoopMode("off"),
      getNextMusicLoopMode("one"),
      getNextMusicLoopMode("all"),
    ]).toEqual(["one", "all", "off"]);
  });

  it("advances and wraps connected music sources for list loop", () => {
    const sourceIds = ["music-1", "music-2", "music-3"];
    expect(getNextMusicSourceId(sourceIds, "music-1")).toBe("music-2");
    expect(getNextMusicSourceId(sourceIds, "music-3")).toBe("music-1");
    expect(getNextMusicSourceId(sourceIds, "missing")).toBe("music-1");
    expect(getNextMusicSourceId(["music-1"], "music-1")).toBe("music-1");
    expect(getNextMusicSourceId([], "music-1")).toBeUndefined();
  });

  it("resolves all connected music assets and honors the selected source", () => {
    const secondMusic: CanvasNode = {
      ...musicNode,
      id: "music-2",
      data: { ...musicNode.data, title: "第二首" },
    };
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 500, y: 200 },
      data: { kind: "musicPlayer", title: "音乐播放器" },
    };
    const edges = [
      { id: "edge-1", source: musicNode.id, target: player.id },
      { id: "edge-2", source: secondMusic.id, target: player.id },
      { id: "edge-duplicate", source: musicNode.id, target: player.id },
    ];

    expect(resolveMusicSourceNodes({ edges, nodes: [musicNode, secondMusic, player], playerNodeId: player.id }))
      .toEqual([musicNode, secondMusic]);
    expect(resolveMusicSourceNode({
      edges,
      nodes: [musicNode, secondMusic, player],
      playerNodeId: player.id,
      sourceNodeId: secondMusic.id,
    })).toBe(secondMusic);
  });

  it("downsamples the complete waveform into a normalized RMS envelope", () => {
    const waveform = Array.from({ length: 1_000 }, (_, index) => index / 1_000);
    const sampled = downsampleWaveform(waveform, 100);
    expect(sampled).toHaveLength(100);
    expect(sampled[0]).toBeLessThan(sampled[50]);
    expect(sampled.at(-1)).toBe(1);
  });

  it("does not turn sparse transients into a flat waveform", () => {
    const waveform = Array.from({ length: 1_000 }, (_, index) =>
      index % 10 === 9 ? 1 : 0.1 + index / 2_000,
    );
    const sampled = downsampleWaveform(waveform, 100);
    expect(new Set(sampled.map((value) => value.toFixed(2))).size).toBeGreaterThan(20);
  });

  it("does not display a stale playback position before duration is known", () => {
    expect(normalizeMusicPlaybackTimes(undefined, 297)).toEqual({
      current: 0,
      duration: 0,
    });
    expect(normalizeMusicPlaybackTimes(180, 297)).toEqual({
      current: 180,
      duration: 180,
    });
    expect(normalizeMusicPlaybackTimes(180, 42)).toEqual({
      current: 42,
      duration: 180,
    });
  });

  it("creates a new lyrics child for every pulled operation", () => {
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 500, y: 200 },
      data: {
        kind: "musicPlayer",
        title: "测试歌曲 · 播放器",
      },
    };
    const first = createLyricsNodeUpdate({
      playerNode: player, projectId: "project-1",
    });
    expect(first.createdEdges[0]).toMatchObject({ source: "player-1", target: first.focusNodeId });
    expect(first.createdNodes[0].data.title).toBe("歌词");
    expect(first.createdNodes[0].data.musicParentPlayerNodeId).toBe("player-1");
    expect(first.createdNodes[0].style).toMatchObject({ height: 176, width: 560 });

    const repeated = createLyricsNodeUpdate({
      playerNode: player, projectId: "project-1",
    });
    expect(repeated.createdNodes).toHaveLength(1);
    expect(repeated.focusNodeId).not.toBe(first.focusNodeId);
  });

  it("keeps locally fetched lyric lines without requiring structure sections", () => {
    expect(extractMusicLyrics({
      lyrics: [{ start: 21, end: 24, text: "第一句" }],
    })).toEqual([expect.objectContaining({ text: "第一句" })]);
  });

  it("finds succeeded historical lyric nodes whose persisted lines were lost", () => {
    const lyrics: CanvasNode = {
      id: "lyrics-1",
      type: "lyrics",
      position: { x: 0, y: 0 },
      data: {
        kind: "lyrics",
        lyricsFetchStatus: "succeeded",
        musicLyrics: [],
        musicParentPlayerNodeId: "player-1",
        title: "歌词",
      },
    };
    const intactLyrics: CanvasNode = {
      ...lyrics,
      id: "lyrics-2",
      data: {
        ...lyrics.data,
        musicLyrics: [{ start: 1, text: "已有歌词" }],
      },
    };

    expect(findLyricsNodesNeedingRecovery([lyrics, intactLyrics])).toEqual([
      { childNodeId: "lyrics-1", playerNodeId: "player-1" },
    ]);
  });

  it("refreshes a lyrics child when the player selects another connected song", () => {
    const secondMusic: CanvasNode = {
      ...musicNode,
      id: "music-2",
      data: { ...musicNode.data, fileId: "file-2", title: "第二首" },
    };
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 0, y: 0 },
      data: {
        kind: "musicPlayer",
        musicSourceNodeId: secondMusic.id,
        title: "音乐播放器",
      },
    };
    const lyrics: CanvasNode = {
      id: "lyrics-1",
      type: "lyrics",
      position: { x: 0, y: 0 },
      data: {
        kind: "lyrics",
        lyricsFetchStatus: "succeeded",
        musicLyrics: [{ start: 1, text: "上一首歌词" }],
        musicLyricsSourceNodeId: musicNode.id,
        musicParentPlayerNodeId: player.id,
        title: "歌词",
      },
    };
    const edges = [
      { id: "music-1-edge", source: musicNode.id, target: player.id },
      { id: "music-2-edge", source: secondMusic.id, target: player.id },
      { id: "lyrics-edge", source: player.id, target: lyrics.id },
    ];

    expect(findLyricsNodesNeedingRefresh({
      edges,
      nodes: [musicNode, secondMusic, player, lyrics],
    })).toEqual([{
      childNodeId: lyrics.id,
      playerNodeId: player.id,
      sourceNodeId: secondMusic.id,
    }]);

    lyrics.data.musicLyricsSourceNodeId = secondMusic.id;
    expect(findLyricsNodesNeedingRefresh({
      edges,
      nodes: [musicNode, secondMusic, player, lyrics],
    })).toEqual([]);
  });
});
