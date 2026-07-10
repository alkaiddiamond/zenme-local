import { describe, expect, it } from "vitest";

import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  clampCanvasZoom,
  createCanvasZoomViewport,
  getNextCanvasZoom,
} from "./viewport";

describe("canvas viewport helpers", () => {
  it("clamps zoom values to the supported canvas range", () => {
    expect(clampCanvasZoom(0.05)).toBe(CANVAS_ZOOM_MIN);
    expect(clampCanvasZoom(1.25)).toBe(1.25);
    expect(clampCanvasZoom(3)).toBe(CANVAS_ZOOM_MAX);
    expect(clampCanvasZoom(Number.NaN)).toBe(1);
  });

  it("steps zoom values with stable two-decimal precision", () => {
    expect(getNextCanvasZoom(0.2, -0.1)).toBe(CANVAS_ZOOM_MIN);
    expect(getNextCanvasZoom(1.01, 0.1)).toBe(1.11);
    expect(getNextCanvasZoom(1.95, 0.1)).toBe(CANVAS_ZOOM_MAX);
  });

  it("creates a zoomed viewport without changing pan coordinates", () => {
    expect(createCanvasZoomViewport({ x: 10, y: 20, zoom: 1 }, 1.5)).toEqual({
      x: 10,
      y: 20,
      zoom: 1.5,
    });
  });
});
