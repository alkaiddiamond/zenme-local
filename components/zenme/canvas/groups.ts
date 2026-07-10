import {
  getAbsoluteNodePosition,
  getNodeBounds,
  GROUP_NODE_GAP,
  GROUP_PADDING,
  isNodeCenterInsideBounds,
} from "@/components/zenme/canvas/geometry";

import type { CanvasNode } from "./types";

type GroupedNodeLayout = {
  arranged: Map<string, { x: number; y: number }>;
  groupId: string;
  groupPosition: { x: number; y: number };
  nextGroupNode: CanvasNode;
  selectedIds: Set<string>;
};

export type GroupDragPosition = {
  id: string;
  position: { x: number; y: number };
};

export function getGroupFrameDragMove(input: {
  draggedNode: CanvasNode;
  previous: GroupDragPosition | null;
}) {
  if (input.draggedNode.data.kind !== "group") {
    return {
      delta: null,
      next: null,
    };
  }

  const next = {
    id: input.draggedNode.id,
    position: input.draggedNode.position,
  };

  if (!input.previous || input.previous.id !== input.draggedNode.id) {
    return {
      delta: null,
      next,
    };
  }

  const delta = {
    x: input.draggedNode.position.x - input.previous.position.x,
    y: input.draggedNode.position.y - input.previous.position.y,
  };

  return {
    delta: delta.x === 0 && delta.y === 0 ? null : delta,
    next,
  };
}

export function createGroupedNodeLayout(
  selectedNodes: CanvasNode[],
  allNodes: CanvasNode[],
  groupId: string,
): GroupedNodeLayout | null {
  if (selectedNodes.length < 2) {
    return null;
  }

  const selectedIds = new Set(selectedNodes.map((node) => node.id));
  const selectedWithBounds = selectedNodes.map((node) => ({
    bounds: getNodeBounds(node, allNodes),
    node,
  }));
  const ordered = [...selectedWithBounds].sort((a, b) =>
    Math.abs(a.bounds.y - b.bounds.y) > 24
      ? a.bounds.y - b.bounds.y
      : a.bounds.x - b.bounds.x,
  );
  const columns = ordered.length > 4 ? 2 : 1;
  const columnWidths = Array.from({ length: columns }, (_, columnIndex) =>
    Math.max(
      ...ordered
        .filter((_, index) => index % columns === columnIndex)
        .map((item) => item.bounds.width),
      0,
    ),
  );
  const columnX = getStackedOffsets(columnWidths);
  const rowCount = Math.ceil(ordered.length / columns);
  const rowHeights = Array.from({ length: rowCount }, (_, rowIndex) =>
    Math.max(
      ...ordered
        .filter((_, index) => Math.floor(index / columns) === rowIndex)
        .map((item) => item.bounds.height),
      0,
    ),
  );
  const rowY = getStackedOffsets(rowHeights);
  const contentWidth =
    columnWidths.reduce((sum, width) => sum + width, 0) +
    GROUP_NODE_GAP * Math.max(0, columns - 1);
  const contentHeight =
    rowHeights.reduce((sum, height) => sum + height, 0) +
    GROUP_NODE_GAP * Math.max(0, rowCount - 1);
  const minX = Math.min(...selectedWithBounds.map((item) => item.bounds.x));
  const minY = Math.min(...selectedWithBounds.map((item) => item.bounds.y));
  const groupPosition = {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING,
  };
  const groupSize = {
    height: GROUP_PADDING * 2 + contentHeight,
    width: GROUP_PADDING * 2 + contentWidth,
  };
  const nextGroupNode: CanvasNode = {
    id: groupId,
    position: groupPosition,
    selected: true,
    style: groupSize,
    type: "group",
    data: {
      kind: "group",
      title: "新建组",
    },
  };
  const arranged = new Map(
    ordered.map((item, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return [
        item.node.id,
        {
          x: columnX[column],
          y: rowY[row],
        },
      ];
    }),
  );

  return {
    arranged,
    groupId,
    groupPosition,
    nextGroupNode,
    selectedIds,
  };
}

