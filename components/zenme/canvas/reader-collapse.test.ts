import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { createReaderCollapseUpdate } from "./reader-collapse";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  hidden?: boolean;
  id: string;
  position?: { x: number; y: number };
  style?: CanvasNode["style"];
  type?: string;
}): CanvasNode {
  return {
    hidden: input.hidden,
    id: input.id,
    position: input.position ?? { x: 0, y: 0 },
    style: input.style,
    type: input.type ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

function edge(input: {
  hidden?: boolean;
  id: string;
  source: string;
  target: string;
}): Edge {
  return {
    hidden: input.hidden,
    id: input.id,
    source: input.source,
    target: input.target,
  };
}

describe("reader collapse helper", () => {
  it("returns null when the reader node is missing or not a reader", () => {
    expect(
      createReaderCollapseUpdate({
        edges: [],
        nodes: [node({ id: "text" })],
        readerNodeId: "text",
      }),
    ).toBeNull();
  });

  it("collapses reader descendants and internal edges", () => {
    const reader = node({
      data: { kind: "reader", title: "阅读器" },
      id: "reader",
      style: { height: 620, width: 960 },
      type: "reader",
    });
    const child = node({ id: "child" });
    const grandchild = node({ id: "grandchild" });
    const outside = node({ id: "outside" });
    const readerEdge = edge({ id: "reader-child", source: "reader", target: "child" });
    const childEdge = edge({ id: "child-grandchild", source: "child", target: "grandchild" });
    const outsideEdge = edge({ id: "outside-reader", source: "outside", target: "reader" });

    const update = createReaderCollapseUpdate({
      edges: [readerEdge, childEdge, outsideEdge],
      nodes: [reader, child, grandchild, outside],
      readerNodeId: "reader",
    });

    expect(update?.nextCollapsed).toBe(true);
    expect(update?.nextNodes.find((item) => item.id === "reader")).toMatchObject({
      height: 110,
      width: 288,
      data: {
        readerCollapsed: true,
        readerExpandedSize: { height: 620, width: 960 },
      },
    });
    expect(update?.nextNodes.find((item) => item.id === "child")?.hidden).toBe(true);
    expect(update?.nextNodes.find((item) => item.id === "grandchild")?.hidden).toBe(true);
    expect(update?.nextNodes.find((item) => item.id === "outside")?.hidden).toBeUndefined();
    expect(update?.nextEdges.find((item) => item.id === "reader-child")?.hidden).toBe(true);
    expect(update?.nextEdges.find((item) => item.id === "child-grandchild")?.hidden).toBe(true);
    expect(update?.nextEdges.find((item) => item.id === "outside-reader")?.hidden).toBeUndefined();
    expect(update?.nodeUpdates.map((item) => item.id)).toEqual([
      "reader",
      "child",
      "grandchild",
    ]);
  });

  it("expands reader descendants with the remembered expanded size", () => {
    const reader = node({
      data: {
        kind: "reader",
        readerCollapsed: true,
        readerExpandedSize: { height: 700, width: 1000 },
        title: "阅读器",
      },
      id: "reader",
      position: { x: 100, y: 100 },
      style: { height: 110, width: 288 },
      type: "reader",
    });
    const child = node({
      hidden: true,
      id: "child",
      position: { x: 40, y: 900 },
    });
    const grandchild = node({
      hidden: true,
      id: "grandchild",
      position: { x: 420, y: 940 },
    });
    const outside = node({ id: "outside", position: { x: 12, y: 34 } });
    const readerEdge = edge({
      hidden: true,
      id: "reader-child",
      source: "reader",
      target: "child",
    });
    const childEdge = edge({
      hidden: true,
      id: "child-grandchild",
      source: "child",
      target: "grandchild",
    });

    const update = createReaderCollapseUpdate({
      edges: [readerEdge, childEdge],
      nodes: [reader, child, grandchild, outside],
      readerNodeId: "reader",
    });

    expect(update?.nextCollapsed).toBe(false);
    expect(update?.nextNodes.find((item) => item.id === "reader")).toMatchObject({
      height: 700,
      width: 1000,
      data: {
        readerCollapsed: false,
        readerExpandedSize: { height: 700, width: 1000 },
      },
    });
    expect(update?.nextNodes.find((item) => item.id === "child")).toMatchObject({
      hidden: false,
      position: { x: 1148, y: 226 },
    });
    expect(
      update?.nextNodes.find((item) => item.id === "grandchild"),
    ).toMatchObject({
      hidden: false,
      position: { x: 1528, y: 266 },
    });
    expect(update?.nextNodes.find((item) => item.id === "outside")).toMatchObject({
      position: { x: 12, y: 34 },
    });
    expect(update?.nextEdges.find((item) => item.id === "reader-child")?.hidden).toBe(false);
    expect(update?.nextEdges.find((item) => item.id === "child-grandchild")?.hidden).toBe(false);
    expect(update?.edgeUpdates).toHaveLength(2);
  });
});
