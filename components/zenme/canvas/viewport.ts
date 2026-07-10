import type { Viewport } from "./types";

export const CANVAS_ZOOM_MAX = 2;
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
