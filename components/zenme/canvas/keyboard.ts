import type { Edge } from "@xyflow/react";

import { isEditableTarget } from "./geometry";
import type { CanvasNode } from "./types";

export function isUndoKeyboardShortcut(event: KeyboardEvent) {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "z" &&
    !event.shiftKey &&
    !isEditableTarget(event.target)
  );
}

export function isDeleteKeyboardShortcut(event: KeyboardEvent) {
  return (
    (event.key === "Delete" || event.key === "Backspace") &&
    !isEditableTarget(event.target)
  );
}

export function collectSelectedNodeIdsWithChildren(nodes: CanvasNode[]) {
  const selectedNodeIds = new Set(
    nodes.filter((node) => node.selected).map((node) => node.id),
  );

  if (selectedNodeIds.size === 0) {
    return selectedNodeIds;
  }

  for (const node of nodes) {
    if (node.parentId && selectedNodeIds.has(node.parentId)) {
      selectedNodeIds.add(node.id);
    }
  }

  return selectedNodeIds;
}

export function removeNodesAndConnectedEdges(
  nodes: CanvasNode[],
  edges: Edge[],
  removedNodeIds: Set<string>,
) {
  return {
    edges: edges.filter(
      (edge) =>
        !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target),
    ),
    nodes: nodes.filter((node) => !removedNodeIds.has(node.id)),
  };
}

export function createCanvasDeleteSelection(input: {
  edges: Edge[];
  nodes: CanvasNode[];
}) {
  const selectedNodeIds = collectSelectedNodeIdsWithChildren(input.nodes);
  const explicitlySelectedEdges = input.edges.filter((edge) => edge.selected);

  if (selectedNodeIds.size === 0 && explicitlySelectedEdges.length === 0) {
    return null;
  }

  const nextCanvas = removeNodesAndConnectedEdges(
    input.nodes,
    input.edges,
    selectedNodeIds,
  );
  const deletedNodes = input.nodes.filter((node) =>
    selectedNodeIds.has(node.id),
  );
  const deletedEdgeIds = new Set(
    explicitlySelectedEdges.map((edge) => edge.id),
  );
  const deletedEdges = input.edges.filter(
    (edge) =>
      selectedNodeIds.has(edge.source) ||
      selectedNodeIds.has(edge.target) ||
      deletedEdgeIds.has(edge.id),
  );
  const nextEdges =
    selectedNodeIds.size > 0
      ? nextCanvas.edges.filter((edge) => !deletedEdgeIds.has(edge.id))
      : input.edges.filter((edge) => !deletedEdgeIds.has(edge.id));
  const nextNodes = selectedNodeIds.size > 0 ? nextCanvas.nodes : input.nodes;

  return {
    deletedEdges,
    deletedNodes,
    nextEdges,
    nextNodes,
  };
}
