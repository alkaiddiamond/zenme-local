import { AlertCircle, Check, Loader2, Pencil } from "lucide-react";

import { getNodeBounds } from "./geometry";
import type { CanvasNode, SaveStatus, Viewport } from "./types";

export function getSaveStatusTone(saveStatus: SaveStatus) {
  if (saveStatus === "已保存") {
    return "text-emerald-600";
  }
  if (saveStatus === "保存失败" || saveStatus === "离线") {
    return "text-red-600";
  }
  return "text-zinc-500";
}

export function getSaveStatusIcon(saveStatus: SaveStatus) {
  if (saveStatus === "保存中") {
    return Loader2;
  }
  if (saveStatus === "已保存") {
    return Check;
  }
  if (saveStatus === "保存失败" || saveStatus === "离线") {
    return AlertCircle;
  }
  return Pencil;
}

export function getGroupableNodes(nodes: CanvasNode[]) {
  return nodes.filter(
    (node) =>
      node.selected &&
      !node.hidden &&
      node.data.kind !== "group" &&
      !node.data.groupId &&
      !node.parentId,
  );
}

export function getActionNode(input: {
  nodeId?: string;
  nodes: CanvasNode[];
}) {
  if (!input.nodeId) {
    return undefined;
  }

  return input.nodes.find((node) => node.id === input.nodeId);
}

export function canPrepareReadingAsset(node: CanvasNode | undefined) {
  const isReadableTextNode =
    node?.data.kind === "text" || node?.data.kind === "markdown";
  return Boolean(
    node &&
      ((isReadableTextNode && node.data.plainText?.trim()) ||
        (node.data.kind === "book" &&
          !node.data.readingAssetId &&
          node.data.originalUrl &&
          node.data.fileName)),
  );
}

export function getSelectionToolbarPosition(input: {
  canvasViewport: Viewport;
  groupableNodes: CanvasNode[];
  nodes: CanvasNode[];
}) {
  if (input.groupableNodes.length < 2) {
    return null;
  }

  const bounds = input.groupableNodes.map((node) =>
    getNodeBounds(node, input.nodes),
  );
  const minX = Math.min(...bounds.map((bound) => bound.x));
  const minY = Math.min(...bounds.map((bound) => bound.y));
  const maxX = Math.max(...bounds.map((bound) => bound.x + bound.width));

  return {
    left:
      input.canvasViewport.x +
      ((minX + maxX) / 2) * input.canvasViewport.zoom,
    top: input.canvasViewport.y + minY * input.canvasViewport.zoom - 62,
  };
}
