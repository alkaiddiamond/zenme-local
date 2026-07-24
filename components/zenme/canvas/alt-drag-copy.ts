import {
  createCanvasNodeClipboardPayloadForNodeIds,
  createPastedCanvasNodes,
} from "./clipboard";
import type { CanvasNode } from "./types";

export type AltDragCopyUpdate = {
  createdNodes: CanvasNode[];
  nextNodes: CanvasNode[];
};

export function createAltDragCopyUpdate(input: {
  beforeNodeSnapshots: Map<string, CanvasNode>;
  createId: () => string;
  currentNodes: CanvasNode[];
  draggedNodeId: string;
  now?: number;
}): AltDragCopyUpdate | null {
  const beforeDraggedNode = input.beforeNodeSnapshots.get(input.draggedNodeId);
  const afterDraggedNode = input.currentNodes.find(
    (node) => node.id === input.draggedNodeId,
  );

  if (
    !beforeDraggedNode ||
    !afterDraggedNode ||
    positionsEqual(beforeDraggedNode.position, afterDraggedNode.position)
  ) {
    return null;
  }

  const copiedNodeIds = collectAltDragNodeIds(
    input.beforeNodeSnapshots,
    beforeDraggedNode,
  );
  const copySourceNodes = input.currentNodes.map((node) => {
    const before = input.beforeNodeSnapshots.get(node.id);
    if (
      !before ||
      !copiedNodeIds.has(node.id) ||
      node.id === input.draggedNodeId
    ) {
      return node;
    }

    // Group children keep their original relative layout. Only the dragged root
    // needs its final position for the duplicate.
    return before;
  });
  const payload = createCanvasNodeClipboardPayloadForNodeIds(
    copySourceNodes,
    copiedNodeIds,
  );
  if (!payload) return null;

  const rootNodes = payload.nodes.filter(
    (node) => !node.parentId || !copiedNodeIds.has(node.parentId),
  );
  const anchor = {
    x: Math.min(...rootNodes.map((node) => node.position.x)),
    y: Math.min(...rootNodes.map((node) => node.position.y)),
  };
  const createdAt = input.now ?? Date.now();
  const pastedNodes = createPastedCanvasNodes({
    anchor,
    createId: input.createId,
    payload,
  });
  const draggedCopyIndex = payload.nodes.findIndex(
    (node) => node.id === input.draggedNodeId,
  );
  const draggedCopyId = pastedNodes[draggedCopyIndex]?.id;
  const createdNodes = pastedNodes.map((node, index) => ({
    ...node,
    data: {
      ...node.data,
      createdAt: new Date(createdAt + index).toISOString(),
      updatedAt: new Date(createdAt + index).toISOString(),
    },
    selected: node.id === draggedCopyId,
  }));
  const nextNodes = [
    ...input.currentNodes.map((node) => {
      const before = copiedNodeIds.has(node.id)
        ? input.beforeNodeSnapshots.get(node.id)
        : null;
      return before ? { ...before, selected: false } : { ...node, selected: false };
    }),
    ...createdNodes,
  ];

  return { createdNodes, nextNodes };
}

function collectAltDragNodeIds(
  beforeNodeSnapshots: Map<string, CanvasNode>,
  draggedNode: CanvasNode,
) {
  const ids = new Set([draggedNode.id]);
  if (draggedNode.data.kind !== "group") return ids;

  let changed = true;
  while (changed) {
    changed = false;
    for (const node of beforeNodeSnapshots.values()) {
      if (
        !ids.has(node.id) &&
        ((node.parentId && ids.has(node.parentId)) ||
          (node.data.groupId && ids.has(node.data.groupId)))
      ) {
        ids.add(node.id);
        changed = true;
      }
    }
  }
  return ids;
}

function positionsEqual(
  first: { x: number; y: number },
  second: { x: number; y: number },
) {
  return first.x === second.x && first.y === second.y;
}
