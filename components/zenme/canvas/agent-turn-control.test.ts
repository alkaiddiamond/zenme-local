import { describe, expect, it } from "vitest";

import {
  AGENT_TURN_STOP_DEBOUNCE_MS,
  canStopNodeAgentTurn,
  resolveNodeAgentTurnId,
} from "@/components/zenme/canvas/agent-turn-control";
import type { CanvasNode } from "@/components/zenme/canvas/types";

function node(id: string, agentTurnId?: string): CanvasNode {
  return {
    id,
    type: "agent",
    position: { x: 0, y: 0 },
    data: { agentTurnId, kind: "agent", title: "AI 回复" },
  };
}

describe("canvas Agent Turn controls", () => {
  it("ignores a second activation during the submit-to-stop debounce window", () => {
    const active = {
      resultNodeId: "result",
      sourceNodeId: "source",
      startedAt: 10_000,
      turnId: "live-turn",
    };

    expect(canStopNodeAgentTurn(active, 10_000 + AGENT_TURN_STOP_DEBOUNCE_MS - 1)).toBe(false);
    expect(canStopNodeAgentTurn(active, 10_000 + AGENT_TURN_STOP_DEBOUNCE_MS)).toBe(true);
    expect(canStopNodeAgentTurn(null, 10_000)).toBe(true);
  });

  it("uses the live controller identity for both source and result nodes", () => {
    const active = { resultNodeId: "result", sourceNodeId: "source", turnId: "live-turn" };
    expect(resolveNodeAgentTurnId({ active, nodeId: "source", nodes: [] })).toBe("live-turn");
    expect(resolveNodeAgentTurnId({ active, nodeId: "result", nodes: [] })).toBe("live-turn");
    expect(resolveNodeAgentTurnId({ active, nodeId: "other", nodes: [] })).toBe("live-turn");
  });

  it("recovers the persisted Turn identity after the renderer controller is lost", () => {
    expect(resolveNodeAgentTurnId({
      active: null,
      nodeId: "result",
      nodes: [node("result", "persisted-turn")],
    })).toBe("persisted-turn");
  });

  it("finds the running Turn when controls are opened from another node", () => {
    const running = node("result", "running-turn");
    running.data.aiStatus = "generating";
    expect(resolveNodeAgentTurnId({
      active: null,
      nodeId: "other",
      nodes: [node("other", "completed-turn"), running],
    })).toBe("running-turn");
  });
});
