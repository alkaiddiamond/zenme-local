import type { Edge } from "@xyflow/react";

import {
  collectReaderChildNodeIds,
  readNodeSize,
  READER_COLLAPSED_SIZE,
  READER_DEFAULT_SIZE,
  shouldHideReaderChildEdge,
} from "@/components/zenme/canvas/geometry";
import type { CanvasNode } from "@/components/zenme/canvas/types";

export function createReaderCollapseUpdate(input: {
  edges: Edge[];
  nodes: CanvasNode[];
  readerNodeId: string;
}) {
  const readerNode = input.nodes.find(
    (node) => node.id === input.readerNodeId,
  );
  if (!readerNode || readerNode.data.kind !== "reader") {
    return null;
  }

  const nextCollapsed = !readerNode.data.readerCollapsed;
  const childIds = collectReaderChildNodeIds(input.readerNodeId, input.edges);
  const nextNodes = input.nodes.map((node) => {
    if (node.id === input.readerNodeId) {
      const currentSize = readNodeSize(node, READER_DEFAULT_SIZE);
      const expandedSize = nextCollapsed
        ? currentSize
        : (node.data.readerExpandedSize ?? READER_DEFAULT_SIZE);
      const nextSize = nextCollapsed ? READER_COLLAPSED_SIZE : expandedSize;

      return {
        ...node,
        height: nextSize.height,
        measured: { ...nextSize },
        style: { ...nextSize },
        width: nextSize.width,
        data: {
          ...node.data,
          readerCollapsed: nextCollapsed,
          readerExpandedSize: expandedSize,
        },
      };
    }

    if (childIds.has(node.id)) {
      return {
        ...node,
        hidden: nextCollapsed,
      };
    }

    return node;
  });
  const nextEdges = input.edges.map((edge) =>
    shouldHideReaderChildEdge(input.readerNodeId, childIds, edge)
      ? { ...edge, hidden: nextCollapsed }
      : edge,
  );
  const nodeUpdates = input.nodes.flatMap((before) => {
    if (before.id !== input.readerNodeId && !childIds.has(before.id)) {
      return [];
    }

    const after = nextNodes.find((node) => node.id === before.id);
    return after ? [{ id: before.id, before, after }] : [];
  });
  const edgeUpdates = input.edges.flatMap((before) => {
    const after = nextEdges.find((edge) => edge.id === before.id);
    return after && before.hidden !== after.hidden
      ? [{ id: before.id, before, after }]
      : [];
  });

  return {
    edgeUpdates,
    nextCollapsed,
    nextEdges,
    nextNodes,
    nodeUpdates,
  };
}
