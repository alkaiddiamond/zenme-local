"use client";

import type { NodeProps } from "@xyflow/react";
import { Captions, Check, ChevronDown, ChevronUp, Music2, Pause, Play, Repeat1, Repeat2, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  downsampleWaveform,
  getNextMusicLoopMode,
  MUSIC_WAVEFORM_VERSION,
  normalizeMusicLoopMode,
  normalizeMusicPlaybackTimes,
} from "@/components/zenme/canvas/music-workflow";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import { useMusicPlaybackSession } from "@/components/zenme/music-playback-provider";

export function MusicPlayerNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const playbackSession = useMusicPlaybackSession();
  const activeSession = playbackSession &&
    playbackSession.config.projectId === node.projectId &&
    playbackSession.config.playerNodeId === id
    ? playbackSession
    : undefined;
  const { current, duration } = normalizeMusicPlaybackTimes(
    activeSession?.duration ?? node.musicDuration,
    activeSession?.currentTime ?? node.musicCurrentTime,
  );
  const sources = node.musicSources ?? [];
  const activeSourceId = activeSession?.currentSourceId ?? node.musicSourceNodeId;
  const activeSource = sources.find((source) => source.id === activeSourceId) ?? sources[0];
  const activeRuntimeSource = activeSession?.config.sources.find(
    (source) => source.id === activeSource?.id,
  );
  const hasPlayableSource = Boolean(activeRuntimeSource?.url ?? node.originalUrl);
  const isPlaying = activeSession?.isPlaying ?? node.musicIsPlaying ?? false;
  const isLyricsOverlayOpen = Boolean(activeSession?.overlay);
  const isSourceListExpanded = node.musicSourceListExpanded !== false;
  const loopMode = normalizeMusicLoopMode(node.musicLoopMode, node.musicLoop);
  const loopModeLabel = getMusicLoopModeLabel(loopMode);
  const waveform = node.musicWaveform?.length &&
    node.musicWaveformSourceNodeId === activeSource?.id
    ? node.musicWaveform
    : null;
  const displayedWaveform = waveform ? downsampleWaveform(waveform) : null;
  const [waveformState, setWaveformState] = useState<"idle" | "loading" | "error">("idle");
  const onEnsureMusicWaveform = node.onEnsureMusicWaveform;
  const onEnsureMusicPlayback = node.onEnsureMusicPlayback;

  useEffect(() => {
    if (!node.originalUrl || !onEnsureMusicPlayback) return;
    onEnsureMusicPlayback(id);
  }, [id, node.originalUrl, onEnsureMusicPlayback]);

  useEffect(() => {
    if (
      waveform?.length &&
      node.musicWaveformSourceNodeId === activeSource?.id &&
      node.musicWaveformVersion === MUSIC_WAVEFORM_VERSION
    ) {
      setWaveformState("idle");
      return;
    }
    if (!node.originalUrl || !onEnsureMusicWaveform) return;
    let cancelled = false;
    setWaveformState("loading");
    void onEnsureMusicWaveform(id).catch(() => {
      if (!cancelled) setWaveformState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [activeSource?.id, id, node.musicWaveformSourceNodeId, node.musicWaveformVersion, node.originalUrl, onEnsureMusicWaveform, waveform]);

  return (
    <NodeFrame className="flex w-[560px] flex-col gap-2 p-3" selected={Boolean(selected)}>
      <div className="zenme-node-title-bar absolute -top-8 left-1 flex h-5 items-center gap-2 text-xs font-medium text-zinc-500">
        <Music2 className="size-4" />
        <span>音乐播放器</span>
      </div>
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <p aria-label="当前歌曲" className="h-5 shrink-0 truncate text-sm font-medium text-zinc-700" title={activeSource?.title}>
        {activeSource?.title ?? "尚未连接音乐"}
      </p>
      <div aria-label="音频波形" className="nodrag flex h-14 shrink-0 items-center gap-0.5 overflow-hidden rounded-md bg-zinc-50 px-2">
        {displayedWaveform ? displayedWaveform.map((value, index) => (
          <span
            className={duration && index / displayedWaveform.length <= current / duration ? "flex-1 bg-zinc-800" : "flex-1 bg-zinc-300"}
            key={index}
            style={{ height: `${Math.max(2, Math.min(100, Math.abs(value) * 100))}%` }}
          />
        )) : (
          <p className="w-full text-center text-xs text-zinc-400">
            {waveformState === "loading"
              ? "正在生成真实波形"
              : waveformState === "error"
                ? "本地波形生成失败，请检查音频文件格式"
                : "正在准备波形"}
          </p>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center gap-2">
        <span className="w-10 text-[11px] text-zinc-500">{formatTime(current)}</span>
        <input aria-label="播放进度" className="nodrag min-w-0 flex-1 accent-zinc-900" disabled={!duration} max={duration || 1} min={0} onChange={(event) => node.onSeekMusicPlayer?.(id, Number(event.currentTarget.value))} step={0.1} type="range" value={current} />
        <span className="w-10 text-right text-[11px] text-zinc-500">{formatTime(duration)}</span>
      </div>
      <div className="nodrag flex h-8 shrink-0 items-center gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-600">
        <button aria-label="上一首" className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-zinc-100 disabled:opacity-40" disabled={!hasPlayableSource} onClick={() => node.onSelectAdjacentMusicSource?.(id, "previous")} type="button">
          <SkipBack className="size-4" />
        </button>
        <button aria-label={isPlaying ? "暂停" : "播放"} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-40" disabled={!hasPlayableSource} onClick={() => node.onToggleMusicPlayback?.(id, !isPlaying)} type="button">
          {isPlaying ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
        <button aria-label="下一首" className="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-zinc-100 disabled:opacity-40" disabled={!hasPlayableSource} onClick={() => node.onSelectAdjacentMusicSource?.(id, "next")} type="button">
          <SkipForward className="size-4" />
        </button>
        <button aria-label={node.musicMuted ? "取消静音" : "静音"} aria-pressed={Boolean(node.musicMuted)} className="flex size-7 items-center justify-center rounded-md hover:bg-zinc-100" onClick={() => node.onUpdateMusicPlayback?.(id, { muted: !node.musicMuted })} type="button">
          {node.musicMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <input aria-label="音量" className="w-16 accent-zinc-900" max={1} min={0} onChange={(event) => node.onUpdateMusicPlayback?.(id, { volume: Number(event.currentTarget.value) })} step={0.05} type="range" value={node.musicVolume ?? 1} />
        <select aria-label="播放速度" className="h-7 rounded-md border border-zinc-200 bg-white px-2 outline-none" onChange={(event) => node.onUpdateMusicPlayback?.(id, { playbackRate: Number(event.currentTarget.value) })} value={node.musicPlaybackRate ?? 1}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        <button
          aria-label={`循环模式：${loopModeLabel}`}
          aria-pressed={loopMode !== "off"}
          className={`ml-auto ${musicOptionButtonClassName(loopMode !== "off")}`}
          onClick={() => node.onUpdateMusicPlayback?.(id, { loopMode: getNextMusicLoopMode(loopMode) })}
          title={`循环模式：${loopModeLabel}，点击切换`}
          type="button"
        >
          {loopMode === "one" ? <Repeat1 className="size-4" /> : <Repeat2 className="size-4" />}
        </button>
        <button
          aria-label={isLyricsOverlayOpen ? "关闭歌词覆层" : "打开歌词覆层"}
          aria-pressed={isLyricsOverlayOpen}
          className={musicOptionButtonClassName(isLyricsOverlayOpen)}
          onClick={() => node.onToggleMusicLyricsOverlay?.(id)}
          title={isLyricsOverlayOpen ? "关闭歌词覆层" : "打开歌词覆层"}
          type="button"
        >
          <Captions className="size-4" />
        </button>
        <button
          aria-expanded={isSourceListExpanded}
          aria-label={isSourceListExpanded ? "收起音乐列表" : "展开音乐列表"}
          className={musicOptionButtonClassName(isSourceListExpanded)}
          onClick={() => node.onUpdateMusicPlayback?.(id, { sourceListExpanded: !isSourceListExpanded })}
          title={isSourceListExpanded ? "收起音乐列表" : "展开音乐列表"}
          type="button"
        >
          {isSourceListExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
      {isSourceListExpanded ? (
        <section aria-label="已连接音乐列表" className="nodrag nowheel mt-1 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-white">
          <div className="flex h-8 items-center gap-2 border-b border-zinc-100 px-2 text-xs text-zinc-600">
            <span className="font-medium">已连接音乐</span>
            <span className="text-zinc-400">{sources.length} 首</span>
          </div>
          {sources.length ? (
            <OverlayScrollArea
              contentKey={sources.map((source) => source.id).join("|")}
              viewportClassName="max-h-[128px] overflow-y-auto"
            >
              <ul>
              {sources.map((source) => {
                const isActive = source.id === activeSource?.id;
                return (
                  <li key={source.id}>
                    <button
                      aria-label={`选择歌曲 ${source.title}`}
                      aria-pressed={isActive}
                      className={`flex h-8 w-full items-center gap-2 px-2 text-left text-xs ${isActive ? "bg-zinc-100 text-zinc-900" : "text-zinc-600 hover:bg-zinc-50"}`}
                      onClick={() => node.onSelectMusicSource?.(id, source.id)}
                      title={source.title}
                      type="button"
                    >
                      {isActive ? <Check className="size-3.5 shrink-0" /> : <Music2 className="size-3.5 shrink-0 text-zinc-400" />}
                      <span className="truncate">{source.title}</span>
                    </button>
                  </li>
                );
              })}
              </ul>
            </OverlayScrollArea>
          ) : (
            <p className="px-2 py-3 text-center text-xs text-zinc-400">连接音乐文件后将在这里显示</p>
          )}
        </section>
      ) : null}
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function formatTime(seconds: number) { const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`; }

function musicOptionButtonClassName(active: boolean) {
  return `nodrag nowheel flex size-9 shrink-0 items-center justify-center rounded-md border transition-colors ${active
    ? "border-zinc-300 bg-zinc-100 text-zinc-900"
    : "border-zinc-200 bg-zinc-50 text-zinc-500 hover:border-zinc-300 hover:bg-white hover:text-zinc-800"}`;
}

function getMusicLoopModeLabel(mode: "off" | "one" | "all") {
  if (mode === "one") return "单曲循环";
  if (mode === "all") return "列表循环";
  return "不循环";
}
