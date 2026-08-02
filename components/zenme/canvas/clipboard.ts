import type { CanvasNode } from "./types";
import { createCanvasHistoryNodeSnapshot } from "./geometry";
import { collectSelectedNodeIdsWithChildren } from "./keyboard";

export const ZENME_NODE_CLIPBOARD_MIME = "application/x-zenme-canvas-nodes";
export const ZENME_NODE_CLIPBOARD_PREFIX = "zenme-node-clipboard:";
const IMAGE_FILE_EXTENSION = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i;

export type CanvasNodeClipboardPayload = {
  nodes: CanvasNode[];
  version: 1;
};

export function hasSelectedClipboardText(
  selection: Pick<Selection, "isCollapsed" | "toString"> | null,
) {
  return Boolean(
    selection &&
      !selection.isCollapsed &&
      selection.toString().length > 0,
  );
}

export function createCanvasNodeClipboardPayload(nodes: CanvasNode[]) {
  const selectedIds = collectSelectedNodeIdsWithChildren(nodes);
  return createCanvasNodeClipboardPayloadForNodeIds(nodes, selectedIds);
}

export function createCanvasNodeClipboardPayloadForNodeIds(
  nodes: CanvasNode[],
  selectedIds: ReadonlySet<string>,
) {
  if (selectedIds.size === 0) return null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const copiedNodes = nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => {
      const snapshot = createCanvasHistoryNodeSnapshot(node);
      if (
        snapshot.data.kind === "task" &&
        snapshot.data.taskParentId &&
        !selectedIds.has(snapshot.data.taskParentId)
      ) {
        snapshot.data = {
          ...snapshot.data,
          taskParentId: undefined,
        };
      }
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

export function getClipboardImageFiles(
  clipboardData: Pick<DataTransfer, "files" | "items">,
) {
  const itemImages = normalizeClipboardImageFiles(
    Array.from(clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => ({ file: item.getAsFile(), typeHint: item.type })),
  );
  if (itemImages.length > 0) return itemImages;

  return normalizeClipboardImageFiles(
    Array.from(clipboardData.files).map((file) => ({
      file,
      typeHint: file.type,
    })),
  );
}

function normalizeClipboardImageFiles(
  candidates: Array<{ file: File | null; typeHint: string }>,
) {
  const seen = new Set<string>();

  return candidates.flatMap(({ file, typeHint }, index) => {
    if (!file) return [];
    const mimeType = getClipboardImageMimeType(file, typeHint);
    if (!mimeType) return [];
    const key = [
      file.name,
      file.size,
      file.lastModified,
      file.type,
    ].join(":");
    if (seen.has(key)) return [];
    seen.add(key);

    const extension = getClipboardImageExtension(mimeType);
    const fileName = file.name || `clipboard-${Date.now()}-${index + 1}.${extension}`;
    if (file.type === mimeType && file.name) return [file];

    return [
      new File([file], fileName, {
        lastModified: file.lastModified,
        type: mimeType,
      }),
    ];
  });
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
    const taskParentId =
      sourceNode.data.kind === "task" && sourceNode.data.taskParentId
        ? idMap.get(sourceNode.data.taskParentId)
        : undefined;
    const groupId = sourceNode.data.groupId
      ? idMap.get(sourceNode.data.groupId)
      : undefined;
    return {
      ...snapshot,
      id: idMap.get(sourceNode.id) as string,
      parentId,
      data: {
        ...snapshot.data,
        groupId,
        ...(sourceNode.data.kind === "task" ? { taskParentId } : {}),
      },
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

function getClipboardImageMimeType(file: File, typeHint: string) {
  const mimeType = file.type || typeHint;
  if (mimeType.startsWith("image/")) return mimeType;
  if (file.type || typeHint) return null;
  if (file.name && !IMAGE_FILE_EXTENSION.test(file.name)) return null;
  return "image/png";
}

function getClipboardImageExtension(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
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
