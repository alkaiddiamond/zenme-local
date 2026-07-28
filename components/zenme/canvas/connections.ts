import type { Connection, Edge } from "@xyflow/react";

import type {
  CanvasNode,
  NodeActionMenuState,
} from "@/components/zenme/canvas/types";
import {
  NODE_ACTION_HANDLE_ID,
  NODE_CONTEXT_HANDLE_ID,
  NODE_CONTEXT_TARGET_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
} from "@/components/zenme/node-types";

import { isTextGenerationContextNode } from "./text-generation-context";
import { acceptsCanvasContext } from "./node-capabilities";

export function isCanvasConnectionValid(
  connection: Connection | Edge,
) {
  const startsFromContextHandle =
    connection.sourceHandle === NODE_CONTEXT_HANDLE_ID;
  const endsAtContextTarget =
    connection.targetHandle === NODE_CONTEXT_TARGET_HANDLE_ID;

  if (startsFromContextHandle || endsAtContextTarget) {
    return startsFromContextHandle && endsAtContextTarget;
  }

  return true;
}

export function normalizeCanvasConnection(
  connection: Connection,
  nodes: CanvasNode[],
): Connection | null {
  if (!connection.source || !connection.target) {
    return null;
  }

  if (connection.source === connection.target) {
    return null;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sourceNode = nodeById.get(connection.source);
  const targetNode = nodeById.get(connection.target);

  if (!sourceNode || !targetNode) {
    return connection;
  }

  if (
    acceptsCanvasContext(sourceNode.data.kind) &&
    connection.sourceHandle === NODE_CONTEXT_HANDLE_ID
  ) {
    return {
      ...connection,
      source: targetNode.id,
      sourceHandle: NODE_RIGHT_HANDLE_ID,
      target: sourceNode.id,
      targetHandle: null,
    };
  }

  if (
    isTextGenerationContextNode(sourceNode) &&
    acceptsCanvasContext(targetNode.data.kind)
  ) {
    return {
      ...connection,
      sourceHandle: NODE_RIGHT_HANDLE_ID,
    };
  }

  if (connection.sourceHandle === NODE_ACTION_HANDLE_ID) {
    return {
      ...connection,
      sourceHandle: NODE_RIGHT_HANDLE_ID,
    };
  }

  return connection;
}

export function normalizePersistedCanvasEdges(
  edges: Edge[],
  nodes: CanvasNode[],
) {
  return edges.map((edge) => {
    if (
      edge.sourceHandle !== NODE_CONTEXT_HANDLE_ID &&
      edge.targetHandle !== NODE_CONTEXT_TARGET_HANDLE_ID
    ) {
      return edge;
    }

    const normalized = normalizeCanvasConnection(
      {
        source: edge.source,
        sourceHandle: edge.sourceHandle ?? null,
        target: edge.target,
        targetHandle: edge.targetHandle ?? null,
      },
      nodes,
    );

    return normalized ? { ...edge, ...normalized } : edge;
  });
}

export function createNodeActionMenuFromConnectEnd(input: {
  didConnectToNode: boolean;
  flowPosition: { x: number; y: number };
  point: { x: number; y: number };
  sourceHandleId: string | null;
  sourceNodeId: string | null;
}): NodeActionMenuState | null {
  if (
    !input.sourceNodeId ||
    input.sourceHandleId === NODE_CONTEXT_HANDLE_ID ||
    input.didConnectToNode
  ) {
    return null;
  }

  return {
    flowPosition: input.flowPosition,
    nodeId: input.sourceNodeId,
    x: input.point.x,
    y: input.point.y,
  };
}