export function applyGroupedNodeLayout(
  currentNodes: CanvasNode[],
  layout: GroupedNodeLayout,
) {
  const remainingNodes = currentNodes.filter(
    (node) => !layout.selectedIds.has(node.id),
  );
  const groupedNodes = currentNodes
    .filter((node) => layout.selectedIds.has(node.id))
    .map((node) => {
      const arrangedPosition = layout.arranged.get(node.id);

      return {
        ...node,
        extent: undefined,
        parentId: undefined,
        position: arrangedPosition
          ? {
              x: layout.groupPosition.x + arrangedPosition.x,
              y: layout.groupPosition.y + arrangedPosition.y,
            }
          : {
              x: layout.groupPosition.x + GROUP_PADDING,
              y: layout.groupPosition.y + GROUP_PADDING,
            },
        data: {
          ...node.data,
          groupId: layout.groupId,
        },
        selected: false,
      };
    });

  return [...remainingNodes, layout.nextGroupNode, ...groupedNodes];
}

export function createGroupSelectionUpdate(input: {
  allNodes: CanvasNode[];
  groupId: string;
  selectedNodes: CanvasNode[];
}) {
  const layout = createGroupedNodeLayout(
    input.selectedNodes,
    input.allNodes,
    input.groupId,
  );
  if (!layout) {
    return null;
  }

  const selectedIds = new Set(input.selectedNodes.map((node) => node.id));
  const nextNodes = applyGroupedNodeLayout(input.allNodes, layout);
  const createdGroupNode = nextNodes.find((node) => node.id === input.groupId);
  const nodeUpdates = input.allNodes
    .filter((node) => selectedIds.has(node.id))
    .flatMap((before) => {
      const after = nextNodes.find((node) => node.id === before.id);
      return after ? [{ id: before.id, before, after }] : [];
    });

  return {
    createdGroupNode,
    nextNodes,
    nodeUpdates,
  };
}

export function releaseGroupedNodeDragExtent(
  currentNodes: CanvasNode[],
  draggedNode: CanvasNode,
) {
  if (!draggedNode.parentId || draggedNode.extent !== "parent") {
    return currentNodes;
  }

  return currentNodes.map((node) =>
    node.id === draggedNode.id
      ? {
          ...node,
          extent: undefined,
        }
      : node,
  );
}

export function detachGroupedNodeIfOutside(
  currentNodes: CanvasNode[],
  draggedNodeId: string,
) {
  const currentNode = currentNodes.find((node) => node.id === draggedNodeId);
  const currentGroupId = currentNode?.data.groupId ?? currentNode?.parentId;
  const parentNode = currentGroupId
    ? currentNodes.find((node) => node.id === currentGroupId)
    : undefined;

  if (!currentNode || !parentNode || parentNode.data.kind !== "group") {
    return currentNodes;
  }

  const nodeBounds = getNodeBounds(currentNode, currentNodes);
  const parentBounds = getNodeBounds(parentNode, currentNodes);

  if (isNodeCenterInsideBounds(nodeBounds, parentBounds)) {
    return currentNodes;
  }

  return currentNodes.map((node) => {
    if (node.id !== currentNode.id) {
      return node;
    }

    return {
      ...node,
      extent: undefined,
      parentId: undefined,
      data: {
        ...node.data,
        groupId: undefined,
      },
      position: {
        x: nodeBounds.x,
        y: nodeBounds.y,
      },
      selected: true,
    };
  });
}

export function moveGroupedNodesWithFrame(
  currentNodes: CanvasNode[],
  groupId: string,
  delta: { x: number; y: number },
) {
  if (delta.x === 0 && delta.y === 0) {
    return currentNodes;
  }

  return currentNodes.map((node) => {
    if (
      node.id === groupId ||
      (node.data.groupId !== groupId && node.parentId !== groupId)
    ) {
      return node;
    }

    const position = node.parentId
      ? getAbsoluteNodePosition(node, currentNodes)
      : node.position;

    return {
      ...node,
      extent: undefined,
      parentId: undefined,
      position: {
        x: position.x + delta.x,
        y: position.y + delta.y,
      },
      data: {
        ...node.data,
        groupId,
      },
    };
  });
}

function getStackedOffsets(sizes: number[]) {
  return sizes.reduce<number[]>((positions, _size, index) => {
    if (index === 0) {
      positions.push(GROUP_PADDING);
    } else {
      positions.push(positions[index - 1] + sizes[index - 1] + GROUP_NODE_GAP);
    }
    return positions;
  }, []);
}
