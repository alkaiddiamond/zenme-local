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

export function resolveConversationRoute(input: {
  edges: Pick<Edge, "source" | "target">[];
  events: readonly ProjectAgentEvent[];
  nodeId: string;
  turnIdByNodeId: ReadonlyMap<string, string>;
  createConversationId: () => string;
}) {
  const nearest = resolveNearestConversationAnchors({
    edges: input.edges,
    events: input.events,
    nodeId: input.nodeId,
    turnIdByNodeId: input.turnIdByNodeId,
  });
  const parentConversationIds = dedupe(nearest.anchors.map((anchor) => anchor.conversationId));
  const forked = nearest.directParentCount > 1 ||
    nearest.anchors.some((anchor) => anchor.crossedBranch) ||
    parentConversationIds.length > 1;
  const canInherit = !forked && parentConversationIds.length === 1;
  return {
    conversationId: canInherit
      ? parentConversationIds[0]
      : input.createConversationId(),
    parentTurnId: nearest.anchors[0]?.turnId,
    parentConversationIds,
    forked,
  };
}

type NearestConversationAnchor = {
  conversationId: string;
  crossedBranch: boolean;
  turnId: string;
};

function resolveNearestConversationAnchors(input: {
  edges: Pick<Edge, "source" | "target">[];
  events: readonly ProjectAgentEvent[];
  nodeId: string;
  turnIdByNodeId: ReadonlyMap<string, string>;
}) {
  const inbound = new Map<string, string[]>();
  const outboundCounts = new Map<string, number>();
  for (const edge of input.edges) {
    const parents = inbound.get(edge.target) ?? [];
    parents.push(edge.source);
    inbound.set(edge.target, parents);
    outboundCounts.set(edge.source, (outboundCounts.get(edge.source) ?? 0) + 1);
  }
  const conversationByTurnId = new Map(
    input.events.flatMap((event) =>
      event.type === "user" && event.conversationId
        ? [[event.turnId, event.conversationId] as const]
        : [],
    ),
  );
  const directParentCount = dedupe(inbound.get(input.nodeId) ?? []).length;
  const visited = new Set<string>();
  let frontier = [{
    nodeId: input.nodeId,
    crossedBranch: (outboundCounts.get(input.nodeId) ?? 0) > 0,
  }];

  while (frontier.length) {
    const anchors: NearestConversationAnchor[] = [];
    const nextFrontier: typeof frontier = [];
    for (const current of frontier) {
      const visitKey = `${current.nodeId}:${current.crossedBranch ? "1" : "0"}`;
      if (visited.has(visitKey)) continue;
      visited.add(visitKey);

      const turnId = input.turnIdByNodeId.get(current.nodeId);
      const conversationId = turnId ? conversationByTurnId.get(turnId) : undefined;
      if (turnId && conversationId) {
        anchors.push({ conversationId, crossedBranch: current.crossedBranch, turnId });
        continue;
      }

      for (const parentId of inbound.get(current.nodeId) ?? []) {
        nextFrontier.push({
          nodeId: parentId,
          crossedBranch: current.crossedBranch || (outboundCounts.get(parentId) ?? 0) > 1,
        });
      }
    }
    if (anchors.length) {
      const seen = new Set<string>();
      return {
        anchors: anchors.filter((anchor) => {
          const key = `${anchor.turnId}:${anchor.conversationId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
        directParentCount,
      };
    }
    frontier = nextFrontier;
  }

  return { anchors: [] as NearestConversationAnchor[], directParentCount };
}
