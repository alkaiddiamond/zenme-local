import type { Edge } from "@xyflow/react";

import {
  AI_RESPONSE_DEFAULT_SIZE,
  MUSIC_CHILD_DEFAULT_SIZE,
  TASK_NODE_DEFAULT_SIZE,
  TEXT_NODE_DEFAULT_SIZE,
} from "./node-updates";
import {
  collectReaderChildNodeIds,
  createCanvasHistoryNodeSnapshot,
  getNodeSizeFallback,
  GROUP_PADDING,
  readNodeSize,
  READER_COLLAPSED_SIZE,
  READER_DEFAULT_SIZE,
  shouldHideReaderChildEdge,
} from "./geometry";
import type { CanvasNode } from "./types";
import { IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE } from "./node-factories";

const HORIZONTAL_GAP = 72;
const VERTICAL_GAP = 48;
const COMPONENT_GAP = 96;

export function createQuickArrangeUpdate(input: {
  edges: Edge[];
  nodes: CanvasNode[];
}) {
  if (input.nodes.length === 0) return null;

  const collapsed = collapseExpandableNodes(input.nodes, input.edges);
  const arrangedNodes = arrangeCanvasNodes(collapsed.nodes, collapsed.edges);
  const nodeUpdates = input.nodes.flatMap((before) => {
    const after = arrangedNodes.find((node) => node.id === before.id);
    return after && !areNodesLayoutEqual(before, after)
      ? [{
          after: createCanvasHistoryNodeSnapshot(after),
          before: createCanvasHistoryNodeSnapshot(before),
          id: before.id,
        }]
      : [];
  });
  const edgeUpdates = input.edges.flatMap((before) => {
    const after = collapsed.edges.find((edge) => edge.id === before.id);
    return after && before.hidden !== after.hidden
      ? [{ after, before, id: before.id }]
      : [];
  });

  if (nodeUpdates.length === 0 && edgeUpdates.length === 0) return null;

  return {
    edgeUpdates,
    nextEdges: collapsed.edges,
    nextNodes: arrangedNodes,
    nodeUpdates,
  };
}

export function arrangeCanvasNodes(nodes: CanvasNode[], edges: Edge[]) {
  if (nodes.length === 0) return nodes;

  const groupMembersById = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    if (!node.data.groupId) continue;
    const members = groupMembersById.get(node.data.groupId) ?? [];
    members.push(node);
    groupMembersById.set(node.data.groupId, members);
  }
  const layoutNodes = nodes.filter(
    (node) =>
      node.data.kind !== "group" ||
      !(groupMembersById.get(node.id)?.length),
  );
  const layoutNodeIds = new Set(layoutNodes.map((node) => node.id));
  const layoutEdges = edges.filter(
    (edge) =>
      layoutNodeIds.has(edge.source) &&
      layoutNodeIds.has(edge.target) &&
      edge.source !== edge.target,
  );
  const nodeById = new Map(layoutNodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(layoutNodes.map((node, index) => [node.id, index]));
  const components = collectWeakComponents(layoutNodes, layoutEdges)
    .map((ids) => {
      const roots = getComponentRoots(ids, layoutEdges);
      return {
        ids,
        roots,
        sortKey: Math.min(
          ...roots.map((id) => getNodeSortKey(nodeById.get(id), nodeOrder)),
        ),
      };
    })
    .sort((left, right) => left.sortKey - right.sortKey);
  const baseX = Math.min(...layoutNodes.map((node) => node.position.x));
  let nextComponentY = Math.min(
    ...layoutNodes.map((node) => node.position.y),
  );
  const arrangedPositions = new Map<string, { x: number; y: number }>();

  for (const component of components) {
    const depthById = getNodeDepths(
      component.ids,
      component.roots,
      layoutEdges,
      nodeOrder,
    );
    const maxDepth = Math.max(...depthById.values(), 0);
    const layers = Array.from({ length: maxDepth + 1 }, () => [] as CanvasNode[]);
    for (const id of component.ids) {
      const node = nodeById.get(id);
      if (node) layers[depthById.get(id) ?? 0].push(node);
    }
    const layerWidths = layers.map((layer) =>
      Math.max(
        ...layer.map(
          (node) => readNodeSize(node, getNodeSizeFallback(node)).width,
        ),
        0,
      ),
    );
    const layerX = layerWidths.reduce<number[]>((offsets, width, index) => {
      if (index === 0) return [baseX];
      return [
        ...offsets,
        offsets[index - 1] + layerWidths[index - 1] + HORIZONTAL_GAP,
      ];
    }, []);
    let componentBottom = nextComponentY;

    for (let depth = 0; depth < layers.length; depth += 1) {
      const layer = layers[depth];
      layer.sort((left, right) => {
        if (depth > 0) {
          const leftParentY = getAverageParentY(
            left.id,
            layoutEdges,
            arrangedPositions,
          );
          const rightParentY = getAverageParentY(
            right.id,
            layoutEdges,
            arrangedPositions,
          );
          if (leftParentY !== rightParentY) return leftParentY - rightParentY;
        }
        return (
          getNodeSortKey(left, nodeOrder) -
          getNodeSortKey(right, nodeOrder)
        );
      });
      let layerCursorY = nextComponentY;

      for (const node of layer) {
        const size = readNodeSize(node, getNodeSizeFallback(node));
        const parentY = getAverageParentY(
          node.id,
          layoutEdges,
          arrangedPositions,
        );
        const desiredY = Number.isFinite(parentY)
          ? parentY - size.height / 2
          : nextComponentY;
        const y = Math.max(nextComponentY, layerCursorY, desiredY);
        arrangedPositions.set(node.id, {
          x: layerX[depth] ?? baseX,
          y,
        });
        layerCursorY = y + size.height + VERTICAL_GAP;
        componentBottom = Math.max(componentBottom, y + size.height);
      }
    }

    nextComponentY = componentBottom + COMPONENT_GAP;
  }

  const positionedNodes = nodes.map((node) => {
    const position = arrangedPositions.get(node.id);
    return position ? { ...node, position } : node;
  });

  return resizeGroupFrames(positionedNodes, groupMembersById);
}

