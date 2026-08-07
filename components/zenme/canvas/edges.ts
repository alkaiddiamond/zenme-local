import type { Edge } from "@xyflow/react";

import {
  NODE_LEFT_HANDLE_ID,
  NODE_RIGHT_HANDLE_ID,
} from "@/components/zenme/node-types";
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

const renderedEdgeCache = new WeakMap<
  Edge,
  { dependencyKey: string; renderedEdge: Edge }
>();

export function getRenderedCanvasEdges(
  nodeKindById: Map<string, CanvasNodeData["kind"]>,
  edges: Edge[],
  selectedNodeIds = new Set<string>(),
) {
  return edges.map((edge) => {
    const sourceNodeKind = nodeKindById.get(edge.source);
    const targetNodeKind = nodeKindById.get(edge.target);
    const isNodeRelated =
      selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target);
    const dependencyKey = [
      sourceNodeKind ?? "",
      targetNodeKind ?? "",
      isNodeRelated ? "selected" : "idle",
    ].join("|");
    const cached = renderedEdgeCache.get(edge);
    if (cached?.dependencyKey === dependencyKey) {
      return cached.renderedEdge;
    }
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
    const renderedEdge =
      targetNodeKind === "task" && !edge.targetHandle
        ? { ...edge, targetHandle: NODE_LEFT_HANDLE_ID }
        : edge;

    let result: Edge;
    if (
      sourceNodeKind &&
      !edge.sourceHandle &&
      RIGHT_HANDLE_NODE_KINDS.has(sourceNodeKind)
    ) {
      result = {
        ...renderedEdge,
        className,
        sourceHandle: NODE_RIGHT_HANDLE_ID,
        type: "default",
      };
    } else if (edge.type === "smoothstep") {
      result = {
        ...renderedEdge,
        className,
        type: "default",
      };
    } else {
      result = renderedEdge.className === className
        ? renderedEdge
        : { ...renderedEdge, className };
    }

    renderedEdgeCache.set(edge, { dependencyKey, renderedEdge: result });
    return result;
  });
}
