import { describe, expect, it } from "vitest";

import { getRenderedCanvasEdges } from "./edges";

describe("rendered canvas edge states", () => {
  const kinds = new Map([
    ["source", "image" as const],
    ["target", "image" as const],
  ]);

  it("marks an unrelated edge as idle", () => {
    const [edge] = getRenderedCanvasEdges(kinds, [
      { id: "edge", source: "source", target: "target" },
    ]);
    expect(edge.className).toContain("zenme-edge-idle");
  });

  it("marks an edge as related when either endpoint node is selected", () => {
    const [edge] = getRenderedCanvasEdges(
      kinds,
      [{ id: "edge", source: "source", target: "target" }],
      new Set(["target"]),
    );
    expect(edge.className).toContain("zenme-edge-node-related");
    expect(edge.className).not.toContain("zenme-edge-idle");
  });

  it("preserves the selected state for the strongest native edge style", () => {
    const [edge] = getRenderedCanvasEdges(
      kinds,
      [{ id: "edge", selected: true, source: "source", target: "target" }],
      new Set(["source"]),
    );
    expect(edge.selected).toBe(true);
    expect(edge.className).toContain("zenme-edge-node-related");
  });

  it("anchors legacy task targets to the task node left handle", () => {
    const [edge] = getRenderedCanvasEdges(
      new Map([
        ["source", "text" as const],
        ["target", "task" as const],
      ]),
      [{ id: "edge", source: "source", target: "target" }],
    );

    expect(edge.targetHandle).toBe("node-left");
  });

  it("keeps unchanged rendered edge references stable when another edge is added", () => {
    const sourceEdge = { id: "edge", source: "source", target: "target" };
    const [first] = getRenderedCanvasEdges(kinds, [sourceEdge]);
    const [second] = getRenderedCanvasEdges(kinds, [
      sourceEdge,
      { id: "added", source: "target", target: "source" },
    ]);

    expect(second).toBe(first);
  });

  it("invalidates a cached edge when its selection relation changes", () => {
    const sourceEdge = { id: "edge", source: "source", target: "target" };
    const [idle] = getRenderedCanvasEdges(kinds, [sourceEdge]);
    const [related] = getRenderedCanvasEdges(
      kinds,
      [sourceEdge],
      new Set(["source"]),
    );

    expect(related).not.toBe(idle);
    expect(related.className).toContain("zenme-edge-node-related");
  });
});
