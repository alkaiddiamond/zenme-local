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
});
