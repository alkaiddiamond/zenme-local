import type { Edge } from "@xyflow/react";

import type { TaskChildSummary } from "@/components/zenme/node-types";

import { createCanvasHistoryNodeSnapshot } from "./geometry";
import type { CanvasNode } from "./types";

export type TaskRelationshipState = {
  childrenByParentId: Map<string, TaskChildSummary[]>;
  parentIdByChildId: Map<string, string>;
};

export function deriveTaskRelationships(
  nodes: CanvasNode[],
  edges: Array<Pick<Edge, "source" | "target">>,
): TaskRelationshipState {
  const taskById = new Map(
    nodes
      .filter((node) => node.data.kind === "task")
      .map((node) => [node.id, node]),
  );
  const parentIdByChildId = new Map<string, string>();

  for (const node of taskById.values()) {
    const parentId = node.data.taskParentId;
    if (parentId && parentId !== node.id && taskById.has(parentId)) {
      parentIdByChildId.set(node.id, parentId);
    }
  }

  for (const edge of edges) {
    if (
      !parentIdByChildId.has(edge.target) &&
      edge.source !== edge.target &&
      taskById.has(edge.source) &&
      taskById.has(edge.target)
    ) {
      parentIdByChildId.set(edge.target, edge.source);
    }
  }

  const childrenByParentId = new Map<string, TaskChildSummary[]>();
  for (const [childId, parentId] of parentIdByChildId) {
    const child = taskById.get(childId);
    if (!child) continue;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push({
      id: child.id,
      name: child.data.name?.trim() || "未命名任务",
      status: child.data.taskStatus ?? "inProgress",
    });
    childrenByParentId.set(parentId, children);
  }

  return { childrenByParentId, parentIdByChildId };
}

export function getTaskParentOptions(input: {
  edges: Array<Pick<Edge, "source" | "target">>;
  nodeId: string;
  nodes: CanvasNode[];
}) {
  const relationships = deriveTaskRelationships(input.nodes, input.edges);
  const excludedIds = collectTaskDescendantIds(
    input.nodeId,
    relationships.childrenByParentId,
  );
  excludedIds.add(input.nodeId);

  return input.nodes
    .filter(
      (node) =>
        node.data.kind === "task" &&
        !excludedIds.has(node.id),
    )
    .map((node) => ({
      id: node.id,
      name: node.data.name?.trim() || "未命名任务",
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
}

export function canSetTaskParent(input: {
  childId: string;
  edges: Array<Pick<Edge, "source" | "target">>;
  nodes: CanvasNode[];
  parentId: string;
}) {
  return getTaskParentOptions({
    edges: input.edges,
    nodeId: input.childId,
    nodes: input.nodes,
  }).some((option) => option.id === input.parentId);
}

export function createTaskParentSelectionUpdate(input: {
  edges: Edge[];
  nodeId: string;
  nodes: CanvasNode[];
  now?: string;
  parentId?: string;
}) {
  const sourceNode = input.nodes.find(
    (node) => node.id === input.nodeId && node.data.kind === "task",
  );
  if (!sourceNode) return null;
  if (
    input.parentId &&
    !canSetTaskParent({
      childId: input.nodeId,
      edges: input.edges,
      nodes: input.nodes,
      parentId: input.parentId,
    })
  ) {
    return null;
  }

  const relationships = deriveTaskRelationships(input.nodes, input.edges);
  const currentParentId = relationships.parentIdByChildId.get(input.nodeId);
  const deletedEdges = input.edges.filter((edge) => {
    const source = input.nodes.find((node) => node.id === edge.source);
    return (
      edge.target === input.nodeId &&
      source?.data.kind === "task" &&
      edge.source !== input.parentId
    );
  });
  const nextEdges = deletedEdges.length
    ? input.edges.filter((edge) => !deletedEdges.includes(edge))
    : input.edges;
  const parentChanged =
    currentParentId !== input.parentId ||
    sourceNode.data.taskParentId !== input.parentId;

  if (!parentChanged && deletedEdges.length === 0) return null;

  const nextNode: CanvasNode = {
    ...sourceNode,
    data: {
      ...sourceNode.data,
      taskParentId: input.parentId,
      updatedAt: input.now ?? new Date().toISOString(),
    },
  };
  const nextNodes = input.nodes.map((node) =>
    node.id === input.nodeId ? nextNode : node,
  );

  return {
    deletedEdges,
    nextEdges,
    nextNodes,
    nodeUpdates: [
      {
        after: createCanvasHistoryNodeSnapshot(nextNode),
        before: createCanvasHistoryNodeSnapshot(sourceNode),
        id: sourceNode.id,
      },
    ],
  };
}

export function createTaskConnectionNodeUpdate(input: {
  childId: string;
  nodes: CanvasNode[];
  now?: string;
  parentId: string;
}) {
  const child = input.nodes.find(
    (node) => node.id === input.childId && node.data.kind === "task",
  );
  if (!child || child.data.taskParentId === input.parentId) {
    return {
      nextNodes: input.nodes,
      nodeUpdates: [],
    };
  }

  const nextChild: CanvasNode = {
    ...child,
    data: {
      ...child.data,
      taskParentId: input.parentId,
      updatedAt: input.now ?? new Date().toISOString(),
    },
  };

  return {
    nextNodes: input.nodes.map((node) =>
      node.id === input.childId ? nextChild : node,
    ),
    nodeUpdates: [
      {
        after: createCanvasHistoryNodeSnapshot(nextChild),
        before: createCanvasHistoryNodeSnapshot(child),
        id: child.id,
      },
    ],
  };
}

function collectTaskDescendantIds(
  nodeId: string,
  childrenByParentId: TaskRelationshipState["childrenByParentId"],
) {
  const descendants = new Set<string>();
  const pending = [...(childrenByParentId.get(nodeId) ?? [])];

  while (pending.length > 0) {
    const child = pending.shift();
    if (!child || descendants.has(child.id)) continue;
    descendants.add(child.id);
    pending.push(...(childrenByParentId.get(child.id) ?? []));
  }

  return descendants;
}
