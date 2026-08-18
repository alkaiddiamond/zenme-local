import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  normalizeContinuousGlobalAgentProjectIds,
  shouldRunContinuousGlobalAgent,
} from "@/components/zenme/continuous-global-agent-driver";
import type { ContinuousGlobalAgentState } from "@/lib/global-agent/continuous-types";

function state(input: Partial<ContinuousGlobalAgentState>): ContinuousGlobalAgentState {
  return {
    version: 1, projectId: "project-1", mode: "enabled", status: "idle", modelId: "provider:model",
    budget: { maxRunsPerHour: 6, maxEventsPerRun: 50, maxTokensPerHour: 100_000, cooldownMs: 1_000 },
    checkpoint: { lastProcessedSequence: 0, contextSummary: "", waitingItems: [], consecutiveFailures: 0, windowStartedAt: new Date(0).toISOString(), runsInWindow: 0, tokensInWindow: 0 },
    events: [{ id: "event-1", sequence: 1, type: "manual.requested", source: "user", sourceId: "request-1", idempotencyKey: "request-1", createdAt: new Date(0).toISOString() }], runs: [], suggestions: [], createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(),
    ...input,
  };
}

describe("Continuous Global Agent canvas driver", () => {
  it("only wakes enabled idle runtimes or expired backoff", () => {
    expect(shouldRunContinuousGlobalAgent(state({}), 2_000)).toBe(true);
    expect(shouldRunContinuousGlobalAgent(state({ mode: "paused", status: "paused" }), 2_000)).toBe(false);
    expect(shouldRunContinuousGlobalAgent(state({ status: "running" }), 2_000)).toBe(false);
    expect(shouldRunContinuousGlobalAgent(state({ status: "backoff", checkpoint: { ...state({}).checkpoint, cooldownUntil: new Date(3_000).toISOString() } }), 2_000)).toBe(false);
    expect(shouldRunContinuousGlobalAgent(state({ status: "backoff", checkpoint: { ...state({}).checkpoint, cooldownUntil: new Date(1_000).toISOString() } }), 2_000)).toBe(true);
    expect(shouldRunContinuousGlobalAgent(state({ events: [] }), 2_000)).toBe(false);
  });

  it("normalizes the app-wide project set so a project only has one polling driver", () => {
    expect(normalizeContinuousGlobalAgentProjectIds([
      "project-1",
      " project-2 ",
      "project-1",
      "",
    ])).toEqual(["project-1", "project-2"]);
  });

  it("uses one app-wide supervisor request instead of one polling driver per project", () => {
    const source = readFileSync(new URL("./continuous-global-agent-driver.tsx", import.meta.url), "utf8");
    expect(source).toContain("getContinuousGlobalAgentSupervisorStatesFromApi(normalizedProjectIds)");
    expect(source).not.toContain("<ContinuousGlobalAgentDriver");
    expect(source).not.toContain("getContinuousGlobalAgentFromApi(projectId)");
  });
});
