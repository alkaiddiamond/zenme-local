import { describe, expect, it } from "vitest";

import {
  CANVAS_ZOOM_MAX,
  CANVAS_ZOOM_MIN,
  CANVAS_VIEWPORT_FOCUS_DURATION_MS,
  clampCanvasZoom,
  createPreservedZoomNodeFocusOptions,
  createCanvasZoomViewport,
  createCanvasZoomViewportAtPoint,
  getCanvasWheelZoom,
  getCanvasMotionDuration,
  getNextCanvasZoom,
  normalizeCanvasWheelDelta,
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
    expect(getNextCanvasZoom(2.45, 0.1)).toBe(CANVAS_ZOOM_MAX);
  });

  it("normalizes wheel input and applies continuous exponential zoom", () => {
    expect(normalizeCanvasWheelDelta(2, 0, 800)).toBe(2);
    expect(normalizeCanvasWheelDelta(2, 1, 800)).toBe(32);
    expect(normalizeCanvasWheelDelta(2, 2, 800)).toBe(1600);
    expect(getCanvasWheelZoom(1, -100)).toBeGreaterThan(1);
    expect(getCanvasWheelZoom(1, 100)).toBeLessThan(1);
    expect(getCanvasWheelZoom(CANVAS_ZOOM_MAX, -100)).toBe(CANVAS_ZOOM_MAX);
  });

  it("disables viewport animation when reduced motion is requested", () => {
    expect(getCanvasMotionDuration(300, true)).toBe(0);
    expect(getCanvasMotionDuration(300, false)).toBe(300);
  });

  it("creates a zoomed viewport without changing pan coordinates", () => {
    expect(createCanvasZoomViewport({ x: 10, y: 20, zoom: 1 }, 1.5)).toEqual({
      x: 10,
      y: 20,
      zoom: 1.5,
    });
  });

  it("keeps the flow point under the mouse fixed while zooming", () => {
    expect(
      createCanvasZoomViewportAtPoint(
        { x: 100, y: 50, zoom: 1 },
        2,
        { x: 300, y: 250 },
      ),
    ).toEqual({ x: -100, y: -150, zoom: 2 });
  });

  it("focuses a node while locking fit-view to the current zoom", () => {
    expect(createPreservedZoomNodeFocusOptions("player-1", 0.75)).toEqual({
      duration: CANVAS_VIEWPORT_FOCUS_DURATION_MS,
      maxZoom: 0.75,
      minZoom: 0.75,
      nodes: [{ id: "player-1" }],
      padding: 0.3,
    });
  });
});
