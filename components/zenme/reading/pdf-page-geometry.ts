import {
  PDF_PAGE_BASE_WIDTH,
  READING_PAGE_FRAME_PADDING,
} from "./constants";
import type { PdfAnnotationDraft } from "./types";

export function getPdfRelativePoint(input: {
  clientX: number;
  clientY: number;
  rect: DOMRect;
}) {
  return {
    x: Math.min(
      1,
      Math.max(0, (input.clientX - input.rect.left) / input.rect.width),
    ),
    y: Math.min(
      1,
      Math.max(0, (input.clientY - input.rect.top) / input.rect.height),
    ),
  };
}

export function getPdfRegionAnnotationDraft(input: {
  pageBounds: DOMRect | undefined;
  pageIndex: number;
  rect: PdfAnnotationDraft["rect"];
  workspaceBounds: DOMRect | undefined;
}): PdfAnnotationDraft {
  return {
    kind: "region",
    pageIndex: input.pageIndex,
    rect: input.rect,
    x:
      input.pageBounds && input.workspaceBounds
        ? Math.max(
            12,
            input.pageBounds.left -
              input.workspaceBounds.left +
              (input.rect.x + input.rect.w / 2) * input.pageBounds.width -
              120,
          )
        : 12,
    y:
      input.pageBounds && input.workspaceBounds
        ? Math.max(
            12,
            input.pageBounds.top -
              input.workspaceBounds.top +
              input.rect.y * input.pageBounds.height -
              48,
          )
        : 12,
  };
}

export function getPdfPageFrameSize(input: {
  contentScale: number;
  fallbackAspectRatio?: number | null;
  pageHeight: number;
  pageWidth: number;
}) {
  const surfaceWidth =
    input.pageWidth || PDF_PAGE_BASE_WIDTH * input.contentScale;
  const fallbackHeight =
    input.fallbackAspectRatio && Number.isFinite(input.fallbackAspectRatio)
      ? surfaceWidth * input.fallbackAspectRatio
      : 620;

  return {
    frameWidth: surfaceWidth + READING_PAGE_FRAME_PADDING * 2,
    surfaceHeight: input.pageHeight || fallbackHeight,
    surfaceWidth,
  };
}
