"use client";

import type { NodeProps } from "@xyflow/react";
import { Music2, Pause, Play, Repeat2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  downsampleWaveform,
  MUSIC_WAVEFORM_VERSION,
} from "@/components/zenme/canvas/music-workflow";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";

export function MusicPlayerNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const duration = Math.max(0, node.musicDuration ?? 0);
  const current = Math.max(0, Math.min(duration || Infinity, node.musicCurrentTime ?? 0));
  const waveform = node.musicWaveform?.length ? node.musicWaveform : null;
  const displayedWaveform = waveform ? downsampleWaveform(waveform) : null;
  const [isRenaming, setIsRenaming] = useState(false);
  const [waveformState, setWaveformState] = useState<"idle" | "loading" | "error">("idle");
  const onEnsureMusicWaveform = node.onEnsureMusicWaveform;

  useEffect(() => {
    if (waveform?.length && node.musicWaveformVersion === MUSIC_WAVEFORM_VERSION) {
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
  }, [id, node.musicWaveformVersion, node.originalUrl, onEnsureMusicWaveform, waveform]);

  return (
    <NodeFrame className={`h-[320px] w-[520px] p-4 ${isRenaming ? "zenme-node-renaming" : ""}`} selected={Boolean(selected)}>
      <EditableNodeTitle fallbackTitle="播放器" icon={<Music2 className="size-4" />} onCommit={(title) => node.onUpdateMusicNode?.(id, { title })} onEditingChange={setIsRenaming} title={node.title} />
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{node.fileName || "等待上游音乐"}</p><p className="truncate text-xs text-zinc-500">音乐播放器</p></div>
        <button aria-label={node.musicIsPlaying ? "暂停" : "播放"} className="nodrag flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white disabled:opacity-40" disabled={!node.originalUrl} onClick={() => node.onToggleMusicPlayback?.(id, !node.musicIsPlaying)} type="button">
          {node.musicIsPlaying ? <Pause className="size-4" /> : <Play className="ml-0.5 size-4" />}
        </button>
      </div>
      <div aria-label="音频波形" className="nodrag mt-4 flex h-20 items-center gap-0.5 overflow-hidden rounded-md bg-zinc-50 px-3">
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
                ? "波形生成失败，重新打开播放器后重试"
                : "正在准备波形"}
          </p>
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <span className="w-10 text-[11px] text-zinc-500">{formatTime(current)}</span>
        <input aria-label="播放进度" className="nodrag min-w-0 flex-1 accent-zinc-900" disabled={!duration} max={duration || 1} min={0} onChange={(event) => node.onSeekMusicPlayer?.(id, Number(event.currentTarget.value))} step={0.1} type="range" value={current} />
        <span className="w-10 text-right text-[11px] text-zinc-500">{formatTime(duration)}</span>
      </div>
      <div className="nodrag mt-3 flex h-9 items-center gap-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
        <button aria-label={node.musicMuted ? "取消静音" : "静音"} aria-pressed={Boolean(node.musicMuted)} className="flex size-7 items-center justify-center rounded-md hover:bg-zinc-100" onClick={() => node.onUpdateMusicPlayback?.(id, { muted: !node.musicMuted })} type="button">
          {node.musicMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
        <input aria-label="音量" className="w-24 accent-zinc-900" max={1} min={0} onChange={(event) => node.onUpdateMusicPlayback?.(id, { volume: Number(event.currentTarget.value) })} step={0.05} type="range" value={node.musicVolume ?? 1} />
        <select aria-label="播放速度" className="h-7 rounded-md border border-zinc-200 bg-white px-2 outline-none" onChange={(event) => node.onUpdateMusicPlayback?.(id, { playbackRate: Number(event.currentTarget.value) })} value={node.musicPlaybackRate ?? 1}>
          {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
        </select>
        <button aria-label="循环播放" aria-pressed={Boolean(node.musicLoop)} className={`ml-auto flex size-7 items-center justify-center rounded-md ${node.musicLoop ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"}`} onClick={() => node.onUpdateMusicPlayback?.(id, { loop: !node.musicLoop })} type="button"><Repeat2 className="size-4" /></button>
      </div>
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function formatTime(seconds: number) { const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`; }
