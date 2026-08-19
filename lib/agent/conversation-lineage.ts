import type { Edge } from "@xyflow/react";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

export type ConversationLineageResolution = {
  directParentNodeIds: string[];
  ancestorNodeIds: string[];
  isConversationRoot: boolean;
};

export function resolveConversationLineage(input: {
  edges: Pick<Edge, "source" | "target">[];
  nodeId: string;
}): ConversationLineageResolution {
  const inbound = new Map<string, string[]>();
  for (const edge of input.edges) {
    const parents = inbound.get(edge.target) ?? [];
    parents.push(edge.source);
    inbound.set(edge.target, parents);
  }

  const directParentNodeIds = dedupe(inbound.get(input.nodeId) ?? []);
  const ancestorNodeIds: string[] = [];
  const visited = new Set<string>([input.nodeId]);
  const queue = [...directParentNodeIds];

  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    ancestorNodeIds.push(nodeId);
    for (const parentId of inbound.get(nodeId) ?? []) queue.push(parentId);
  }

  return {
    directParentNodeIds,
    ancestorNodeIds,
    isConversationRoot: directParentNodeIds.length === 0,
  };
}

function dedupe(values: string[]) {
  return [...new Set(values)];
}

export function resolveInheritedConversation(input: {
  events: readonly ProjectAgentEvent[];
  turnIds: readonly string[];
}) {
  const orderedTurnIds = dedupe(input.turnIds.filter(Boolean));
  const conversationIds = dedupe(orderedTurnIds.flatMap((turnId) => {
    const userEvent = input.events.find((event) => event.turnId === turnId && event.type === "user");
    return userEvent?.conversationId ? [userEvent.conversationId] : [];
  }));
  return {
    conversationId: conversationIds.length === 1 ? conversationIds[0] : undefined,
    parentTurnId: orderedTurnIds[0],
    parentConversationIds: conversationIds,
  };
}
