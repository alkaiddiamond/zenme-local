"use client";

import type {
  MutableRefObject,
  UIEvent,
} from "react";
import { useRef } from "react";
import { OverlayScrollbars } from "@/components/zenme/nodes/overlay-scrollbar";

import { EpubPagedScrollView } from "./epub-paged-scroll-view";
import { PdfReadingView } from "./pdf-reading-view";
import { ReadingTextSectionsView } from "./reading-text-sections-view";
import type {
  PdfAnnotationDraft,
  PdfOutlineSection,
  ReadingPayload,
  TextSelection,
} from "./types";

type ReadingMainPaneProps = {
  annotationResetKey: number;
  assetId: string;
  contentScale: number;
  focusedNoteId: string | null;
  nodeMode: boolean;
  onAnnotationDraft: (draft: PdfAnnotationDraft | null) => void;
  onError: (message: string | null) => void;
  onMouseUp: () => void;
  onOutline: (sections: PdfOutlineSection[]) => void;
  onPageCount: (count: number) => void;
  onScroll: (event: UIEvent<HTMLElement>) => void;
  payload: ReadingPayload;
  readerScrollRef: MutableRefObject<HTMLElement | null>;
  sectionRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  selection: TextSelection | null;
  visibleRange: [number, number];
};

export function ReadingMainPane({
  annotationResetKey,
  assetId,
  contentScale,
  focusedNoteId,
  nodeMode,
  onAnnotationDraft,
  onError,
  onMouseUp,
  onOutline,
  onPageCount,
  onScroll,
  payload,
  readerScrollRef,
  sectionRefs,
  selection,
  visibleRange,
}: ReadingMainPaneProps) {
  const scrollRef = useRef<HTMLElement | null>(null);

  return (
    <div className="relative min-h-0 overflow-hidden">
    <main
      className={`zenme-overlay-scroll-container size-full overflow-auto bg-zinc-100/70 ${
        nodeMode ? "px-5 py-6" : "px-10 py-8"
      }`}
      data-reader-scroll
      onMouseUp={onMouseUp}
      onScroll={onScroll}
      ref={(element) => {
        scrollRef.current = element;
        readerScrollRef.current = element;
      }}
    >
      {payload.asset.format === "pdf" ? (
        <PdfReadingView
          annotationResetKey={annotationResetKey}
          assetId={assetId}
          contentScale={contentScale}
          focusedNoteId={focusedNoteId}
          notes={payload.notes}
          onAnnotationDraft={onAnnotationDraft}
          onError={onError}
          onOutline={onOutline}
          onPageCount={onPageCount}
          pageRefs={sectionRefs}
        />
      ) : payload.asset.format === "epub" ? (
        <EpubPagedScrollView
          contentScale={contentScale}
          focusedNoteId={focusedNoteId}
          notes={payload.notes}
          pageRefs={sectionRefs}
          selectionPreview={selection}
          sections={payload.sections}
          visibleRange={visibleRange}
        />
      ) : (
        <ReadingTextSectionsView
          focusedNoteId={focusedNoteId}
          notes={payload.notes}
          sectionRefs={sectionRefs}
          selectionPreview={selection}
          sections={payload.sections}
        />
      )}
    </main>
      <OverlayScrollbars contentKey={assetId} scrollRef={scrollRef} />
    </div>
  );
}
