import { describe, expect, it } from "vitest";

import { isValidCanvasSnapshot, MAX_CANVAS_NODES } from "./canvas-validation";

describe("isValidCanvasSnapshot", () => {
  it("accepts a bounded snapshot", () => {
    expect(isValidCanvasSnapshot({
      version: 1,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date().toISOString(),
    })).toBe(true);
  });

  it("rejects invalid viewport and excessive nodes", () => {
    expect(isValidCanvasSnapshot({
      version: 1,
      nodes: Array.from({ length: MAX_CANVAS_NODES + 1 }),
      edges: [],
      viewport: { x: 0, y: 0, zoom: 0 },
      updatedAt: new Date().toISOString(),
    })).toBe(false);
  });
});
