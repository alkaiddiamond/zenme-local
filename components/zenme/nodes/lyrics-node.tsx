"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Check, Copy, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CanvasNodeData, MusicLyricLine } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import {
  NodeActionHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { MusicChildExpandButton } from "@/components/zenme/nodes/music-child-expand-button";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import { useMusicPlaybackSession } from "@/components/zenme/music-playback-provider";
import { writeTextToClipboard } from "@/lib/clipboard";

export function groupLyrics(lines: MusicLyricLine[]) {
  return lines.reduce<Array<{ label: string; lines: MusicLyricLine[] }>>((groups, line) => {
    const label = line.section?.trim() || "";
    const last = groups.at(-1);
    if (last?.label === label) last.lines.push(line);
    else groups.push({ label, lines: [line] });
    return groups;
  }, []);
}

export function formatLyricsForClipboard(lines: MusicLyricLine[]) {
  return lines
    .map((line) => `${formatTime(line.start)} ${line.text}`.trim())
    .join("\n");
}

export function LyricsNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const playbackSession = useMusicPlaybackSession();
  const activeSession = playbackSession &&
    playbackSession.config.projectId === node.projectId &&
    playbackSession.config.playerNodeId === node.musicParentPlayerNodeId
    ? playbackSession
    : undefined;
  const [copied, setCopied] = useState(false);
  const lines = node.musicLyrics ?? [];
  const activeTime = activeSession?.currentTime ?? node.musicCurrentTime ?? 0;
  const activeLine = lines.find(
    (line) => activeTime >= line.start && activeTime < (line.end ?? Number.POSITIVE_INFINITY),
  );
  const activeLineKey = activeLine?.id ?? activeLine?.start;
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeLineKey]);
  useEffect(
    () => () => {
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
      }
    },
    [],
  );
  async function copyLyrics() {
    const text = formatLyricsForClipboard(lines);
    if (!text || !(await writeTextToClipboard(text))) {
      return;
    }

    setCopied(true);
    if (copyResetTimer.current) {
      clearTimeout(copyResetTimer.current);
    }
    copyResetTimer.current = setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <NodeFrame className="flex h-full min-h-[176px] w-full min-w-[420px] flex-col p-4" selected={Boolean(selected)}>
      <div className="zenme-node-title-bar absolute -top-8 left-1 flex h-5 items-center gap-2 text-xs font-medium text-zinc-500">
        <FileText className="size-4" />
        <span>歌词</span>
      </div>
      <MusicChildExpandButton className="right-12" node={node} nodeId={id} />
      <button
        aria-label={copied ? "歌词已复制" : "复制歌词"}
        className="nodrag absolute right-3 top-3 z-20 flex size-7 items-center justify-center rounded-md bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!lines.length}
        onClick={() => void copyLyrics()}
        title={copied ? "已复制" : "复制歌词"}
        type="button"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
      {node.lyricsFetchDurationMs !== undefined ? (
        <span className="pointer-events-none absolute -top-8 right-1 h-5 text-xs tabular-nums text-zinc-400">
          {formatCompactDuration(node.lyricsFetchDurationMs)}
        </span>
      ) : null}
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <NodeContextTargetHandle />
      {node.lyricsFetchStatus === "failed" ? (
        <div className="nodrag mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-600" aria-live="polite">
          {node.musicError || "歌词获取失败"}
        </div>
      ) : node.lyricsWarnings?.length ? (
        <div className="nodrag mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" aria-live="polite">
          {node.lyricsWarnings[0]}
        </div>
      ) : null}
      <OverlayScrollArea
        className="nodrag nowheel min-h-0 flex-1"
        contentKey={`${lines.length}:${activeLineKey ?? ""}`}
        viewportClassName="h-full space-y-4 overflow-auto pr-1"
      >
        {groupLyrics(lines).map((group, groupIndex) => <section key={`${group.label}-${groupIndex}`}>{group.label ? <p className={`sticky top-0 bg-white py-1 text-[11px] font-medium ${activeLine?.section === group.label ? "text-zinc-950" : "text-zinc-400"}`}>{group.label}</p> : null}<div className="space-y-0.5">{group.lines.map((line, index) => {
          const active = activeTime >= line.start && activeTime < (line.end ?? Number.POSITIVE_INFINITY);
          return <button className={`flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-600 hover:bg-zinc-50"}`} key={line.id || `${line.start}-${index}`} onClick={() => node.musicParentPlayerNodeId && node.onSeekMusicPlayer?.(node.musicParentPlayerNodeId, line.start)} ref={active ? activeLineRef : undefined} type="button"><span className="w-10 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-400">{formatTime(line.start)}</span><span>{line.text}</span></button>;
        })}</div></section>)}
        {!lines.length ? <p className="py-10 text-center text-xs text-zinc-400">{node.lyricsWarnings?.[0] || (node.lyricsFetchStatus === "failed" ? node.musicError : "正在获取同步歌词")}</p> : null}
      </OverlayScrollArea>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected)}
        lineClassName="zenme-text-resize-line"
        minHeight={176}
        minWidth={420}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </NodeFrame>
  );
}

function formatTime(seconds: number) { const safe = Math.max(0, seconds); return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`; }

export function formatCompactDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
