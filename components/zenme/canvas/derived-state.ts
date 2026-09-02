import { AlertCircle, Check, Loader2, Pencil } from "lucide-react";

import type { CanvasNode, SaveStatus } from "./types";
import { isReadableFileName } from "./files";

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
        ((node.data.kind === "book" || node.data.kind === "file") &&
          !node.data.readingAssetId &&
          isReadableFileName(node.data.fileName) &&
          node.data.originalUrl &&
          node.data.fileName)),
  );
}

export function canOpenReadingWorkspace(node: CanvasNode | undefined) {
  if (!node) return false;
  if (node.data.kind === "text" || node.data.kind === "markdown") {
    return Boolean(node.data.plainText?.trim());
  }
  if (node.data.kind !== "book" && node.data.kind !== "file") {
    return false;
  }
  return Boolean(
    isReadableFileName(node.data.fileName) &&
      (node.data.readingAssetId || node.data.originalUrl),
  );
}
