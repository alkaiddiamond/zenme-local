import { Loader2 } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";

import type { ReadingNote } from "@/lib/reading/types";

import { PdfPageView } from "./pdf-page-view";
import { resolvePdfOutlineSections } from "./pdf-outline";
import type {
  PdfAnnotationDraft,
  PdfDocumentProxyLike,
  PdfOutlineSection,
} from "./types";

type PdfReadingViewProps = {
  annotationResetKey: number;
  assetId: string;
  contentScale: number;
  focusedNoteId: string | null;
  notes: ReadingNote[];
  onAnnotationDraft: (draft: PdfAnnotationDraft | null) => void;
  onError: (message: string | null) => void;
  onOutline: (sections: PdfOutlineSection[]) => void;
  onPageCount: (count: number) => void;
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>;
};

const EMPTY_PAGE_NOTES: ReadingNote[] = [];

export const PdfReadingView = memo(function PdfReadingView({
  annotationResetKey,
  assetId,
  contentScale,
  focusedNoteId,
  notes,
  onAnnotationDraft,
  onError,
  onOutline,
  onPageCount,
  pageRefs,
}: PdfReadingViewProps) {
  const [pdf, setPdf] = useState<PdfDocumentProxyLike | null>(null);
  const [pageAspectRatio, setPageAspectRatio] = useState<number | null>(null);
  const notesByPage = useMemo(() => {
    const next = new Map<number, ReadingNote[]>();
    for (const note of notes) {
      if (!note.rect) continue;
      const pageNotes = next.get(note.sectionIndex) ?? [];
      pageNotes.push(note);
      next.set(note.sectionIndex, pageNotes);
    }
    return next;
  }, [notes]);

  useEffect(() => {
    let cancelled = false;
    let loadedPdf: PdfDocumentProxyLike | null = null;

    async function loadPdf() {
      try {
        onOutline([]);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const documentTask = pdfjs.getDocument({
          url: `/api/reading/assets/${assetId}/file`,
          wasmUrl: "/pdfjs/wasm/",
        });
        loadedPdf =
          (await documentTask.promise) as unknown as PdfDocumentProxyLike;
        if (cancelled) {
          await loadedPdf.destroy?.();
          return;
        }
        const firstPage = await loadedPdf.getPage(1);
        if (cancelled) {
          return;
        }
        const firstViewport = firstPage.getViewport({ scale: 1 });
        const nextAspectRatio =
          firstViewport.width > 0
            ? firstViewport.height / firstViewport.width
            : null;
        setPageAspectRatio(nextAspectRatio);
        setPdf(loadedPdf);
        onPageCount(loadedPdf.numPages);
        const outline = await resolvePdfOutlineSections(loadedPdf).catch(
          () => [],
        );
        if (!cancelled) {
          onOutline(outline);
        }
      } catch (err) {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "PDF 阅读器加载失败");
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
      void loadedPdf?.destroy?.();
    };
  }, [assetId, onError, onOutline, onPageCount]);

  if (!pdf) {
    return (
      <div className="flex min-h-[520px] items-center justify-center gap-2 text-sm text-zinc-500">
        <Loader2 className="size-4 animate-spin" />
        正在渲染 PDF
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPageView
          key={index}
          annotationResetKey={annotationResetKey}
          contentScale={contentScale}
          fallbackAspectRatio={pageAspectRatio}
          focusedNoteId={focusedNoteId}
          notes={notesByPage.get(index) ?? EMPTY_PAGE_NOTES}
          onAnnotationDraft={onAnnotationDraft}
          pageIndex={index}
          pageNumber={index + 1}
          pageRefs={pageRefs}
          pdf={pdf}
        />
      ))}
    </div>
  );
});
