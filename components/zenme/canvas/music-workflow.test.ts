import { describe, expect, it } from "vitest";

import type { CanvasNode } from "./types";
import {
  createMusicChildUpdate,
  createMusicPlayerUpdate,
  downsampleWaveform,
  extractMusicLyrics,
  musicCapabilitiesFor,
  musicJobRequestFor,
  musicPlayerPreviewRequest,
  resolveMusicSourceNode,
} from "./music-workflow";

const musicNode: CanvasNode = {
  id: "music-1",
  type: "music",
  position: { x: 100, y: 200 },
  data: { kind: "music", title: "测试歌曲", fileId: "file-1" },
};

describe("music workflow", () => {
  it("creates one deterministic player for a music asset", () => {
    const first = createMusicPlayerUpdate({
      edges: [], musicNode, nodes: [musicNode], projectId: "project-1",
    });
    const player = first.createdNodes[0];
    expect(player.id).toBe("music-player:music-1");
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

  it("requests only the capabilities required by each child node", () => {
    expect(musicCapabilitiesFor("lyrics")).toContain("lyrics");
    expect(musicCapabilitiesFor("lyrics")).not.toContain("instruments");
    expect(musicCapabilitiesFor("musicAnalysis")).toContain("instruments");
    expect(musicCapabilitiesFor("musicAnalysis")).not.toContain("lyrics");
    expect(musicCapabilitiesFor("sunoPrompt")).toContain("suno_prompt");
  });

  it("uses product profiles without exposing their internal dependencies", () => {
    const capabilities = {
      profiles: [
        { id: "player-preview" },
        { id: "lyrics-structure" },
        { id: "comprehensive-analysis" },
        { id: "suno-prompt" },
      ],
    };
    expect(musicPlayerPreviewRequest(capabilities)).toEqual({
      capabilities: ["metadata", "waveform"],
      profile: "player-preview",
    });
    expect(musicJobRequestFor("lyrics", capabilities)).toEqual({
      capabilities: ["lyrics", "structure"],
      profile: "lyrics-structure",
    });
    expect(musicJobRequestFor("sunoPrompt", capabilities)).toEqual({
      capabilities: ["suno_prompt"],
      profile: "suno-prompt",
    });
  });

  it("falls back to the legacy explicit capability contract", () => {
    const lyrics = musicJobRequestFor("lyrics", { profiles: [] });
    expect(lyrics.profile).toBe("complete");
    expect(lyrics.capabilities).toContain("downbeats");
    expect(lyrics.capabilities).toContain("lyrics");
    expect(musicPlayerPreviewRequest(null).profile).toBe("complete");
  });

  it("creates a new analysis child for every pulled operation", () => {
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 500, y: 200 },
      data: {
        kind: "musicPlayer",
        title: "测试歌曲 · 播放器",
        musicJobId: "job-1",
        musicJobStatus: "succeeded",
      },
    };
    const first = createMusicChildUpdate({
      edges: [], kind: "lyrics", nodes: [player], playerNode: player, projectId: "project-1",
    });
    expect(first.createdEdges[0]).toMatchObject({ source: "player-1", target: first.focusNodeId });
    expect(first.createdNodes[0].data.musicParentPlayerNodeId).toBe("player-1");

    const repeated = createMusicChildUpdate({
      edges: first.createdEdges,
      kind: "lyrics",
      nodes: [player, ...first.createdNodes],
      playerNode: player,
      projectId: "project-1",
    });
    expect(repeated.createdNodes).toHaveLength(1);
    expect(repeated.focusNodeId).not.toBe(first.focusNodeId);
  });

  it("creates a resizable Suno prompt node with the documented default size", () => {
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 500, y: 200 },
      data: { kind: "musicPlayer", title: "测试歌曲 · 播放器" },
    };
    const update = createMusicChildUpdate({
      edges: [],
      kind: "sunoPrompt",
      nodes: [player],
      playerNode: player,
      projectId: "project-1",
    });

    expect(update.createdNodes[0].style).toMatchObject({ height: 360, width: 520 });
  });

  it("creates a resizable comprehensive analysis node with the documented default size", () => {
    const player: CanvasNode = {
      id: "player-1",
      type: "musicPlayer",
      position: { x: 500, y: 200 },
      data: { kind: "musicPlayer", title: "测试歌曲 · 播放器" },
    };
    const update = createMusicChildUpdate({
      edges: [],
      kind: "musicAnalysis",
      nodes: [player],
      playerNode: player,
      projectId: "project-1",
    });

    expect(update.createdNodes[0].style).toMatchObject({ height: 720, width: 620 });
  });

  it("assigns lyric lines to analyzed structure sections", () => {
    expect(extractMusicLyrics({
      segments: [{ start: 0, end: 20, label: "Intro" }, { start: 20, end: 40, label: "Verse" }],
      lyrics: [{ start: 21, end: 24, text: "第一句" }],
    })).toEqual([expect.objectContaining({ section: "Verse", text: "第一句" })]);
  });
});
