import type { Edge } from "@xyflow/react";

import {
  CANVAS_HISTORY_TRANSIENT_DATA_KEYS,
  createCanvasHistoryEdgeSnapshot,
  createCanvasHistoryNodeSnapshot,
  getCanvasHistorySignature,
} from "@/components/zenme/canvas/geometry";
import type {
  CanvasHistoryCreateEntry,
  CanvasHistoryDeleteEntry,
  CanvasHistoryMutateEntry,
  CanvasHistoryCommandEntry,
  CanvasHistoryEntry,
  CanvasHistorySnapshotEntry,
  CanvasNode,
  Viewport,
} from "@/components/zenme/canvas/types";

export function preserveCanvasHistoryTransientData(
  historyNodes: CanvasNode[],
  currentNodes: CanvasNode[],
) {
  const currentNodesById = new Map(currentNodes.map((node) => [node.id, node]));
  return historyNodes.map((historyNode) => {
    const currentNode = currentNodesById.get(historyNode.id);
    if (!currentNode || currentNode.data.kind !== historyNode.data.kind) {
      return historyNode;
    }

    const transientData = Object.fromEntries(
      Object.entries(currentNode.data).filter(([key]) =>
        CANVAS_HISTORY_TRANSIENT_DATA_KEYS.has(key),
      ),
    ) as Partial<CanvasNode["data"]>;

    return {
      ...historyNode,
      data: {
        ...historyNode.data,
        ...transientData,
      },
    };
  });
}

export function getCanvasHistoryState(history: CanvasHistoryEntry[]) {
  return history.reduce<CanvasHistorySnapshotEntry | null>((state, entry) => {
    if (!entry.type || entry.type === "snapshot") {
      return entry;
    }

    if (!state) {
      return state;
    }

    if (entry.type === "createCanvasItems") {
      const existingNodeIds = new Set(state.nodes.map((node) => node.id));
      const existingEdgeIds = new Set(state.edges.map((edge) => edge.id));

      return {
        type: "snapshot",
        edges: [
          ...state.edges,
          ...entry.edges.filter((edge) => !existingEdgeIds.has(edge.id)),
        ],
        nodes: [
          ...state.nodes,
          ...entry.nodes.filter((node) => !existingNodeIds.has(node.id)),
        ],
      };
    }

    if (entry.type === "deleteCanvasItems") {
      const deletedNodeIds = new Set(entry.nodes.map((node) => node.id));
      const deletedEdgeIds = new Set(entry.edges.map((edge) => edge.id));

      return {
        type: "snapshot",
        edges: state.edges.filter((edge) => !deletedEdgeIds.has(edge.id)),
        nodes: state.nodes.filter((node) => !deletedNodeIds.has(node.id)),
      };
    }

    if (entry.type === "mutateCanvasItems") {
      const deletedNodeIds = new Set(
        entry.deletedNodes.map((node) => node.id),
      );
      const deletedEdgeIds = new Set(
        entry.deletedEdges.map((edge) => edge.id),
      );
      const nodeUpdatesById = new Map(
        entry.nodeUpdates.map((update) => [update.id, update.after]),
      );
      const edgeUpdatesById = new Map(
        entry.edgeUpdates.map((update) => [update.id, update.after]),
      );
      const existingNodeIds = new Set(state.nodes.map((node) => node.id));
      const existingEdgeIds = new Set(state.edges.map((edge) => edge.id));

      return {
        type: "snapshot",
        edges: [
          ...state.edges
            .filter((edge) => !deletedEdgeIds.has(edge.id))
            .map((edge) => edgeUpdatesById.get(edge.id) ?? edge),
          ...entry.createdEdges.filter((edge) => !existingEdgeIds.has(edge.id)),
        ],
        nodes: [
          ...state.nodes
            .filter((node) => !deletedNodeIds.has(node.id))
            .map((node) => nodeUpdatesById.get(node.id) ?? node),
          ...entry.createdNodes.filter((node) => !existingNodeIds.has(node.id)),
        ],
      };
    }

    if (entry.type !== "updateNodes") {
      return state;
    }

    const updatesById = new Map(
      entry.updates.map((update) => [update.id, update.after]),
    );

    const nextState: CanvasHistorySnapshotEntry = {
      type: "snapshot",
      edges: state.edges,
      nodes: state.nodes.map((node) => updatesById.get(node.id) ?? node),
    };
    return nextState;
  }, null);
}

export function getCanvasPersistableSignature(
  nodes: CanvasNode[],
  edges: Edge[],
  viewport: Viewport,
) {
  return JSON.stringify({
    canvas: getCanvasHistorySignature(nodes, edges),
    viewport: {
      x: Number(viewport.x.toFixed(2)),
      y: Number(viewport.y.toFixed(2)),
      zoom: Number(viewport.zoom.toFixed(4)),
    },
  });
}

