"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { CanvasNodeData, MusicLyricLine } from "@/components/zenme/node-types";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { MusicJobStatus, MusicJobTiming, useMusicJob } from "@/components/zenme/nodes/use-music-job";
import { MusicChildExpandButton } from "@/components/zenme/nodes/music-child-expand-button";

export function groupLyrics(lines: MusicLyricLine[]) {
  return lines.reduce<Array<{ label: string; lines: MusicLyricLine[] }>>((groups, line) => {
    const label = line.section?.trim() || "歌词";
    const last = groups.at(-1);
    if (last?.label === label) last.lines.push(line);
    else groups.push({ label, lines: [line] });
    return groups;
  }, []);
}

export function LyricsNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const [isRenaming, setIsRenaming] = useState(false);
  const lines = node.musicLyrics ?? [];
  const activeTime = node.musicCurrentTime ?? 0;
  const activeLine = lines.find(
    (line) => activeTime >= line.start && activeTime < (line.end ?? Number.POSITIVE_INFINITY),
  );
  const activeLineKey = activeLine?.id ?? activeLine?.start;
  const activeLineRef = useRef<HTMLButtonElement | null>(null);
  useMusicJob(id, node);
  useEffect(() => {
    activeLineRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeLineKey]);
  return (
    <NodeFrame className={`flex h-full min-h-[176px] w-full min-w-[420px] flex-col p-4 ${isRenaming ? "zenme-node-renaming" : ""}`} selected={Boolean(selected)}>
      <MusicChildExpandButton node={node} nodeId={id} />
      <EditableNodeTitle fallbackTitle="歌词与结构" icon={<FileText className="size-4" />} onCommit={(title) => node.onUpdateMusicNode?.(id, { title })} onEditingChange={setIsRenaming} title={node.title} />
      <MusicJobTiming node={node} />
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <MusicJobStatus hideDuration hideSucceeded node={node} nodeId={id} />
      <div className="nodrag nowheel min-h-0 flex-1 space-y-4 overflow-auto pr-1">
        {groupLyrics(lines).map((group, groupIndex) => <section key={`${group.label}-${groupIndex}`}><p className={`sticky top-0 bg-white py-1 text-[11px] font-medium ${activeLine?.section === group.label ? "text-zinc-950" : "text-zinc-400"}`}>{group.label}</p><div className="space-y-0.5">{group.lines.map((line, index) => {
          const active = activeTime >= line.start && activeTime < (line.end ?? Number.POSITIVE_INFINITY);
          return <button className={`flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left text-sm ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-600 hover:bg-zinc-50"}`} key={line.id || `${line.start}-${index}`} onClick={() => node.musicParentPlayerNodeId && node.onSeekMusicPlayer?.(node.musicParentPlayerNodeId, line.start)} ref={active ? activeLineRef : undefined} type="button"><span className="w-10 shrink-0 pt-0.5 font-mono text-[10px] text-zinc-400">{formatTime(line.start)}</span><span>{line.text}</span></button>;
        })}</div></section>)}
        {!lines.length ? <p className="py-10 text-center text-xs text-zinc-400">{node.musicWarnings?.[0] || (node.musicJobStatus === "failed" ? node.musicError : "等待歌词分析结果")}</p> : null}
      </div>
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
