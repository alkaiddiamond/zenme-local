import type { Edge } from "@xyflow/react";

import { readNodeSize } from "./geometry";
import type { CanvasNode } from "./types";

const CONNECTED_PLACEHOLDER_SIZE = {
  agent: { height: 180, width: 320 },
  imageGeneration: { height: 260, width: 520 },
  managedText: { height: 380, width: 560 },
  task: { height: 460, width: 560 },
  text: { height: 260, width: 520 },
  textGeneration: { height: 180, width: 560 },
};

export function getNextConnectedChildNodePosition(input: {
  childFallbackSize: { height: number; width: number };
  edges: Edge[];
  nodes: CanvasNode[];
  sourceNode: CanvasNode;
  sourceFallbackSize: { height: number; width: number };
  yOffsetWithoutChild: number;
}) {
  const childNodesByEdgeOrder = input.edges
    .filter(
      (edge) =>
        edge.source === input.sourceNode.id &&
        edge.target !== input.sourceNode.id,
    )
    .map((edge) => input.nodes.find((node) => node.id === edge.target))
    .filter((node): node is CanvasNode => Boolean(node));
  const latestChild = childNodesByEdgeOrder[childNodesByEdgeOrder.length - 1];

  if (latestChild) {
    const latestChildSize = readNodeSize(latestChild, input.childFallbackSize);

    return {
      x: latestChild.position.x,
      y: latestChild.position.y + latestChildSize.height + 32,
    };
  }

  const sourceSize = readNodeSize(input.sourceNode, input.sourceFallbackSize);
  return {
    x: input.sourceNode.position.x + sourceSize.width + 80,
    y: input.sourceNode.position.y + input.yOffsetWithoutChild,
  };
}

export function getConnectedPlaceholderPosition(input: {
  flowPosition?: { x: number; y: number };
  kind:
    | "agent"
    | "imageGeneration"
    | "managedText"
    | "task"
    | "text"
    | "textGeneration";
}) {
  if (!input.flowPosition) {
    return undefined;
  }

  const nodeSize = CONNECTED_PLACEHOLDER_SIZE[input.kind];
  return {
    x: input.flowPosition.x,
    y: input.flowPosition.y - nodeSize.height / 2,
  };
}
