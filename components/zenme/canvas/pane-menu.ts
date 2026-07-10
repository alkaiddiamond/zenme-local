import type { CanvasAddMenuState } from "./types";

export function createCanvasAddMenuFromPaneDoubleClick(input: {
  flowPosition: { x: number; y: number };
  isEditableTarget: boolean;
  isInteractiveCanvasTarget: boolean;
  isPaneTarget: boolean;
  point: { x: number; y: number };
}): CanvasAddMenuState | null {
  if (
    input.isEditableTarget ||
    !input.isPaneTarget ||
    input.isInteractiveCanvasTarget
  ) {
    return null;
  }

  return {
    flowPosition: input.flowPosition,
    x: input.point.x,
    y: input.point.y,
  };
}
