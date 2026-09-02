import type { CanvasNode } from "@/components/zenme/canvas/types";

export const AGENT_TURN_STOP_DEBOUNCE_MS = 600;

export type ActiveNodeAgentTurn = {
  resultNodeId: string;
  sourceNodeId: string;
  startedAt?: number;
  turnId: string;
};

export function canStopNodeAgentTurn(
  active: ActiveNodeAgentTurn | null | undefined,
  now = Date.now(),
) {
  return !active?.startedAt ||
    now - active.startedAt >= AGENT_TURN_STOP_DEBOUNCE_MS;
}

export function resolveNodeAgentTurnId(input: {
  active?: ActiveNodeAgentTurn | null;
  nodeId: string;
  nodes: CanvasNode[];
}) {
  if (input.active) {
    return input.active.turnId;
  }
  const runningTurnId = input.nodes.find(
    (node) => node.data.aiStatus === "generating" && node.data.agentTurnId?.trim(),
  )?.data.agentTurnId?.trim();
  if (runningTurnId) return runningTurnId;
  const persistedTurnId = input.nodes.find((node) => node.id === input.nodeId)?.data.agentTurnId;
  return persistedTurnId?.trim() || undefined;
}
