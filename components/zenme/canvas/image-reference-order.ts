import type { Edge } from "@xyflow/react";

import type { CanvasNode } from "./types";

export function getImageRequestReferenceUrls(input: {
  connectedReferenceImageUrls: string[];
  currentImageUrl?: string;
}) {
  return Array.from(
    new Set(
      [input.currentImageUrl, ...input.connectedReferenceImageUrls].filter(
        (url): url is string => Boolean(url),
      ),
    ),
  ).slice(0, 8);
}

export function getOrderedImageReferenceUrls(input: {
  edges: Edge[];
  nodes: CanvasNode[];
  selectedNodeIds?: string[];
  targetNodeId: string;
}) {
  const incomingNodeIds = input.edges
    .filter((edge) => edge.target === input.targetNodeId)
    .map((edge) => edge.source);
  const connectedNodeIds = new Set(incomingNodeIds);
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const orderedNodeIds = input.selectedNodeIds ?? incomingNodeIds;

  return orderedNodeIds
    .filter((nodeId) => connectedNodeIds.has(nodeId))
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is CanvasNode => node?.data.kind === "image")
    .map((node) => node.data.originalUrl ?? node.data.previewUrl)
    .filter((url): url is string => Boolean(url))
    .slice(0, 8);
}
