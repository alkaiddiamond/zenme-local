"use client";

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { downsampleWaveform } from "@/components/zenme/canvas/music-workflow";
import { NodeFrame } from "@/components/zenme/nodes/node-frame";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { NodeActionHandle, NodeEdgeSourceHandle, NodeTargetHandle } from "@/components/zenme/node-ui";
import { renderMarkdown } from "@/components/zenme/nodes/renderers/markdown";
import { MusicJobStatus, useMusicJob } from "@/components/zenme/nodes/use-music-job";
import { MusicChildExpandButton } from "@/components/zenme/nodes/music-child-expand-button";

type Segment = { start?: number; end?: number; label?: string };
type Analysis = {
  input?: { duration?: number; codec?: string; sampleRate?: number };
  summary?: Record<string, { value?: unknown }>;
  segments?: Segment[];
  waveform?: number[];
  lyrics?: Array<{ start?: number; text?: string }>;
  chords?: Array<{ start?: number; value?: string }>;
  report?: { markdown?: string };
  warnings?: Array<{ message?: string }>;
};

export function MusicAnalysisNode({ data, selected, id }: NodeProps) {
  const node = data as CanvasNodeData;
  const [loadedResult, setLoadedResult] = useState<Analysis | null>(
    () => node.musicAnalysisResult ? node.musicAnalysisResult as Analysis : null,
  );
  const [loadError, setLoadError] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  useMusicJob(id, node);
  useEffect(() => {
    if (loadedResult || !node.musicJobId) return;
    const jobId = node.musicJobId;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function loadResult() {
      try {
        const response = await fetch(`/api/music/jobs/${jobId}/result`, { cache: "no-store" });
        if (!response.ok) throw new Error("分析结果暂不可用");
        const result = await response.json() as Analysis;
        if (!disposed) {
          setLoadedResult(result);
          setLoadError("");
        }
      } catch {
        if (disposed) return;
        setLoadError("正在重新连接本地音乐分析服务…");
        timer = setTimeout(() => void loadResult(), 2_000);
      }
    }

    void loadResult();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [loadedResult, node.musicJobId]);
  const result = loadedResult ?? {};
  const duration = Math.max(0, result.input?.duration ?? 0);
  const bpm = result.summary?.bpm?.value;
  const key = result.summary?.key?.value;
  const loudness = result.summary?.loudness?.value as { integratedLufs?: number } | undefined;
  const displayedWaveform = downsampleWaveform(result.waveform ?? [], 180);
  return (
    <NodeFrame className={`flex h-full min-h-[176px] w-full min-w-[420px] flex-col p-4 ${isRenaming ? "zenme-node-renaming" : ""}`} selected={Boolean(selected)}>
      <MusicChildExpandButton node={node} nodeId={id} />
      <EditableNodeTitle fallbackTitle="综合分析" icon={<BarChart3 className="size-4" />} onCommit={(title) => node.onUpdateMusicNode?.(id, { title })} onEditingChange={setIsRenaming} title={node.title} />
      <NodeTargetHandle visible={Boolean(node.hasIncomingEdge || node.musicParentPlayerNodeId)} />
      <NodeEdgeSourceHandle visible={Boolean(node.hasOutgoingEdge)} />
      <div className="nodrag nowheel min-h-0 flex-1 overflow-auto pr-1">
      <p className="text-xs text-zinc-500">播放器综合分析</p>
      <MusicJobStatus node={node} nodeId={id} />
      {loadError ? <p className="mt-2 text-xs text-amber-700">{loadError}</p> : null}
      <div className="mt-3 grid grid-cols-5 gap-2 text-xs">
        <Metric label="时长" value={formatTime(duration)} />
        <Metric label="BPM" value={typeof bpm === "number" ? bpm.toFixed(1) : "—"} />
        <Metric label="调性" value={typeof key === "string" ? key : "—"} />
        <Metric label="响度" value={typeof loudness?.integratedLufs === "number" ? `${loudness.integratedLufs.toFixed(1)} LUFS` : "—"} />
        <Metric label="格式" value={result.input?.codec || "—"} />
      </div>
      <div className="mt-4 flex h-16 items-end gap-px overflow-hidden rounded-md bg-zinc-50 px-2 py-1" aria-label="音频波形">
        {displayedWaveform.map((value, index) => (
          <span className="min-w-px flex-1 bg-zinc-400" key={index} style={{ height: `${Math.max(2, Math.min(100, value * 100))}%` }} />
        ))}
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs text-zinc-500">结构时间轴</p>
        <div className="flex h-9 overflow-hidden rounded-md border border-zinc-200">
          {(result.segments?.length ? result.segments : [{ start: 0, end: duration, label: "完整音频" }]).map((segment, index) => {
            const width = duration > 0 ? Math.max(2, ((segment.end ?? duration) - (segment.start ?? 0)) / duration * 100) : 100;
            return <div className="flex items-center justify-center border-r border-white bg-zinc-100 px-1 text-[10px] text-zinc-600" key={`${segment.start}-${index}`} style={{ width: `${width}%` }} title={`${segment.label || "Section"} ${formatTime(segment.start ?? 0)}`}>{segment.label || "Section"}</div>;
          })}
        </div>
      </div>
      {(result.lyrics?.length || result.chords?.length) ? <div className="nowheel mt-4 max-h-40 overflow-auto rounded-md bg-zinc-50 p-3 text-xs">
        {(result.lyrics ?? []).slice(0, 30).map((line, index) => <p key={index}><span className="mr-2 text-zinc-400">{formatTime(line.start ?? 0)}</span>{line.text}</p>)}
        {(result.chords ?? []).slice(0, 30).map((chord, index) => <span className="mr-2 inline-block" key={index}>{formatTime(chord.start ?? 0)} {chord.value}</span>)}
      </div> : null}
      {result.report?.markdown ? (
        <section className="mt-4">
          <p className="mb-2 text-xs text-zinc-500">完整可读报告</p>
          <div className="nodrag nowheel max-h-[520px] overflow-auto rounded-md border border-zinc-200 bg-white p-4 text-sm">
            {renderMarkdown(result.report.markdown)}
          </div>
        </section>
      ) : null}
      {(result.warnings ?? []).map((warning, index) => <p className="mt-2 text-xs text-amber-700" key={index}>{warning.message}</p>)}
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

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-zinc-50 p-2"><p className="text-zinc-400">{label}</p><p className="mt-1 truncate text-zinc-700">{value}</p></div>;
}

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}
