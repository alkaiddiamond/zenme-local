import { readNodeSize } from "./geometry";
import type { CanvasNode, Viewport } from "./types";
import type { Edge } from "@xyflow/react";

const DEFAULT_NODE_SIZE = { height: 280, width: 520 };
export const CANVAS_CONTENT_WORKSET_THRESHOLD = 180;
export const CANVAS_CONTENT_WORKSET_LIMIT = 180;
export const CANVAS_EDGE_WORKSET_THRESHOLD = 300;
const CANVAS_CONTENT_OVERSCAN_RATIO = 0.35;

export function getCanvasContentWorkset(input: {
  alwaysActiveNodeIds?: Iterable<string>;
  nodes: CanvasNode[];
  viewport: Viewport;
  viewportSize: { height: number; width: number };
}) {
  if (input.nodes.length <= CANVAS_CONTENT_WORKSET_THRESHOLD) return null;

  const zoom = Math.max(input.viewport.zoom, 0.01);
  const visibleBounds = {
    height: input.viewportSize.height / zoom,
    width: input.viewportSize.width / zoom,
    x: -input.viewport.x / zoom,
    y: -input.viewport.y / zoom,
  };
  const overscanX = visibleBounds.width * CANVAS_CONTENT_OVERSCAN_RATIO;
  const overscanY = visibleBounds.height * CANVAS_CONTENT_OVERSCAN_RATIO;
  const worksetBounds = {
    bottom: visibleBounds.y + visibleBounds.height + overscanY,
    left: visibleBounds.x - overscanX,
    right: visibleBounds.x + visibleBounds.width + overscanX,
    top: visibleBounds.y - overscanY,
  };
  const viewportCenter = {
    x: visibleBounds.x + visibleBounds.width / 2,
    y: visibleBounds.y + visibleBounds.height / 2,
  };
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const absolutePositionById = new Map<string, { x: number; y: number }>();
  const candidates = input.nodes.map((node) => {
    const position = getAbsoluteNodePosition(
      node,
      nodeById,
      absolutePositionById,
      new Set(),
    );
    const size = readNodeSize(node, DEFAULT_NODE_SIZE);
    const center = {
      x: position.x + size.width / 2,
      y: position.y + size.height / 2,
    };
    return {
      distance:
        (center.x - viewportCenter.x) ** 2 +
        (center.y - viewportCenter.y) ** 2,
      id: node.id,
      intersectsWorkset:
        position.x < worksetBounds.right &&
        position.x + size.width > worksetBounds.left &&
        position.y < worksetBounds.bottom &&
        position.y + size.height > worksetBounds.top,
      intersectsViewport:
        position.x < visibleBounds.x + visibleBounds.width &&
        position.x + size.width > visibleBounds.x &&
        position.y < visibleBounds.y + visibleBounds.height &&
        position.y + size.height > visibleBounds.y,
    };
  });
  candidates.sort((first, second) =>
    Number(second.intersectsViewport) - Number(first.intersectsViewport) ||
    Number(second.intersectsWorkset) - Number(first.intersectsWorkset) ||
    first.distance - second.distance,
  );

  const activeNodeIds = new Set(input.alwaysActiveNodeIds ?? []);
  for (const candidate of candidates) {
    if (
      candidate.intersectsViewport ||
      (candidate.intersectsWorkset &&
        activeNodeIds.size < CANVAS_CONTENT_WORKSET_LIMIT)
    ) {
      activeNodeIds.add(candidate.id);
    }
  }
  return activeNodeIds;
}

export function getCanvasEdgeWorkset(input: {
  activeNodeIds: Set<string> | null;
  edges: Edge[];
}) {
  if (
    input.activeNodeIds === null ||
    input.edges.length <= CANVAS_EDGE_WORKSET_THRESHOLD
  ) {
    return input.edges;
  }

  return input.edges.filter((edge) =>
    input.activeNodeIds?.has(edge.source) ||
    input.activeNodeIds?.has(edge.target),
  );
}

function getAbsoluteNodePosition(
  node: CanvasNode,
  nodeById: Map<string, CanvasNode>,
  cache: Map<string, { x: number; y: number }>,
  visiting: Set<string>,
): { x: number; y: number } {
  const cached = cache.get(node.id);
  if (cached) return cached;
  if (!node.parentId || visiting.has(node.id)) {
    return node.position;
  }

  const parent = nodeById.get(node.parentId);
  if (!parent) return node.position;
  visiting.add(node.id);
  const parentPosition = getAbsoluteNodePosition(
    parent,
    nodeById,
    cache,
    visiting,
  );
  visiting.delete(node.id);
  const absolutePosition = {
    x: parentPosition.x + node.position.x,
    y: parentPosition.y + node.position.y,
  };
  cache.set(node.id, absolutePosition);
  return absolutePosition;
}
