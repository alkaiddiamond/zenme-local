import { describe, expect, it } from "vitest";

import { resolveNodeAgentTurnId } from "@/components/zenme/canvas/agent-turn-control";
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
  it("uses the live controller identity for both source and result nodes", () => {
    const active = { resultNodeId: "result", sourceNodeId: "source", turnId: "live-turn" };
    expect(resolveNodeAgentTurnId({ active, nodeId: "source", nodes: [] })).toBe("live-turn");
    expect(resolveNodeAgentTurnId({ active, nodeId: "result", nodes: [] })).toBe("live-turn");
  });

  it("recovers the persisted Turn identity after the renderer controller is lost", () => {
    expect(resolveNodeAgentTurnId({
      active: null,
      nodeId: "result",
      nodes: [node("result", "persisted-turn")],
    })).toBe("persisted-turn");
  });
});
