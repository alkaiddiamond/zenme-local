import type { Edge, Viewport } from "@xyflow/react";

import type { CanvasNodeData } from "@/components/zenme/node-types";

import { getAbsoluteNodePosition } from "./geometry";
import type { CanvasNode } from "./types";

export type CanvasArchiveViewMode = "active" | "archived";

export function resolveCanvasArchiveViewportTransition(input: {
  activeViewport: Viewport;
  archivedViewport: Viewport | null;
  hasVisibleNodes: boolean;
  nextMode: CanvasArchiveViewMode;
}) {
  const targetViewport = input.nextMode === "active"
    ? input.activeViewport
    : input.archivedViewport;
  return {
    shouldFitView:
      input.nextMode === "archived" &&
      targetViewport === null &&
      input.hasVisibleNodes,
    targetViewport,
  };
}

type CanvasArchiveUpdate = {
  affectedNodeIds: Set<string>;
  deletedEdges: Edge[];
  nextEdges: Edge[];
  nextNodes: CanvasNode[];
  nodeUpdates: Array<{ after: CanvasNode; before: CanvasNode; id: string }>;
};

export function createArchiveCanvasSelectionUpdate(input: {
  edges: Edge[];
  nodeIds: Iterable<string>;
  nodes: CanvasNode[];
}): CanvasArchiveUpdate | null {
  const requestedNodeIds = new Set(input.nodeIds);
  const affectedNodeIds = collectCanvasDescendantIds({
    edges: input.edges,
    nodeIds: requestedNodeIds,
    nodes: input.nodes,
  });
  if (affectedNodeIds.size === 0) return null;

  const nextNodes = input.nodes.map((node) => {
    if (!affectedNodeIds.has(node.id)) return node;

    const currentLifecycle = node.data.nodeLifecycle ?? "working";
    const detachedFromGroup = Boolean(
      (node.parentId && !affectedNodeIds.has(node.parentId)) ||
      (node.data.groupId && !affectedNodeIds.has(node.data.groupId)),
    );
    const detachedFromTaskParent = Boolean(
      node.data.taskParentId && !affectedNodeIds.has(node.data.taskParentId),
    );
    const position =
      node.parentId && !affectedNodeIds.has(node.parentId)
        ? getAbsoluteNodePosition(node, input.nodes)
        : node.position;

    return {
      ...node,
      ...(detachedFromGroup
        ? { extent: undefined, parentId: undefined, position }
        : {}),
      selected: false,
      data: {
        ...node.data,
        ...(detachedFromGroup ? { groupId: undefined } : {}),
        ...(detachedFromTaskParent ? { taskParentId: undefined } : {}),
        nodeLifecycle: "archived",
        nodeLifecycleBeforeArchive:
          currentLifecycle === "archived"
            ? node.data.nodeLifecycleBeforeArchive
            : currentLifecycle,
      },
    } satisfies CanvasNode;
  });
  const deletedEdges = input.edges.filter(
    (edge) =>
      affectedNodeIds.has(edge.target) && !affectedNodeIds.has(edge.source),
  );
  const deletedEdgeIds = new Set(deletedEdges.map((edge) => edge.id));
  const nextEdges = input.edges.filter((edge) => !deletedEdgeIds.has(edge.id));

  return {
    affectedNodeIds,
    deletedEdges,
    nextEdges,
    nextNodes,
    nodeUpdates: createArchiveNodeUpdates(input.nodes, nextNodes, affectedNodeIds),
  };
}

