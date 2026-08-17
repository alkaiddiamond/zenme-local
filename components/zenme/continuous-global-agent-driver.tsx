"use client";

import { useEffect } from "react";

import type { ContinuousGlobalAgentState } from "@/lib/global-agent/continuous-types";
import { getContinuousGlobalAgentFromApi, runContinuousGlobalAgentFromApi } from "@/lib/zenme-api";

const POLL_INTERVAL_MS = 30_000;

export function ContinuousGlobalAgentDriver({ projectId }: { projectId: string }) {
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;

    async function tick() {
      controller = new AbortController();
      try {
        const state = await getContinuousGlobalAgentFromApi(projectId);
        if (!disposed && shouldRunContinuousGlobalAgent(state, Date.now())) {
          await runContinuousGlobalAgentFromApi(projectId, controller.signal);
        }
      } catch {
        // The durable runtime owns backoff and recovery; this invisible driver
        // must never surface transient provider failures as canvas errors.
      } finally {
        if (!disposed) timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }

    timer = setTimeout(tick, 3_000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [projectId]);

  return null;
}

export function ContinuousGlobalAgentSupervisor({ projectIds }: { projectIds: string[] }) {
  return normalizeContinuousGlobalAgentProjectIds(projectIds).map((projectId) => (
    <ContinuousGlobalAgentDriver key={projectId} projectId={projectId} />
  ));
}

export function normalizeContinuousGlobalAgentProjectIds(projectIds: string[]) {
  return [...new Set(projectIds.map((projectId) => projectId.trim()).filter(Boolean))];
}

export function shouldRunContinuousGlobalAgent(state: ContinuousGlobalAgentState, now: number) {
  if (state.mode !== "enabled" || state.status === "running") return false;
  if (!state.events.some((event) => event.sequence > state.checkpoint.lastProcessedSequence)) return false;
  if (state.status !== "backoff") return true;
  return Boolean(state.checkpoint.cooldownUntil && Date.parse(state.checkpoint.cooldownUntil) <= now);
}
