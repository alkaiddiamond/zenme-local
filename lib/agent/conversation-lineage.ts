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

export function shouldForkConversation(input: {
  edges: Pick<Edge, "source" | "target">[];
  nodeId: string;
}) {
  const lineage = resolveConversationLineage(input);
  const outboundCounts = new Map<string, number>();
  for (const edge of input.edges) {
    outboundCounts.set(edge.source, (outboundCounts.get(edge.source) ?? 0) + 1);
  }

  if (lineage.directParentNodeIds.length > 1) return true;
  if ((outboundCounts.get(input.nodeId) ?? 0) > 0) return true;
  return lineage.ancestorNodeIds.some((ancestorNodeId) =>
    (outboundCounts.get(ancestorNodeId) ?? 0) > 1
  );
}

export function resolveConversationRoute(input: {
  edges: Pick<Edge, "source" | "target">[];
  events: readonly ProjectAgentEvent[];
  nodeId: string;
  turnIds: readonly string[];
  createConversationId: () => string;
}) {
  const inherited = resolveInheritedConversation({
    events: input.events,
    turnIds: input.turnIds,
  });
  const forked = shouldForkConversation({ edges: input.edges, nodeId: input.nodeId }) ||
    inherited.parentConversationIds.length > 1;
  const canInherit = !forked && inherited.parentConversationIds.length === 1;
  return {
    conversationId: canInherit
      ? inherited.parentConversationIds[0]
      : input.createConversationId(),
    parentTurnId: inherited.parentTurnId,
    parentConversationIds: inherited.parentConversationIds,
    forked,
  };
}
