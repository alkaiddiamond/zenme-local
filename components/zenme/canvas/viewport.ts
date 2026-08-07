import type { Viewport } from "./types";

export const CANVAS_ZOOM_MAX = 2.5;
export const CANVAS_ZOOM_MIN = 0.2;
export const CANVAS_VIEWPORT_FOCUS_DURATION_MS = 220;
export const CANVAS_VIEWPORT_FIT_DURATION_MS = 300;
const CANVAS_WHEEL_ZOOM_SENSITIVITY = 0.002;

export function clampCanvasZoom(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(value, CANVAS_ZOOM_MIN), CANVAS_ZOOM_MAX);
}

export function getNextCanvasZoom(currentZoom: number, delta: number) {
  return clampCanvasZoom(Number((currentZoom + delta).toFixed(2)));
}

export function normalizeCanvasWheelDelta(
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
) {
  if (!Number.isFinite(deltaY)) return 0;
  if (deltaMode === 1) return deltaY * 16;
  if (deltaMode === 2) return deltaY * Math.max(viewportHeight, 1);
  return deltaY;
}

export function getCanvasWheelZoom(currentZoom: number, deltaPixels: number) {
  return clampCanvasZoom(
    currentZoom * Math.exp(-deltaPixels * CANVAS_WHEEL_ZOOM_SENSITIVITY),
  );
}

export function getCanvasMotionDuration(
  duration: number,
  reducedMotion = typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
) {
  return reducedMotion ? 0 : duration;
}

export function createCanvasZoomViewport(
  viewport: Viewport,
  zoom: number,
): Viewport {
  return {
    ...viewport,
    zoom: clampCanvasZoom(zoom),
  };
}

export function createCanvasZoomViewportAtPoint(
  viewport: Viewport,
  zoom: number,
  point: { x: number; y: number },
): Viewport {
  const nextZoom = clampCanvasZoom(zoom);
  const currentZoom = clampCanvasZoom(viewport.zoom);
  const flowX = (point.x - viewport.x) / currentZoom;
  const flowY = (point.y - viewport.y) / currentZoom;

  return {
    x: point.x - flowX * nextZoom,
    y: point.y - flowY * nextZoom,
    zoom: nextZoom,
  };
}

export function createPreservedZoomNodeFocusOptions(
  nodeId: string,
  currentZoom: number,
) {
  const zoom = clampCanvasZoom(currentZoom);

  return {
    duration: getCanvasMotionDuration(CANVAS_VIEWPORT_FOCUS_DURATION_MS),
    maxZoom: zoom,
    minZoom: zoom,
    nodes: [{ id: nodeId }],
    padding: 0.3,
  };
}