export function createNodeUpdateHistoryEntry(
  beforeNodeSnapshots: Map<string, CanvasNode>,
  afterNodes: CanvasNode[],
): CanvasHistoryCommandEntry | null {
  const updates = afterNodes.flatMap((node) => {
    const before = beforeNodeSnapshots.get(node.id);
    if (!before) {
      return [];
    }

    const after = createCanvasHistoryNodeSnapshot(node);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      return [];
    }

    return [{ id: node.id, before, after }];
  });

  return updates.length > 0
    ? {
        type: "updateNodes",
        updates,
      }
    : null;
}

export function createDragStartNodeSnapshots(
  nodes: CanvasNode[],
  draggedNodeId: string,
) {
  const draggedNode = nodes.find((node) => node.id === draggedNodeId);
  if (!draggedNode) return new Map<string, CanvasNode>();

  const affectedNodeIds = new Set<string>([draggedNodeId]);
  if (draggedNode.selected) {
    for (const node of nodes) {
      if (node.selected) affectedNodeIds.add(node.id);
    }
  }

  let addedDescendant = true;
  while (addedDescendant) {
    addedDescendant = false;
    for (const node of nodes) {
      if (
        !affectedNodeIds.has(node.id) &&
        ((node.parentId && affectedNodeIds.has(node.parentId)) ||
          (node.data.groupId && affectedNodeIds.has(node.data.groupId)))
      ) {
        affectedNodeIds.add(node.id);
        addedDescendant = true;
      }
    }
  }

  return new Map(
    nodes.flatMap((node) =>
      affectedNodeIds.has(node.id)
        ? [[node.id, createCanvasHistoryNodeSnapshot(node)] as const]
        : [],
    ),
  );
}

export function createResizeStartNodeSnapshots(
  nodes: CanvasNode[],
  resizingNodeIds: Iterable<string>,
) {
  const affectedNodeIds = new Set(resizingNodeIds);
  return new Map(
    nodes.flatMap((node) =>
      affectedNodeIds.has(node.id)
        ? [[node.id, createCanvasHistoryNodeSnapshot(node)] as const]
        : [],
    ),
  );
}

export function createCanvasItemsHistoryEntry(input: {
  edges?: Edge[];
  nodes?: CanvasNode[];
}): CanvasHistoryCreateEntry | null {
  const nodes = (input.nodes ?? []).map(createCanvasHistoryNodeSnapshot);
  const edges = (input.edges ?? []).map(createCanvasHistoryEdgeSnapshot);

  return nodes.length > 0 || edges.length > 0
    ? {
        type: "createCanvasItems",
        edges,
        nodes,
      }
    : null;
}

export function createDeletedCanvasItemsHistoryEntry(input: {
  edges: Edge[];
  nodes: CanvasNode[];
}): CanvasHistoryDeleteEntry | null {
  if (input.nodes.length === 0 && input.edges.length === 0) {
    return null;
  }

  return {
    type: "deleteCanvasItems",
    edges: input.edges.map(createCanvasHistoryEdgeSnapshot),
    nodes: input.nodes.map(createCanvasHistoryNodeSnapshot),
  };
}

export function createMutateCanvasItemsHistoryEntry(input: {
  createdEdges?: Edge[];
  createdNodes?: CanvasNode[];
  deletedEdges?: Edge[];
  deletedNodes?: CanvasNode[];
  edgeUpdates?: Array<{ after: Edge; before: Edge; id: string }>;
  nodeUpdates?: Array<{ after: CanvasNode; before: CanvasNode; id: string }>;
}): CanvasHistoryMutateEntry | null {
  const createdNodes = (input.createdNodes ?? []).map(
    createCanvasHistoryNodeSnapshot,
  );
  const createdEdges = (input.createdEdges ?? []).map(
    createCanvasHistoryEdgeSnapshot,
  );
  const deletedNodes = (input.deletedNodes ?? []).map(
    createCanvasHistoryNodeSnapshot,
  );
  const deletedEdges = (input.deletedEdges ?? []).map(
    createCanvasHistoryEdgeSnapshot,
  );
  const nodeUpdates = createCanvasHistoryUpdates(
    input.nodeUpdates ?? [],
    createCanvasHistoryNodeSnapshot,
  );
  const edgeUpdates = createCanvasHistoryUpdates(
    input.edgeUpdates ?? [],
    createCanvasHistoryEdgeSnapshot,
  );

  return createdNodes.length > 0 ||
    createdEdges.length > 0 ||
    deletedNodes.length > 0 ||
    deletedEdges.length > 0 ||
    nodeUpdates.length > 0 ||
    edgeUpdates.length > 0
    ? {
        type: "mutateCanvasItems",
        createdEdges,
        createdNodes,
        deletedEdges,
        deletedNodes,
        edgeUpdates,
        nodeUpdates,
      }
    : null;
}

function createCanvasHistoryUpdates<T>(
  updates: Array<{ after: T; before: T; id: string }>,
  createSnapshot: (item: T) => T,
) {
  return updates.flatMap((update) => {
    const before = createSnapshot(update.before);
    const after = createSnapshot(update.after);
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [{ id: update.id, before, after }];
  });
}