function collapseExpandableNodes(nodes: CanvasNode[], edges: Edge[]) {
  const readerChildIds = new Set<string>();
  const readerIds = new Set(
    nodes
      .filter((node) => node.data.kind === "reader")
      .map((node) => node.id),
  );
  for (const readerId of readerIds) {
    for (const childId of collectReaderChildNodeIds(readerId, edges)) {
      readerChildIds.add(childId);
    }
  }

  return {
    edges: edges.map((edge) =>
      [...readerIds].some((readerId) =>
        shouldHideReaderChildEdge(readerId, readerChildIds, edge),
      )
        ? { ...edge, hidden: true }
        : edge,
    ),
    nodes: nodes.map((node) => {
      if (node.data.kind === "task") {
        return withCollapsedSize(node, TASK_NODE_DEFAULT_SIZE, {
          taskChildrenExpanded: false,
          taskExpandedHeight:
            node.data.taskChildrenExpanded !== false
              ? readNodeSize(node, getNodeSizeFallback(node)).height
              : node.data.taskExpandedHeight,
        });
      }
      if (node.data.kind === "text") {
        return withCollapsedSize(node, TEXT_NODE_DEFAULT_SIZE, {
          textExpanded: false,
        });
      }
      if (node.data.kind === "imageGeneration") {
        return withCollapsedSize(
          node,
          IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE,
          { imagePromptExpanded: false },
        );
      }
      if (node.data.kind === "agent") {
        return withCollapsedSize(node, AI_RESPONSE_DEFAULT_SIZE, {
          aiResponseExpanded: false,
        });
      }
      if (
        (
          node.data.kind === "lyrics"
        )
      ) {
        return withCollapsedSize(node, MUSIC_CHILD_DEFAULT_SIZE, {
          musicChildExpanded: false,
        });
      }
      if (node.data.kind === "reader") {
        return withCollapsedSize(node, READER_COLLAPSED_SIZE, {
          readerCollapsed: true,
          readerExpandedSize: node.data.readerCollapsed
            ? node.data.readerExpandedSize
            : readNodeSize(node, READER_DEFAULT_SIZE),
        });
      }
      if (readerChildIds.has(node.id)) {
        return { ...node, hidden: true };
      }
      return node;
    }),
  };
}

function withCollapsedSize(
  node: CanvasNode,
  size: { height: number; width: number },
  data: Partial<CanvasNode["data"]>,
): CanvasNode {
  return {
    ...node,
    height: size.height,
    measured: { ...size },
    style: {
      ...(node.style ?? {}),
      ...size,
    },
    width: size.width,
    data: {
      ...node.data,
      ...data,
    },
  };
}

