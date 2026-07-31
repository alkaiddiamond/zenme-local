import type { Edge, NodeChange, NodeDimensionChange } from "@xyflow/react";

import type {
  CanvasHistoryEntry,
  CanvasHistorySnapshotEntry,
  CanvasNode,
} from "./types";

export const READER_DEFAULT_SIZE = { height: 620, width: 960 };
export const READER_COLLAPSED_SIZE = { height: 110, width: 288 };
export const GROUP_PADDING = 28;
export const GROUP_NODE_GAP = 28;

export const CANVAS_HISTORY_TRANSIENT_DATA_KEYS = new Set([
  "lyricsFetchDurationMs",
  "lyricsFetchStatus",
  "lyricsWarnings",
  "musicChildExpanded",
  "musicCurrentTime",
  "musicDuration",
  "musicError",
  "musicIsPlaying",
  "musicLoop",
  "musicLoopMode",
  "musicLyrics",
  "musicLyricsOverlayOpen",
  "musicLyricsSourceNodeId",
  "musicMuted",
  "musicPlaybackRate",
  "musicSourceListExpanded",
  "musicSourceNodeId",
  "musicSources",
  "musicVolume",
  "musicWaveform",
  "musicWaveformSourceNodeId",
  "musicWaveformVersion",
]);

export function createWelcomeNodes(): CanvasNode[] {
  return [];
}

export function readNodeSize(
  node: CanvasNode | undefined,
  fallback: { height: number; width: number },
) {
  if (!node) {
    return fallback;
  }

  const measured = (
    node as CanvasNode & {
      measured?: { height?: number; width?: number };
    }
  ).measured;
  const style = node.style as Record<string, unknown> | undefined;

  return {
    height:
      numericSize(measured?.height) ??
      numericSize((node as CanvasNode & { height?: number }).height) ??
      numericSize(style?.height) ??
      fallback.height,
    width:
      numericSize(measured?.width) ??
      numericSize((node as CanvasNode & { width?: number }).width) ??
      numericSize(style?.width) ??
      fallback.width,
  };
}

export function getNodeSizeFallback(node: CanvasNode) {
  if (node.data.kind === "reader") return READER_DEFAULT_SIZE;
  if (node.data.kind === "group") return { height: 260, width: 420 };
  if (node.data.kind === "note") return { height: 180, width: 320 };
  if (node.data.kind === "image") return { height: 370, width: 280 };
  if (node.data.kind === "file") return { height: 68, width: 256 };
  if (node.data.kind === "text") return { height: 176, width: 560 };
  if (node.data.kind === "imageGeneration") {
    return node.data.imageGenerationResult
      ? { height: 260, width: 520 }
      : { height: 260, width: 520 };
  }
  if (node.data.kind === "videoGeneration") return { height: 315, width: 560 };
  if (node.data.kind === "video") return { height: 315, width: 560 };
  if (node.data.kind === "managedText") return { height: 380, width: 560 };
  if (node.data.kind === "task") return { height: 460, width: 560 };
  return { height: 110, width: 288 };
}

