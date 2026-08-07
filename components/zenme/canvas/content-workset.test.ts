import { describe, expect, it } from "vitest";

import type { Edge } from "@xyflow/react";
import type { CanvasNode } from "./types";
import {
  CANVAS_CONTENT_WORKSET_LIMIT,
  CANVAS_EDGE_WORKSET_THRESHOLD,
  getCanvasContentWorkset,
  getCanvasEdgeWorkset,
} from "./content-workset";

function node(id: string, x: number, y: number): CanvasNode {
  return {
    id,
    type: "text",
    position: { x, y },
    style: { height: 200, width: 300 },
    data: { kind: "text", title: id },
  };
}

describe("canvas content workset", () => {
  it("keeps every small-canvas node fully active", () => {
    expect(getCanvasContentWorkset({
      nodes: [node("a", 0, 0)],
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { height: 800, width: 1200 },
    })).toBeNull();
  });

  it("keeps visible, nearby and explicitly active nodes on a large canvas", () => {
    const nodes = Array.from({ length: 240 }, (_, index) =>
      node(`node-${index}`, index * 340, 0),
    );
    const active = getCanvasContentWorkset({
      alwaysActiveNodeIds: ["node-239"],
      nodes,
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { height: 800, width: 1200 },
    });

    expect(active?.has("node-0")).toBe(true);
    expect(active?.has("node-239")).toBe(true);
    expect(active?.size).toBeLessThanOrEqual(CANVAS_CONTENT_WORKSET_LIMIT + 1);
    expect(active?.has("node-120")).toBe(false);
  });

  it("resolves grouped child positions relative to their parent", () => {
    const nodes = Array.from({ length: 181 }, (_, index) =>
      node(`far-${index}`, 20_000 + index * 340, 20_000),
    );
    const parent = node("group", 100, 100);
    parent.type = "group";
    parent.data.kind = "group";
    const child = node("child", 50, 50);
    child.parentId = parent.id;
    nodes.push(parent, child);

    const active = getCanvasContentWorkset({
      nodes,
      viewport: { x: 0, y: 0, zoom: 1 },
      viewportSize: { height: 800, width: 1200 },
    });

    expect(active?.has("group")).toBe(true);
    expect(active?.has("child")).toBe(true);
  });
});

describe("canvas edge workset", () => {
  it("keeps the original edge collection on a small canvas", () => {
    const edges: Edge[] = [{ id: "a-b", source: "a", target: "b" }];

    expect(getCanvasEdgeWorkset({
      activeNodeIds: new Set(["a"]),
      edges,
    })).toBe(edges);
  });

  it("keeps only edges attached to active nodes on a dense canvas", () => {
    const edges: Edge[] = Array.from(
      { length: CANVAS_EDGE_WORKSET_THRESHOLD + 1 },
      (_, index) => ({
        id: `edge-${index}`,
        source: `node-${index}`,
        target: `node-${index + 1}`,
      }),
    );

    const workset = getCanvasEdgeWorkset({
      activeNodeIds: new Set(["node-150"]),
      edges,
    });

    expect(workset.map((edge) => edge.id)).toEqual([
      "edge-149",
      "edge-150",
    ]);
  });

  it("keeps all edges before an active node workset is available", () => {
    const edges: Edge[] = Array.from(
      { length: CANVAS_EDGE_WORKSET_THRESHOLD + 1 },
      (_, index) => ({
        id: `edge-${index}`,
        source: `node-${index}`,
        target: `node-${index + 1}`,
      }),
    );

    expect(getCanvasEdgeWorkset({
      activeNodeIds: null,
      edges,
    })).toBe(edges);
  });
});