function collectWeakComponents(nodes: CanvasNode[], edges: Edge[]) {
  const neighbors = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of edges) {
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const ids: string[] = [];
    const queue = [node.id];
    visited.add(node.id);
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id) continue;
      ids.push(id);
      for (const neighbor of neighbors.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(ids);
  }

  return components;
}

function getComponentRoots(ids: string[], edges: Edge[]) {
  const idSet = new Set(ids);
  const incomingIds = new Set(
    edges
      .filter(
        (edge) => idSet.has(edge.source) && idSet.has(edge.target),
      )
      .map((edge) => edge.target),
  );
  const roots = ids.filter((id) => !incomingIds.has(id));
  return roots.length > 0 ? roots : [ids[0]];
}

function getNodeDepths(
  ids: string[],
  roots: string[],
  edges: Edge[],
  nodeOrder: Map<string, number>,
) {
  const idSet = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, [] as string[]]));
  const incomingCount = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
  }
  const depthById = new Map(roots.map((id) => [id, 0]));
  const queue = [...roots].sort(
    (left, right) =>
      (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0),
  );
  const remainingIncoming = new Map(incomingCount);

  while (queue.length > 0) {
    const sourceId = queue.shift();
    if (!sourceId) continue;
    for (const targetId of outgoing.get(sourceId) ?? []) {
      depthById.set(
        targetId,
        Math.max(
          depthById.get(targetId) ?? 0,
          (depthById.get(sourceId) ?? 0) + 1,
        ),
      );
      const nextIncoming = (remainingIncoming.get(targetId) ?? 1) - 1;
      remainingIncoming.set(targetId, nextIncoming);
      if (nextIncoming === 0) queue.push(targetId);
    }
  }

  for (const id of ids) {
    if (!depthById.has(id)) depthById.set(id, 0);
  }
  return depthById;
}

function getAverageParentY(
  nodeId: string,
  edges: Edge[],
  positions: Map<string, { x: number; y: number }>,
) {
  const parentCenters = edges.flatMap((edge) => {
    if (edge.target !== nodeId) return [];
    const position = positions.get(edge.source);
    return position ? [position.y] : [];
  });
  if (parentCenters.length === 0) return Number.NaN;
  return (
    parentCenters.reduce((total, value) => total + value, 0) /
    parentCenters.length
  );
}

function getNodeSortKey(
  node: CanvasNode | undefined,
  nodeOrder: Map<string, number>,
) {
  if (!node) return Number.MAX_SAFE_INTEGER;
  const timestamp = [
    node.data.createdAt,
    node.data.aiCreatedAt,
    node.data.imageTaskStartedAt,
  ].find((value) => value && Number.isFinite(Date.parse(value)));
  return timestamp
    ? Date.parse(timestamp)
    : Number.MIN_SAFE_INTEGER + (nodeOrder.get(node.id) ?? 0);
}

function resizeGroupFrames(
  nodes: CanvasNode[],
  groupMembersById: Map<string, CanvasNode[]>,
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) => {
    if (node.data.kind !== "group") return node;
    const members = (groupMembersById.get(node.id) ?? [])
      .map((member) => nodeById.get(member.id))
      .filter((member): member is CanvasNode => Boolean(member));
    if (members.length === 0) return node;
    const bounds = members.map((member) => {
      const size = readNodeSize(member, getNodeSizeFallback(member));
      return {
        bottom: member.position.y + size.height,
        left: member.position.x,
        right: member.position.x + size.width,
        top: member.position.y,
      };
    });
    const left = Math.min(...bounds.map((item) => item.left));
    const top = Math.min(...bounds.map((item) => item.top));
    const size = {
      height:
        Math.max(...bounds.map((item) => item.bottom)) -
        top +
        GROUP_PADDING * 2,
      width:
        Math.max(...bounds.map((item) => item.right)) -
        left +
        GROUP_PADDING * 2,
    };
    return {
      ...node,
      height: size.height,
      measured: { ...size },
      position: {
        x: left - GROUP_PADDING,
        y: top - GROUP_PADDING,
      },
      style: { ...(node.style ?? {}), ...size },
      width: size.width,
    };
  });
}

function areNodesLayoutEqual(left: CanvasNode, right: CanvasNode) {
  return (
    left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.hidden === right.hidden &&
    left.width === right.width &&
    left.height === right.height &&
    JSON.stringify(left.style) === JSON.stringify(right.style) &&
    JSON.stringify(left.data) === JSON.stringify(right.data)
  );
}
