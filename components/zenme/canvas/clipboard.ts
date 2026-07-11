import type { CanvasNode } from "./types";
import { createCanvasHistoryNodeSnapshot } from "./geometry";
import { collectSelectedNodeIdsWithChildren } from "./keyboard";

export const ZENME_NODE_CLIPBOARD_MIME = "application/x-zenme-canvas-nodes";
export const ZENME_NODE_CLIPBOARD_PREFIX = "zenme-node-clipboard:";

export type CanvasNodeClipboardPayload = {
  nodes: CanvasNode[];
  version: 1;
};

export function createCanvasNodeClipboardPayload(nodes: CanvasNode[]) {
  const selectedIds = collectSelectedNodeIdsWithChildren(nodes);
  if (selectedIds.size === 0) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const copiedNodes = nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => {
      const snapshot = createCanvasHistoryNodeSnapshot(node);
      if (!node.parentId || selectedIds.has(node.parentId)) return snapshot;
      const absolutePosition = getAbsoluteNodePosition(node, nodeById);
      delete snapshot.parentId;
      delete snapshot.extent;
      return { ...snapshot, position: absolutePosition };
    });

  return { nodes: copiedNodes, version: 1 } satisfies CanvasNodeClipboardPayload;
}

export function parseCanvasNodeClipboardPayload(value: string) {
  try {
    const payload = JSON.parse(value) as Partial<CanvasNodeClipboardPayload>;
    if (payload.version !== 1 || !Array.isArray(payload.nodes)) return null;
    if (payload.nodes.some((node) => !node || typeof node.id !== "string" || !node.position)) {
      return null;
    }
    return payload as CanvasNodeClipboardPayload;
  } catch {
    return null;
  }
}

export function createPastedCanvasNodes(input: {
  anchor: { x: number; y: number };
  createId: () => string;
  payload: CanvasNodeClipboardPayload;
}) {
  const copiedIds = new Set(input.payload.nodes.map((node) => node.id));
  const roots = input.payload.nodes.filter(
    (node) => !node.parentId || !copiedIds.has(node.parentId),
  );
  const minX = roots.length ? Math.min(...roots.map((node) => node.position.x)) : 0;
  const minY = roots.length ? Math.min(...roots.map((node) => node.position.y)) : 0;
  const idMap = new Map(input.payload.nodes.map((node) => [node.id, input.createId()]));

  return input.payload.nodes.map((sourceNode) => {
    const snapshot = createCanvasHistoryNodeSnapshot(sourceNode);
    const parentId = sourceNode.parentId ? idMap.get(sourceNode.parentId) : undefined;
    return {
      ...snapshot,
      id: idMap.get(sourceNode.id) as string,
      parentId,
      position: parentId
        ? sourceNode.position
        : {
            x: input.anchor.x + sourceNode.position.x - minX,
            y: input.anchor.y + sourceNode.position.y - minY,
          },
      selected: false,
      ...(parentId ? {} : { extent: undefined }),
    } satisfies CanvasNode;
  });
}

function getAbsoluteNodePosition(
  node: CanvasNode,
  nodeById: Map<string, CanvasNode>,
): { x: number; y: number } {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodeById.get(parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }
  return { x, y };
}
