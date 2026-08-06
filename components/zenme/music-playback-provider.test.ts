import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  reconcileMusicPlaybackSession,
  type MusicPlaybackConfig,
  type MusicPlaybackSession,
} from "./music-playback-provider";

const config: MusicPlaybackConfig = {
  currentSourceId: "song-a",
  playerNodeId: "player-a",
  projectId: "project-a",
  sources: [
    { id: "song-a", title: "A", url: "/a.ogg" },
    { id: "song-b", title: "B", url: "/b.ogg" },
  ],
};

describe("应用级音乐播放会话", () => {
  it("等价配置重复确保播放时复用同一个会话对象", () => {
    const active = reconcileMusicPlaybackSession(undefined, config);
    const result = reconcileMusicPlaybackSession(active, {
      ...config,
      sources: config.sources.map((source) => ({ ...source })),
    });

    expect(result).toBe(active);
  });

  it("刷新来源画布配置时保留活动播放与歌词浮层状态", () => {
    const active: MusicPlaybackSession = {
      config,
      currentSourceId: "song-b",
      currentTime: 42,
      duration: 180,
      isPlaying: true,
      lyrics: [{ start: 40, text: "正在播放" }],
      lyricsSourceId: "song-b",
      lyricsStatus: "succeeded",
      overlay: { minimized: true, position: { x: 20, y: 30 } },
    };

    const result = reconcileMusicPlaybackSession(active, {
      ...config,
      volume: 0.5,
    });

    expect(result).toMatchObject({
      currentSourceId: "song-b",
      currentTime: 42,
      isPlaying: true,
      overlay: { minimized: true, position: { x: 20, y: 30 } },
    });
  });

  it("另一个播放器开始活动时建立新的单一会话", () => {
    const active = reconcileMusicPlaybackSession(undefined, config);
    const result = reconcileMusicPlaybackSession(active, {
      ...config,
      playerNodeId: "player-b",
      projectId: "project-b",
    });

    expect(result.currentTime).toBe(0);
    expect(result.isPlaying).toBe(false);
    expect(result.overlay).toBeUndefined();
    expect(result.config.projectId).toBe("project-b");
  });

  it("播放提供器包裹 AppShell，并在主内容区渲染浮层", () => {
    const source = readFileSync("components/zenme/app-shell.tsx", "utf8");
    const providerIndex = source.indexOf("<MusicPlaybackProvider");
    const shellContentIndex = source.indexOf("<AppShellContent", providerIndex);
    const providerEndIndex = source.indexOf("</MusicPlaybackProvider>", providerIndex);

    expect(providerIndex).toBeGreaterThan(-1);
    expect(shellContentIndex).toBeGreaterThan(providerIndex);
    expect(providerEndIndex).toBeGreaterThan(shellContentIndex);
    expect(source).toContain("<MusicPlaybackOverlay />");
  });

  it("来源项目标签在实际播放时显示状态图标", () => {
    const source = readFileSync("components/zenme/app-shell.tsx", "utf8");

    expect(source).toContain("musicPlaybackStatus.isPlaying");
    expect(source).toContain("musicPlaybackStatus.projectId === tab.id");
    expect(source).toContain('aria-label="正在播放"');
  });

  it("画布只订阅稳定播放操作，不订阅逐帧播放会话", () => {
    const source = readFileSync("components/zenme/canvas-client.tsx", "utf8");

    expect(source).toContain("useMusicPlaybackActions");
    expect(source).toContain("useMusicPlaybackStatus");
    expect(source).not.toContain("musicPlayback.session");
    expect(source).not.toContain("musicCurrentTime: activeMusicSession.currentTime");
    expect(source).toContain("musicSourceNodeId: musicPlaybackStatus.currentSourceId");
  });
});
