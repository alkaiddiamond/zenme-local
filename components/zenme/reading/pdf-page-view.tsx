import { memo, useEffect, useRef, useState } from "react";
import type {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from "react";

import type {
  ReadingNote,
} from "@/lib/reading/types";

import {
  PDF_PAGE_BASE_WIDTH,
  READING_PAGE_FRAME_CLASSNAME,
  READING_PAGE_HEADER_CLASSNAME,
} from "./constants";
import {
  getPdfPageFrameSize,
  getPdfRegionAnnotationDraft,
  getPdfRelativePoint,
} from "./pdf-page-geometry";
import { PdfPageOverlays } from "./pdf-page-overlays";
import { readPdfTextSelection } from "./pdf-utils";
import type { PdfAnnotationDraft, PdfDocumentProxyLike } from "./types";
import { useLazyPdfPageRender } from "./use-lazy-pdf-page-render";
import { normalizeRect } from "./utils";

type DraftInteraction =
  | {
      startPoint: { x: number; y: number };
      type: "draw";
    }
  | {
      startPoint: { x: number; y: number };
      startRect: PdfAnnotationDraft["rect"];
      type: "move";
    }
  | {
      edge: DraftResizeEdge;
      startPoint: { x: number; y: number };
      startRect: PdfAnnotationDraft["rect"];
      type: "resize";
    };

type DraftResizeEdge =
  | "e"
  | "n"
  | "ne"
  | "nw"
  | "s"
  | "se"
  | "sw"
  | "w";

const MIN_DRAFT_RECT_SIZE = 0.015;

type PdfPageViewProps = {
  annotationResetKey: number;
  contentScale: number;
  fallbackAspectRatio?: number | null;
  focusedNoteId: string | null;
  notes: ReadingNote[];
  onAnnotationDraft: (draft: PdfAnnotationDraft | null) => void;
  pageIndex: number;
  pageNumber: number;
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  pdf: PdfDocumentProxyLike;
};

export const PdfPageView = memo(function PdfPageView({
  annotationResetKey,
  contentScale,
  fallbackAspectRatio,
  focusedNoteId,
  notes,
  onAnnotationDraft,
  pageIndex,
  pageNumber,
  pageRefs,
  pdf,
}: PdfPageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const pageSurfaceRef = useRef<HTMLDivElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [pageSize, setPageSize] = useState({ height: 0, width: 0 });
  const [hasSelectableText, setHasSelectableText] = useState<boolean | null>(
    null,
  );
  const [shouldRender, setShouldRender] = useState(pageIndex === 0);
  const [draftRect, setDraftRect] = useState<PdfAnnotationDraft["rect"] | null>(
    null,
  );
  const [textSelectionPreviewRects, setTextSelectionPreviewRects] =
    useState<NonNullable<PdfAnnotationDraft["rects"]> | null>(null);
  const draftInteraction = useRef<DraftInteraction | null>(null);
  const activeRenderTask = useRef<{
    cancel: () => void;
    promise: Promise<unknown>;
  } | null>(null);
  const renderQueue = useRef<Promise<void>>(Promise.resolve());
  const renderGeneration = useRef(0);
  const lastRenderWidth = useRef(0);
  const resizeFrame = useRef<number | null>(null);

  useEffect(() => {
    const element = pageRef.current;
    if (!element) return;

    const refs = pageRefs.current;
    refs[pageIndex] = element;
    return () => {
      if (refs[pageIndex] === element) {
        refs[pageIndex] = null;
      }
    };
  }, [pageIndex, pageRefs]);

  useEffect(() => {
    const generation = renderGeneration.current + 1;
    renderGeneration.current = generation;
    let cancelled = false;
    let isRendering = false;
    let renderAgain = false;
    let resizeObserver: ResizeObserver | null = null;
    const container = pageRef.current;

    if (!shouldRender || !container) {
      return () => {
        cancelled = true;
      };
    }

    async function renderPage() {
      if (isRendering) {
        renderAgain = true;
        return;
      }
      isRendering = true;
      do {
        renderAgain = false;
        await renderPageOnce();
      } while (renderAgain && !cancelled);
      isRendering = false;
    }

    async function renderPageOnce() {
      const canvas = canvasRef.current;
      const container = pageRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !container) return;

      await renderQueue.current.catch(() => undefined);
      if (cancelled || renderGeneration.current !== generation) return;

      const pdfjs = await import("pdfjs-dist");
      const page = await pdf.getPage(pageNumber);
      if (cancelled || renderGeneration.current !== generation) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const scale = (PDF_PAGE_BASE_WIDTH / baseViewport.width) * contentScale;
      const viewport = page.getViewport({ scale });
      const ratio = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");
      if (!context) return;

      setHasSelectableText(null);
      setTextSelectionPreviewRects(null);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      setPageSize({ height: viewport.height, width: viewport.width });
      const renderTask = page.render({ canvas, canvasContext: context, viewport });
      activeRenderTask.current = renderTask;
      renderQueue.current = renderTask.promise
        .then(() => undefined)
        .catch((error: unknown) => {
          if (!isPdfRenderCancelled(error)) {
            throw error;
          }
        });
      try {
        await renderQueue.current;
      } finally {
        if (activeRenderTask.current === renderTask) {
          activeRenderTask.current = null;
        }
      }
      if (cancelled || renderGeneration.current !== generation) return;

      const textContent = await page.getTextContent();
      if (cancelled || renderGeneration.current !== generation) return;
      const textContentSummary = textContent as {
        items?: Array<{ str?: string }>;
      };
      const nextHasSelectableText =
        textContentSummary.items?.some((item) => item.str?.trim()) ?? false;
      setHasSelectableText(nextHasSelectableText);
      if (nextHasSelectableText) {
        setDraftRect(null);
        setTextSelectionPreviewRects(null);
        draftInteraction.current = null;
      }

      if (!textLayer) return;
      textLayer.innerHTML = "";
      textLayer.style.setProperty("--total-scale-factor", String(scale));
      if (!nextHasSelectableText) {
        return;
      }

      const layer = new pdfjs.TextLayer({
        container: textLayer,
        textContentSource: textContent as never,
        viewport: viewport as never,
      });
      await layer.render();
      if (cancelled || renderGeneration.current !== generation) return;
    }

    void renderPage();

    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (Math.abs(width - lastRenderWidth.current) < 2) {
        return;
      }
      lastRenderWidth.current = width;
      if (resizeFrame.current) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      resizeFrame.current = window.requestAnimationFrame(() => {
        void renderPage();
      });
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      activeRenderTask.current?.cancel();
      if (resizeFrame.current) {
        window.cancelAnimationFrame(resizeFrame.current);
      }
      resizeObserver?.disconnect();
    };
  }, [contentScale, pageNumber, pdf, shouldRender]);

  useLazyPdfPageRender({
    pageRef,
    setShouldRender,
  });

  useEffect(() => {
    if (shouldRender) return;
    setHasSelectableText(null);
    setTextSelectionPreviewRects(null);
    textLayerRef.current?.replaceChildren();
  }, [shouldRender]);

  useEffect(() => {
    setDraftRect(null);
    setTextSelectionPreviewRects(null);
    draftInteraction.current = null;
  }, [annotationResetKey]);

  useEffect(() => {
    if (!hasSelectableText) {
      return;
    }

    function handleSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setTextSelectionPreviewRects(null);
        return;
      }

      const nextDraft = readPdfTextSelection({
        pageIndex,
        surfaceElement: pageSurfaceRef.current,
        textLayerElement: textLayerRef.current,
      });
      if (nextDraft) {
        setTextSelectionPreviewRects(nextDraft.rects ?? [nextDraft.rect]);
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [hasSelectableText, pageIndex]);

  function getRelativePoint(event: ReactPointerEvent<HTMLDivElement>) {
    return getPdfRelativePoint({
      clientX: event.clientX,
      clientY: event.clientY,
      rect: event.currentTarget.getBoundingClientRect(),
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (hasSelectableText !== false) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getRelativePoint(event);
    const draftTarget = getDraftInteractionTarget(event.target);

    if (draftRect && draftTarget) {
      draftInteraction.current =
        draftTarget === "move"
          ? {
              startPoint: point,
              startRect: draftRect,
              type: "move",
            }
          : {
              edge: draftTarget,
              startPoint: point,
              startRect: draftRect,
              type: "resize",
            };
      setTextSelectionPreviewRects(null);
      onAnnotationDraft(null);
      return;
    }

    draftInteraction.current = { startPoint: point, type: "draw" };
    setDraftRect({ x: point.x, y: point.y, w: 0, h: 0 });
    setTextSelectionPreviewRects(null);
    onAnnotationDraft(null);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (hasSelectableText !== false) {
      return;
    }
    if (!draftInteraction.current) return;
    const point = getRelativePoint(event);
    setDraftRect(getNextDraftRect(draftInteraction.current, point));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (hasSelectableText !== false) {
      return;
    }
    if (!draftInteraction.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const point = getRelativePoint(event);
    const nextRect = getNextDraftRect(draftInteraction.current, point);
    draftInteraction.current = null;
    setDraftRect(nextRect);

    if (nextRect.w < MIN_DRAFT_RECT_SIZE || nextRect.h < MIN_DRAFT_RECT_SIZE) {
      setDraftRect(null);
      onAnnotationDraft(null);
      return;
    }

    commitRegionDraft(nextRect);
  }

  function handleTextLayerMouseUp() {
    if (!hasSelectableText) {
      return;
    }

    const nextDraft = readPdfTextSelection({
      pageIndex,
      surfaceElement: pageSurfaceRef.current,
      textLayerElement: textLayerRef.current,
    });
    if (nextDraft) {
      setDraftRect(null);
      setTextSelectionPreviewRects(nextDraft.rects ?? [nextDraft.rect]);
      onAnnotationDraft(nextDraft);
    } else {
      setTextSelectionPreviewRects(null);
    }
  }

  const pageFrameSize = getPdfPageFrameSize({
    contentScale,
    fallbackAspectRatio,
    pageHeight: pageSize.height,
    pageWidth: pageSize.width,
  });

  function commitRegionDraft(nextRect: PdfAnnotationDraft["rect"]) {
    const pageElement = pageSurfaceRef.current;
    const workspace = pageElement?.closest(
      ".zenme-reader-workspace",
    ) as HTMLElement | null;
    const pageBounds = pageElement?.getBoundingClientRect();
    const workspaceBounds = workspace?.getBoundingClientRect();
    onAnnotationDraft({
      ...getPdfRegionAnnotationDraft({
        pageBounds,
        pageIndex,
        rect: nextRect,
        workspaceBounds,
      }),
      imageDataUrl: cropPdfRegionToDataUrl(canvasRef.current, nextRect),
    });
  }

  return (
    <section
      className="mx-auto"
      ref={pageRef}
      style={{ width: pageFrameSize.frameWidth }}
    >
      <div
        className={READING_PAGE_FRAME_CLASSNAME}
        style={{
          width: pageFrameSize.frameWidth,
        }}
      >
        <div className={READING_PAGE_HEADER_CLASSNAME}>第 {pageNumber} 页</div>
        <div
          className={`relative mx-auto overflow-hidden bg-white ${
            hasSelectableText ? "cursor-text" : ""
          }`}
          onMouseUpCapture={handleTextLayerMouseUp}
          ref={pageSurfaceRef}
          style={{
            height: pageFrameSize.surfaceHeight,
            width: pageFrameSize.surfaceWidth,
          }}
        >
          {shouldRender ? (
            <canvas className="block" ref={canvasRef} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-zinc-400">
              第 {pageNumber} 页
            </div>
          )}
          {hasSelectableText ? (
            <div
              className="textLayer zenme-pdf-text-layer absolute inset-0"
              data-pdf-text-layer={pageIndex}
              ref={textLayerRef}
            />
          ) : (
            <div className="absolute inset-0" ref={textLayerRef} />
          )}
          <PdfPageOverlays
            draftRect={draftRect}
            focusedNoteId={focusedNoteId}
            hasSelectableText={hasSelectableText}
            notes={notes}
            onPointerCancel={() => {
              draftInteraction.current = null;
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            pageIndex={pageIndex}
            textSelectionPreviewRects={textSelectionPreviewRects}
          />
        </div>
      </div>
    </section>
  );
});

function getDraftInteractionTarget(
  target: EventTarget,
): "move" | DraftResizeEdge | null {
  if (!(target instanceof HTMLElement)) return null;
  const value = target.dataset.pdfDraftRegion;
  if (
    value === "move" ||
    value === "e" ||
    value === "n" ||
    value === "ne" ||
    value === "nw" ||
    value === "s" ||
    value === "se" ||
    value === "sw" ||
    value === "w"
  ) {
    return value;
  }
  return null;
}

function getNextDraftRect(
  interaction: DraftInteraction,
  point: { x: number; y: number },
) {
  if (interaction.type === "draw") {
    return normalizeRect(interaction.startPoint, point);
  }

  if (interaction.type === "move") {
    return moveRect({
      dx: point.x - interaction.startPoint.x,
      dy: point.y - interaction.startPoint.y,
      rect: interaction.startRect,
    });
  }

  return resizeRect({
    dx: point.x - interaction.startPoint.x,
    dy: point.y - interaction.startPoint.y,
    edge: interaction.edge,
    rect: interaction.startRect,
  });
}

function moveRect(input: {
  dx: number;
  dy: number;
  rect: PdfAnnotationDraft["rect"];
}) {
  return {
    ...input.rect,
    x: clamp(input.rect.x + input.dx, 0, 1 - input.rect.w),
    y: clamp(input.rect.y + input.dy, 0, 1 - input.rect.h),
  };
}

function resizeRect(input: {
  dx: number;
  dy: number;
  edge: DraftResizeEdge;
  rect: PdfAnnotationDraft["rect"];
}) {
  let left = input.rect.x;
  let right = input.rect.x + input.rect.w;
  let top = input.rect.y;
  let bottom = input.rect.y + input.rect.h;

  if (input.edge.includes("w")) left += input.dx;
  if (input.edge.includes("e")) right += input.dx;
  if (input.edge.includes("n")) top += input.dy;
  if (input.edge.includes("s")) bottom += input.dy;

  left = clamp(left, 0, right - MIN_DRAFT_RECT_SIZE);
  right = clamp(right, left + MIN_DRAFT_RECT_SIZE, 1);
  top = clamp(top, 0, bottom - MIN_DRAFT_RECT_SIZE);
  bottom = clamp(bottom, top + MIN_DRAFT_RECT_SIZE, 1);

  return {
    h: bottom - top,
    w: right - left,
    x: left,
    y: top,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPdfRenderCancelled(error: unknown) {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "RenderingCancelledException" ||
    error.message.toLowerCase().includes("cancelled")
  );
}

function cropPdfRegionToDataUrl(
  sourceCanvas: HTMLCanvasElement | null,
  rect: PdfAnnotationDraft["rect"],
) {
  if (!sourceCanvas) return undefined;

  const sx = Math.max(0, Math.floor(rect.x * sourceCanvas.width));
  const sy = Math.max(0, Math.floor(rect.y * sourceCanvas.height));
  const sw = Math.max(1, Math.floor(rect.w * sourceCanvas.width));
  const sh = Math.max(1, Math.floor(rect.h * sourceCanvas.height));
  const maxOutputWidth = 1800;
  const outputScale = Math.min(1, maxOutputWidth / sw);
  const targetWidth = Math.max(1, Math.floor(sw * outputScale));
  const targetHeight = Math.max(1, Math.floor(sh * outputScale));
  const crop = document.createElement("canvas");
  const context = crop.getContext("2d");

  if (!context) return undefined;

  crop.width = targetWidth;
  crop.height = targetHeight;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(
    sourceCanvas,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  return crop.toDataURL("image/png");
}
