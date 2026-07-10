import type { PdfAnnotationDraft } from "./types";
import { getAnnotationPalettePosition } from "./utils";

export function readPdfTextSelection(input: {
  pageIndex: number;
  surfaceElement: HTMLElement | null;
  textLayerElement: HTMLElement | null;
}): PdfAnnotationDraft | null {
  const browserSelection = window.getSelection();
  if (
    !input.surfaceElement ||
    !input.textLayerElement ||
    !browserSelection ||
    browserSelection.isCollapsed ||
    browserSelection.rangeCount === 0
  ) {
    return null;
  }

  const text = browserSelection.toString().trim();
  if (!text) {
    return null;
  }

  const anchorNode = browserSelection.anchorNode;
  const focusNode = browserSelection.focusNode;
  if (
    (anchorNode && !input.textLayerElement.contains(anchorNode)) ||
    (focusNode && !input.textLayerElement.contains(focusNode))
  ) {
    return null;
  }

  const range = browserSelection.getRangeAt(0);
  const pageRect = input.surfaceElement.getBoundingClientRect();
  const annotationLayer = input.surfaceElement.closest(
    "[data-reading-annotation-layer]",
  ) as HTMLElement | null;
  const annotationLayerRect = annotationLayer?.getBoundingClientRect();
  const selectionRects = Array.from(range.getClientRects()).filter(
    (rect) =>
      rect.width > 1 &&
      rect.height > 1 &&
      rect.right > pageRect.left &&
      rect.left < pageRect.right &&
      rect.bottom > pageRect.top &&
      rect.top < pageRect.bottom,
  );

  if (selectionRects.length === 0) {
    return null;
  }

  const relativeRects = selectionRects.map((rect) => ({
    x: Math.min(1, Math.max(0, (rect.left - pageRect.left) / pageRect.width)),
    y: Math.min(1, Math.max(0, (rect.top - pageRect.top) / pageRect.height)),
    w: Math.min(1, Math.max(0, rect.width / pageRect.width)),
    h: Math.min(1, Math.max(0, rect.height / pageRect.height)),
  }));
  const selectionBounds = selectionRects.reduce(
    (bounds, rect) => ({
      left: Math.min(bounds.left, rect.left),
      top: Math.min(bounds.top, rect.top),
      right: Math.max(bounds.right, rect.right),
      bottom: Math.max(bounds.bottom, rect.bottom),
    }),
    {
      left: selectionRects[0].left,
      top: selectionRects[0].top,
      right: selectionRects[0].right,
      bottom: selectionRects[0].bottom,
    },
  );
  const rect = {
    x: Math.min(
      1,
      Math.max(0, (selectionBounds.left - pageRect.left) / pageRect.width),
    ),
    y: Math.min(
      1,
      Math.max(0, (selectionBounds.top - pageRect.top) / pageRect.height),
    ),
    w: Math.min(
      1,
      Math.max(
        0,
        (selectionBounds.right - selectionBounds.left) / pageRect.width,
      ),
    ),
    h: Math.min(
      1,
      Math.max(
        0,
        (selectionBounds.bottom - selectionBounds.top) / pageRect.height,
      ),
    ),
  };

  if (rect.w < 0.005 || rect.h < 0.005) {
    return null;
  }

  return {
    kind: "text",
    pageIndex: input.pageIndex,
    rect,
    rects: relativeRects,
    selectedText: text,
    ...(annotationLayerRect
      ? getAnnotationPalettePosition({
          selectionBounds,
          containerRect: annotationLayerRect,
        })
      : { x: 12, y: 12 }),
  };
}
