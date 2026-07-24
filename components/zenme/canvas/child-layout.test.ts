import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  getConnectedPlaceholderPosition,
  getNextConnectedChildNodePosition,
} from "./child-layout";
import type { CanvasNode } from "./types";

function node(input: {
  id: string;
  position?: { x: number; y: number };
  style?: CanvasNode["style"];
}): CanvasNode {
  return {
    id: input.id,
    position: input.position ?? { x: 0, y: 0 },
    style: input.style,
    type: "text",
    data: {
      kind: "text",
      title: input.id,
    },
  } as CanvasNode;
}

function edge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
  };
}

describe("connected child layout helper", () => {
  it("places the first child to the right of the source node", () => {
    expect(
      getNextConnectedChildNodePosition({
        childFallbackSize: { height: 260, width: 520 },
        edges: [],
        nodes: [node({ id: "source", position: { x: 100, y: 200 } })],
        sourceFallbackSize: { height: 260, width: 520 },
        sourceNode: node({ id: "source", position: { x: 100, y: 200 } }),
        yOffsetWithoutChild: 48,
      }),
    ).toEqual({ x: 700, y: 248 });
  });

  it("places later children below the latest connected child", () => {
    const source = node({ id: "source", position: { x: 100, y: 200 } });
    const oldChild = node({
      id: "old",
      position: { x: 700, y: 248 },
      style: { height: 300, width: 520 },
    });
    const latestChild = node({
      id: "latest",
      position: { x: 700, y: 600 },
      style: { height: 180, width: 520 },
    });

    expect(
      getNextConnectedChildNodePosition({
        childFallbackSize: { height: 260, width: 520 },
        edges: [edge("source", "old"), edge("source", "latest")],
        nodes: [source, latestChild, oldChild],
        sourceFallbackSize: { height: 260, width: 520 },
        sourceNode: source,
        yOffsetWithoutChild: 48,
      }),
    ).toEqual({ x: 700, y: 812 });
  });

  it("places connected placeholders centered around the menu y position", () => {
    expect(
      getConnectedPlaceholderPosition({
        flowPosition: { x: 400, y: 300 },
        kind: "text",
      }),
    ).toEqual({ x: 400, y: 212 });
    expect(
      getConnectedPlaceholderPosition({
        flowPosition: { x: 400, y: 300 },
        kind: "agent",
      }),
    ).toEqual({ x: 400, y: 210 });
    expect(
      getConnectedPlaceholderPosition({
        flowPosition: { x: 400, y: 300 },
        kind: "textGeneration",
      }),
    ).toEqual({ x: 400, y: 210 });
  });

  it("returns undefined when there is no menu flow position", () => {
    expect(
      getConnectedPlaceholderPosition({
        kind: "text",
      }),
    ).toBeUndefined();
  });
});
