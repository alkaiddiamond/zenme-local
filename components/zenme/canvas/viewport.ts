import type { Viewport } from "./types";

export const CANVAS_ZOOM_MAX = 2.5;
export const CANVAS_ZOOM_MIN = 0.2;

export function clampCanvasZoom(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.min(Math.max(value, CANVAS_ZOOM_MIN), CANVAS_ZOOM_MAX);
}

export function getNextCanvasZoom(currentZoom: number, delta: number) {
  return clampCanvasZoom(Number((currentZoom + delta).toFixed(2)));
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
