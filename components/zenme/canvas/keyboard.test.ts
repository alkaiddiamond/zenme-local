import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  collectSelectedNodeIdsWithChildren,
  createCanvasDeleteSelection,
  removeNodesAndConnectedEdges,
} from "./keyboard";
import type { CanvasNode } from "./types";

function node(input: {
  id: string;
  parentId?: string;
  selected?: boolean;
}): CanvasNode {
  return {
    id: input.id,
    parentId: input.parentId,
    position: { x: 0, y: 0 },
    selected: input.selected,
    type: "text",
    data: {
      kind: "text",
      title: input.id,
    },
  } as CanvasNode;
}

function edge(input: {
  id: string;
  selected?: boolean;
  source: string;
  target: string;
}): Edge {
  return {
    id: input.id,
    selected: input.selected,
    source: input.source,
    target: input.target,
  };
}

describe("canvas keyboard helpers", () => {
  it("collects selected parent nodes with their direct children", () => {
    expect(
      [...collectSelectedNodeIdsWithChildren([
        node({ id: "group", selected: true }),
        node({ id: "child", parentId: "group" }),
        node({ id: "other" }),
      ])],
    ).toEqual(["group", "child"]);
  });

  it("removes selected nodes and their connected edges", () => {
    const nodes = [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })];
    const edges = [
      edge({ id: "ab", source: "a", target: "b" }),
      edge({ id: "bc", source: "b", target: "c" }),
      edge({ id: "ca", source: "c", target: "a" }),
    ];

    expect(
      removeNodesAndConnectedEdges(nodes, edges, new Set(["b"])),
    ).toEqual({
      edges: [edge({ id: "ca", source: "c", target: "a" })],
      nodes: [node({ id: "a" }), node({ id: "c" })],
    });
  });

  it("creates a delete selection result for selected nodes and edges", () => {
    const nodes = [
      node({ id: "a", selected: true }),
      node({ id: "b" }),
      node({ id: "c" }),
    ];
    const edges = [
      edge({ id: "ab", source: "a", target: "b" }),
      edge({ id: "bc", selected: true, source: "b", target: "c" }),
    ];

    expect(createCanvasDeleteSelection({ edges, nodes })).toEqual({
      deletedEdges: edges,
      deletedNodes: [nodes[0]],
      nextEdges: [],
      nextNodes: [nodes[1], nodes[2]],
    });
  });

  it("can delete only selected edges", () => {
    const nodes = [node({ id: "a" }), node({ id: "b" }), node({ id: "c" })];
    const selectedEdge = edge({
      id: "ab",
      selected: true,
      source: "a",
      target: "b",
    });
    const remainingEdge = edge({ id: "bc", source: "b", target: "c" });

    expect(
      createCanvasDeleteSelection({
        edges: [selectedEdge, remainingEdge],
        nodes,
      }),
    ).toEqual({
      deletedEdges: [selectedEdge],
      deletedNodes: [],
      nextEdges: [remainingEdge],
      nextNodes: nodes,
    });
  });

  it("returns null when no canvas item is selected", () => {
    expect(
      createCanvasDeleteSelection({
        edges: [edge({ id: "ab", source: "a", target: "b" })],
        nodes: [node({ id: "a" }), node({ id: "b" })],
      }),
    ).toBeNull();
  });
});
