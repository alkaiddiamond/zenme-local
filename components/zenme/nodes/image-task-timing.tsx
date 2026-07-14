"use client";

import { useEffect, useState } from "react";

export function ImageTaskTiming({
  className,
  durationMs,
  running,
  startedAt,
}: {
  className?: string;
  durationMs?: number;
  running: boolean;
  startedAt?: string;
}) {
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !startedAt) return;
    setCurrentTime(Date.now());
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);

  const startedTime = startedAt ? Date.parse(startedAt) : Number.NaN;
  const elapsed = running && Number.isFinite(startedTime)
    ? Math.max(0, currentTime - startedTime)
    : durationMs;

  if (elapsed === undefined) return null;

  return (
    <span className={className ?? "pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-white/90 px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-500 shadow-sm backdrop-blur"}>
      {running ? "执行中 " : "耗时 "}{formatDuration(elapsed)}
    </span>
  );
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, "0")}` : `${seconds} 秒`;
}