export function createRestoreCanvasSelectionUpdate(input: {
  edges: Edge[];
  nodeIds: Iterable<string>;
  nodes: CanvasNode[];
}) {
  const archivedNodeIds = new Set(
    input.nodes.flatMap((node) =>
      node.data.nodeLifecycle === "archived" ? [node.id] : [],
    ),
  );
  const affectedNodeIds = collectCanvasDescendantIds({
    edges: input.edges,
    eligibleNodeIds: archivedNodeIds,
    nodeIds: input.nodeIds,
    nodes: input.nodes,
  });
  if (affectedNodeIds.size === 0) return null;

  const nextNodes = input.nodes.map((node) => {
    if (!affectedNodeIds.has(node.id)) return node;
    const detachedFromGroup = Boolean(
      (node.parentId && !affectedNodeIds.has(node.parentId)) ||
      (node.data.groupId && !affectedNodeIds.has(node.data.groupId)),
    );
    const detachedFromTaskParent = Boolean(
      node.data.taskParentId && !affectedNodeIds.has(node.data.taskParentId),
    );
    const position =
      node.parentId && !affectedNodeIds.has(node.parentId)
        ? getAbsoluteNodePosition(node, input.nodes)
        : node.position;
    return {
      ...node,
      ...(detachedFromGroup
        ? { extent: undefined, parentId: undefined, position }
        : {}),
      selected: false,
      data: {
        ...node.data,
        ...(detachedFromGroup ? { groupId: undefined } : {}),
        ...(detachedFromTaskParent ? { taskParentId: undefined } : {}),
        nodeLifecycle: getRestoredNodeLifecycle(node),
      },
    } satisfies CanvasNode;
  });
  const deletedEdges = input.edges.filter(
    (edge) =>
      affectedNodeIds.has(edge.target) && !affectedNodeIds.has(edge.source),
  );
  const deletedEdgeIds = new Set(deletedEdges.map((edge) => edge.id));
  const nextEdges = input.edges.filter((edge) => !deletedEdgeIds.has(edge.id));

  return {
    affectedNodeIds,
    deletedEdges,
    nextEdges,
    nextNodes,
    nodeUpdates: createArchiveNodeUpdates(input.nodes, nextNodes, affectedNodeIds),
  } satisfies CanvasArchiveUpdate;
}

export function getCanvasArchiveView(input: {
  edges: Edge[];
  mode: CanvasArchiveViewMode;
  nodes: CanvasNode[];
}) {
  const nodes = input.nodes.filter((node) =>
    input.mode === "archived"
      ? node.data.nodeLifecycle === "archived"
      : node.data.nodeLifecycle !== "archived",
  );
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  return {
    edges: input.edges.filter(
      (edge) =>
        visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
    ),
    nodes,
  };
}

function collectCanvasDescendantIds(input: {
  edges: Array<Pick<Edge, "source" | "target">>;
  eligibleNodeIds?: ReadonlySet<string>;
  nodeIds: Iterable<string>;
  nodes: CanvasNode[];
}) {
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const childrenByParentId = new Map<string, Set<string>>();
  const addChild = (parentId: string | undefined, childId: string) => {
    if (!parentId || parentId === childId || !nodeIds.has(parentId)) return;
    const children = childrenByParentId.get(parentId) ?? new Set<string>();
    children.add(childId);
    childrenByParentId.set(parentId, children);
  };

  for (const edge of input.edges) addChild(edge.source, edge.target);
  for (const node of input.nodes) {
    addChild(node.parentId, node.id);
    addChild(node.data.groupId, node.id);
    addChild(node.data.taskParentId, node.id);
  }

  const affectedNodeIds = new Set<string>();
  const pending = Array.from(input.nodeIds).filter(
    (nodeId) =>
      nodeIds.has(nodeId) &&
      (!input.eligibleNodeIds || input.eligibleNodeIds.has(nodeId)),
  );
  while (pending.length > 0) {
    const nodeId = pending.shift();
    if (!nodeId || affectedNodeIds.has(nodeId)) continue;
    affectedNodeIds.add(nodeId);
    for (const childId of childrenByParentId.get(nodeId) ?? []) {
      if (
        !affectedNodeIds.has(childId) &&
        (!input.eligibleNodeIds || input.eligibleNodeIds.has(childId))
      ) {
        pending.push(childId);
      }
    }
  }

  return affectedNodeIds;
}

function createArchiveNodeUpdates(
  beforeNodes: CanvasNode[],
  afterNodes: CanvasNode[],
  affectedNodeIds: ReadonlySet<string>,
) {
  const afterById = new Map(afterNodes.map((node) => [node.id, node]));
  return beforeNodes.flatMap((before) => {
    const after = afterById.get(before.id);
    if (!after || !affectedNodeIds.has(before.id) || after === before) return [];
    return [{ after, before, id: before.id }];
  });
}

export function getRestoredNodeLifecycle(
  node: CanvasNode,
): NonNullable<CanvasNodeData["nodeLifecycle"]> {
  return node.data.nodeLifecycleBeforeArchive ?? "working";
}
