import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("music player node", () => {
  const source = readFileSync(
    new URL("./music-player-node.tsx", import.meta.url),
    "utf8",
  );

  it("uses the fixed product name and renders a collapsible connected-music list", () => {
    expect(source).toContain("<span>音乐播放器</span>");
    expect(source).toContain('zenme-node-title-bar absolute -top-8 left-1');
    expect(source).toContain("aria-label={isSourceListExpanded ? \"收起音乐列表\" : \"展开音乐列表\"}");
    expect(source).toContain("sources.map((source)");
  });

  it("places the list toggle after loop and the list below the player controls", () => {
    const loopIndex = source.indexOf("循环模式：");
    const toggleIndex = source.indexOf('aria-expanded={isSourceListExpanded}');
    const listIndex = source.indexOf('aria-label="已连接音乐列表"');

    expect(toggleIndex).toBeGreaterThan(loopIndex);
    expect(listIndex).toBeGreaterThan(toggleIndex);
  });

  it("uses the same visual style helper for loop and list controls", () => {
    expect(source).toContain('musicOptionButtonClassName(loopMode !== "off")');
    expect(source).toContain("musicOptionButtonClassName(isSourceListExpanded)");
  });

  it("cycles between off, single-track loop, and playlist loop", () => {
    expect(source).toContain("getNextMusicLoopMode(loopMode)");
    expect(source).toContain("<Repeat1");
    expect(source).toContain("单曲循环");
    expect(source).toContain("列表循环");
    expect(source).toContain("不循环");
  });

  it("opens the movable lyrics overlay beside the loop control", () => {
    const loopIndex = source.indexOf("循环模式：");
    const lyricsOverlayIndex = source.indexOf("打开歌词覆层");

    expect(lyricsOverlayIndex).toBeGreaterThan(loopIndex);
    expect(source).toContain("onToggleMusicLyricsOverlay?.(id)");
  });

  it("shows the selected song name directly above the waveform", () => {
    const songTitleIndex = source.indexOf('aria-label="当前歌曲"');
    const waveformIndex = source.indexOf('aria-label="音频波形"');

    expect(songTitleIndex).toBeGreaterThan(-1);
    expect(waveformIndex).toBeGreaterThan(songTitleIndex);
  });

  it("moves playback and adjacent-track controls to the volume row", () => {
    const progressRowIndex = source.indexOf(
      '<div className="flex h-8 shrink-0 items-center gap-2">',
    );
    const volumeRowIndex = source.indexOf(
      '<div className="nodrag flex h-8 shrink-0 items-center gap-2 border-t',
    );
    const previousIndex = source.indexOf('aria-label="上一首"');
    const playbackIndex = source.indexOf(
      'aria-label={node.musicIsPlaying ? "暂停" : "播放"}',
    );
    const nextIndex = source.indexOf('aria-label="下一首"');
    const volumeIndex = source.indexOf(
      'aria-label={node.musicMuted ? "取消静音" : "静音"}',
    );

    expect(previousIndex).toBeGreaterThan(volumeRowIndex);
    expect(playbackIndex).toBeGreaterThan(previousIndex);
    expect(nextIndex).toBeGreaterThan(playbackIndex);
    expect(volumeIndex).toBeGreaterThan(nextIndex);
    expect(playbackIndex).toBeGreaterThan(progressRowIndex);
    expect(source).toContain('onSelectAdjacentMusicSource?.(id, "previous")');
    expect(source).toContain('onSelectAdjacentMusicSource?.(id, "next")');
  });
});
