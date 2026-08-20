import type { CanvasNode } from "@/components/zenme/canvas/types";

export type ActiveNodeAgentTurn = {
  resultNodeId: string;
  sourceNodeId: string;
  turnId: string;
};

export function resolveNodeAgentTurnId(input: {
  active?: ActiveNodeAgentTurn | null;
  nodeId: string;
  nodes: CanvasNode[];
}) {
  if (
    input.active &&
    (input.active.sourceNodeId === input.nodeId || input.active.resultNodeId === input.nodeId)
  ) {
    return input.active.turnId;
  }
  const persistedTurnId = input.nodes.find((node) => node.id === input.nodeId)?.data.agentTurnId;
  return persistedTurnId?.trim() || undefined;
}
