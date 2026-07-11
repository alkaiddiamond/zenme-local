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
  selectedNodeIds = new Set<string>(),
) {
  return edges.map((edge) => {
    const sourceNodeKind = nodeKindById.get(edge.source);
    const isNodeRelated =
      selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target);
    const preservedClassNames = edge.className
      ?.split(/\s+/)
      .filter(
        (value) =>
          value &&
          value !== "zenme-edge-node-related" &&
          value !== "zenme-edge-idle",
      )
      .join(" ");
    const className = [
      preservedClassNames,
      isNodeRelated ? "zenme-edge-node-related" : "zenme-edge-idle",
    ].filter(Boolean).join(" ");

    if (
      sourceNodeKind &&
      !edge.sourceHandle &&
      RIGHT_HANDLE_NODE_KINDS.has(sourceNodeKind)
    ) {
      return {
        ...edge,
        className,
        sourceHandle: NODE_RIGHT_HANDLE_ID,
        type: "default",
      };
    }

    if (edge.type === "smoothstep") {
      return {
        ...edge,
        className,
        type: "default",
      };
    }

    return edge.className === className ? edge : { ...edge, className };
  });
}