export function getAbsoluteNodePosition(
  node: CanvasNode,
  allNodes: CanvasNode[],
) {
  let x = node.position.x;
  let y = node.position.y;
  let parentId = node.parentId;

  while (parentId) {
    const parent = allNodes.find((item) => item.id === parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = parent.parentId;
  }

  return { x, y };
}

export function getNodeBounds(node: CanvasNode, allNodes: CanvasNode[]) {
  const position = getAbsoluteNodePosition(node, allNodes);
  const size = readNodeSize(node, getNodeSizeFallback(node));

  return {
    height: size.height,
    width: size.width,
    x: position.x,
    y: position.y,
  };
}

export function isNodeCenterInsideBounds(
  nodeBounds: ReturnType<typeof getNodeBounds>,
  parentBounds: ReturnType<typeof getNodeBounds>,
) {
  const centerX = nodeBounds.x + nodeBounds.width / 2;
  const centerY = nodeBounds.y + nodeBounds.height / 2;

  return (
    centerX >= parentBounds.x &&
    centerX <= parentBounds.x + parentBounds.width &&
    centerY >= parentBounds.y &&
    centerY <= parentBounds.y + parentBounds.height
  );
}

export function normalizeGroupNodeRelations(inputNodes: CanvasNode[]) {
  let changed = false;
  const groupIds = new Set(
    inputNodes
      .filter((node) => node.data.kind === "group")
      .map((node) => node.id),
  );

  const normalizedNodes = inputNodes.map((node) => {
    if (node.parentId && groupIds.has(node.parentId)) {
      changed = true;
      return {
        ...node,
        extent: undefined,
        parentId: undefined,
        position: getAbsoluteNodePosition(node, inputNodes),
        data: {
          ...node.data,
          groupId: node.parentId,
        },
      };
    }

    if (node.data.groupId && (node.parentId || node.extent === "parent")) {
      changed = true;
      return {
        ...node,
        extent: undefined,
        parentId: undefined,
      };
    }

    return node;
  });

  return changed ? normalizedNodes : inputNodes;
}

export function isNodeDimensionChange(
  change: NodeChange<CanvasNode>,
): change is NodeDimensionChange {
  return change.type === "dimensions" && Boolean(change.dimensions);
}

export function numericSize(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function collectReaderChildNodeIds(readerNodeId: string, edges: Edge[]) {
  const childIds = new Set<string>();
  const queue = [readerNodeId];

  while (queue.length > 0) {
    const sourceId = queue.shift();
    if (!sourceId) {
      continue;
    }

    for (const edge of edges) {
      if (
        edge.source !== sourceId ||
        edge.target === readerNodeId ||
        childIds.has(edge.target)
      ) {
        continue;
      }
      childIds.add(edge.target);
      queue.push(edge.target);
    }
  }

  return childIds;
}

export function shouldHideReaderChildEdge(
  readerNodeId: string,
  childIds: Set<string>,
  edge: Edge,
) {
  return (
    edge.source === readerNodeId ||
    childIds.has(edge.source) ||
    childIds.has(edge.target)
  );
}

export function isLegacyWelcomeNode(node: CanvasNode) {
  return (
    node.id === "welcome" ||
    node.data.title === "拖入文件或图片开始" ||
    node.data.fileName === "拖入文件或图片开始"
  );
}

export function removeLegacyWelcomeNodes(
  snapshotNodes: CanvasNode[],
  snapshotEdges: Edge[],
) {
  const nodesWithoutWelcome = snapshotNodes.filter(
    (node) => !isLegacyWelcomeNode(node),
  );
  const nodeIds = new Set(nodesWithoutWelcome.map((node) => node.id));
  const edgesWithoutWelcome = snapshotEdges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  return { nodes: nodesWithoutWelcome, edges: edgesWithoutWelcome };
}

export function recoverInterruptedImageTasks(nodes: CanvasNode[]) {
  return nodes.map((node) => {
    if (node.data.imageStatus === "editing") {
      return {
          ...node,
          data: {
            ...node.data,
            imageError: "任务因页面刷新或应用重启而中断，请重新提交",
            imageStatus: "failed" as const,
          },
        };
    }
    if (node.data.aiStatus === "generating") {
      return {
        ...node,
        data: {
          ...node.data,
          aiError: "任务因页面刷新或应用重启而中断，请重新提交",
          aiStatus: "failed" as const,
        },
      };
    }
    return node;
  });
}

export function getClientPointFromConnectEnd(event: MouseEvent | TouchEvent) {
  if ("changedTouches" in event && event.changedTouches.length > 0) {
    return {
      x: event.changedTouches[0].clientX,
      y: event.changedTouches[0].clientY,
    };
  }

  if ("clientX" in event) {
    return {
      x: event.clientX,
      y: event.clientY,
    };
  }

  return {
    x: 0,
    y: 0,
  };
}

export function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  if (!element) return false;

  return Boolean(
    element.closest(
      "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
    ) || (element as HTMLElement).isContentEditable,
  );
}

export function isEditableClipboardEvent(
  event: Pick<Event, "composedPath" | "target">,
  activeElement: EventTarget | null,
) {
  return [event.target, activeElement, ...event.composedPath()].some(
    isEditableTarget,
  );
}

export function cloneCanvasState(
  historyNodes: CanvasNode[],
  historyEdges: Edge[],
): CanvasHistoryEntry {
  return createCanvasHistoryEntry(historyNodes, historyEdges).entry;
}

export function createCanvasHistoryEntry(
  historyNodes: CanvasNode[],
  historyEdges: Edge[],
) {
  const serializedSnapshot = JSON.stringify(
    getCanvasHistorySnapshot(historyNodes, historyEdges),
  );
  const snapshot = JSON.parse(serializedSnapshot) as Omit<
    CanvasHistorySnapshotEntry,
    "type"
  >;

  return {
    entry: {
      type: "snapshot",
      ...snapshot,
    } satisfies CanvasHistorySnapshotEntry,
    signature: JSON.stringify(
      getCanvasHistorySignatureSnapshot(historyNodes, historyEdges),
    ),
  };
}

export function createCanvasHistoryNodeSnapshot(node: CanvasNode) {
  return JSON.parse(JSON.stringify(getCanvasHistoryNode(node))) as CanvasNode;
}

export function createCanvasHistoryEdgeSnapshot(edge: Edge) {
  return JSON.parse(JSON.stringify(getCanvasHistoryEdge(edge))) as Edge;
}

export function getCanvasHistorySignature(
  historyNodes: CanvasNode[],
  historyEdges: Edge[],
) {
  return JSON.stringify(
    getCanvasHistorySignatureSnapshot(historyNodes, historyEdges),
  );
}

function getCanvasHistorySignatureSnapshot(
  historyNodes: CanvasNode[],
  historyEdges: Edge[],
) {
  return {
    nodes: historyNodes.map((node) => {
      const historyNode = getCanvasHistoryNode(node);
      return {
        ...historyNode,
        data: Object.fromEntries(
          Object.entries(historyNode.data).filter(
            ([key]) => !CANVAS_HISTORY_TRANSIENT_DATA_KEYS.has(key),
          ),
        ),
      };
    }),
    edges: historyEdges.map(getCanvasHistoryEdge),
  };
}

function getCanvasHistorySnapshot(
  historyNodes: CanvasNode[],
  historyEdges: Edge[],
) {
  return {
    nodes: historyNodes.map(getCanvasHistoryNode),
    edges: historyEdges.map(getCanvasHistoryEdge),
  };
}

function getCanvasHistoryNode(node: CanvasNode) {
  const snapshotNode = { ...node } as CanvasNode & {
    dragging?: boolean;
    measured?: unknown;
    resizing?: boolean;
    selected?: boolean;
  };
  delete snapshotNode.dragging;
  delete snapshotNode.measured;
  delete snapshotNode.resizing;
  delete snapshotNode.selected;

  return {
    ...snapshotNode,
    data: getSerializableRecord(snapshotNode.data),
  } satisfies CanvasNode;
}

function getCanvasHistoryEdge(edge: Edge) {
  const snapshotEdge = { ...edge } as Edge & {
    selected?: boolean;
  };
  delete snapshotEdge.selected;

  return {
    ...snapshotEdge,
    data: edge.data ? getSerializableRecord(edge.data) : edge.data,
  } satisfies Edge;
}

function getSerializableRecord<T extends Record<string, unknown>>(record: T) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key, value]) =>
        key !== "hasIncomingEdge" &&
        key !== "hasOutgoingEdge" &&
        key !== "hasRunningGenerationChild" &&
        key !== "musicCurrentTime" &&
        key !== "musicIsPlaying" &&
        typeof value !== "function",
    ),
  ) as T;
}
