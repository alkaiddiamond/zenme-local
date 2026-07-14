"use client";

import { useEffect, useRef, useState } from "react";

import type { CanvasNodeData, MusicJobSnapshot } from "@/components/zenme/node-types";

const ACTIVE = new Set(["queued", "preparing", "running"]);

export function useMusicJob(nodeId: string, node: CanvasNodeData) {
  const completedJobRef = useRef<string | null>(null);
  const jobId = node.musicJobId;
  const status = node.musicJobStatus;
  const onMusicJobUpdate = node.onMusicJobUpdate;
  const onMusicAnalysisComplete = node.onMusicAnalysisComplete;

  useEffect(() => {
    if (!jobId || !status || !ACTIVE.has(status) || !onMusicJobUpdate) return;
    let disposed = false;
    const refresh = async () => {
      const response = await fetch(`/api/music/jobs/${encodeURIComponent(jobId)}`);
      if (!disposed && response.ok) {
        onMusicJobUpdate(nodeId, await response.json() as MusicJobSnapshot);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [jobId, nodeId, onMusicJobUpdate, status]);

  useEffect(() => {
    if (
      !jobId ||
      status !== "succeeded" ||
      node.musicJobDurationMs !== undefined ||
      !onMusicJobUpdate
    ) return;
    let disposed = false;
    void fetch(`/api/music/jobs/${encodeURIComponent(jobId)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((snapshot: MusicJobSnapshot | null) => {
        if (!disposed && snapshot) onMusicJobUpdate(nodeId, snapshot);
      });
    return () => {
      disposed = true;
    };
  }, [jobId, node.musicJobDurationMs, nodeId, onMusicJobUpdate, status]);

  useEffect(() => {
    if (
      !jobId ||
      status !== "succeeded" ||
      !onMusicAnalysisComplete ||
      completedJobRef.current === jobId ||
      node.musicAnalysisResult
    ) return;
    let disposed = false;
    void fetch(`/api/music/jobs/${encodeURIComponent(jobId)}/result`)
      .then((response) => response.ok ? response.json() : null)
      .then((result: Record<string, unknown> | null) => {
        if (!disposed && result) {
          completedJobRef.current = jobId;
          onMusicAnalysisComplete(nodeId, jobId, result);
        }
      });
    return () => {
      disposed = true;
    };
  }, [jobId, node.musicAnalysisResult, nodeId, onMusicAnalysisComplete, status]);
}

export function MusicJobStatus({
  hideDuration = false,
  hideSucceeded = false,
  node,
  nodeId,
}: {
  hideDuration?: boolean;
  hideSucceeded?: boolean;
  node: CanvasNodeData;
  nodeId: string;
}) {
  const status = node.musicJobStatus;
  const active = Boolean(status && ACTIVE.has(status));
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!status) return null;
  const progress = Math.round(Math.max(0, Math.min(1, node.musicProgress ?? 0)) * 100);
  const startedAt = Date.parse(node.musicJobStartedAt || node.musicJobCreatedAt || "");
  const liveElapsed = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
  const elapsed = active
    ? Math.max(node.musicJobElapsedMs ?? 0, liveElapsed)
    : node.musicJobDurationMs ?? node.musicJobElapsedMs ?? liveElapsed;
  const warnings = node.musicWarnings ?? [];
  if (status === "succeeded") {
    if (hideSucceeded && !warnings.length) return null;
    return (
      <div className={`nodrag mb-3 flex items-center justify-between gap-3 rounded-md px-3 py-2 text-xs ${warnings.length ? "bg-amber-50 text-amber-800" : "bg-zinc-50 text-zinc-500"}`} aria-live="polite">
        <span>{warnings[0] || node.musicStageLabel || "分析完成"}</span>
        {!hideDuration ? <span className="shrink-0">用时 {formatDuration(elapsed)}</span> : null}
      </div>
    );
  }
  return (
    <div className="nodrag mb-3 rounded-md bg-zinc-50 p-3 text-xs" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className={status === "failed" ? "text-red-600" : "text-zinc-600"}>
          {node.musicError || node.musicStageLabel || statusLabel(status)}
        </span>
        {!hideDuration ? <span className="ml-auto shrink-0 text-zinc-500">{active ? "已运行" : "用时"} {formatDuration(elapsed)}</span> : null}
        {active && node.musicJobId ? (
          <button className="text-zinc-500 hover:text-zinc-950" onClick={() => void node.onCancelMusicAnalysis?.(nodeId, node.musicJobId!)} type="button">取消</button>
        ) : status === "failed" && node.musicRetryable && node.musicJobId ? (
          <button className="text-zinc-700 hover:text-zinc-950" onClick={() => void node.onRetryMusicAnalysis?.(nodeId, node.musicJobId!)} type="button">重试</button>
        ) : null}
      </div>
      {active ? <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-200"><div className="h-full bg-zinc-700" style={{ width: `${progress}%` }} /></div> : null}
    </div>
  );
}

export function MusicJobTiming({ node }: { node: CanvasNodeData }) {
  const status = node.musicJobStatus;
  const active = Boolean(status && ACTIVE.has(status));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!status || status === "queued") return null;
  const startedAt = Date.parse(node.musicJobStartedAt || node.musicJobCreatedAt || "");
  const liveElapsed = Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
  const elapsed = active
    ? Math.max(node.musicJobElapsedMs ?? 0, liveElapsed)
    : node.musicJobDurationMs ?? node.musicJobElapsedMs;
  if (elapsed === undefined) return null;

  return (
    <span className="pointer-events-none absolute -top-8 right-1 h-5 text-xs tabular-nums text-zinc-400">
      {formatCompactDuration(elapsed)}
    </span>
  );
}

export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

export function formatCompactDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function statusLabel(status: NonNullable<CanvasNodeData["musicJobStatus"]>) {
  return ({
    queued: "等待分析",
    preparing: "正在准备",
    running: "正在分析",
    succeeded: "分析完成",
    failed: "分析失败",
    cancelled: "已取消",
  })[status];
}
