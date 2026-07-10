import type { Edge } from "@xyflow/react";

import { NODE_RIGHT_HANDLE_ID } from "@/components/zenme/node-types";
import type { CanvasNodeData } from "@/components/zenme/node-types";

const RIGHT_HANDLE_NODE_KINDS = new Set([
  "agent",
  "book",
  "code",
  "file",
  "group",
  "image",
  "markdown",
  "note",
  "reader",
  "text",
  "textGeneration",
]);

export function getRenderedCanvasEdges(
  nodeKindById: Map<string, CanvasNodeData["kind"]>,
  edges: Edge[],
) {
  return edges.map((edge) => {
    const sourceNodeKind = nodeKindById.get(edge.source);

    if (
      sourceNodeKind &&
      !edge.sourceHandle &&
      RIGHT_HANDLE_NODE_KINDS.has(sourceNodeKind)
    ) {
      return {
        ...edge,
        sourceHandle: NODE_RIGHT_HANDLE_ID,
        type: "default",
      };
    }

    if (edge.type === "smoothstep") {
      return {
        ...edge,
        type: "default",
      };
    }

    return edge;
  });
}
