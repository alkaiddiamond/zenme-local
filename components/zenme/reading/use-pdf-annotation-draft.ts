import { useCallback, useEffect, useRef, useState } from "react";

import { recognizePdfAnnotationDraft } from "./api";
import type { PdfAnnotationDraft } from "./types";

export function usePdfAnnotationDraft(input: {
  onOcrError?: (error: string) => void;
} = {}) {
  const { onOcrError } = input;
  const [pdfAnnotationDraft, setPdfAnnotationDraft] =
    useState<PdfAnnotationDraft | null>(null);
  const [pdfAnnotationResetKey, setPdfAnnotationResetKey] = useState(0);
  const [isPdfOcrRecognizing, setIsPdfOcrRecognizing] = useState(false);
  const [pdfOcrError, setPdfOcrError] = useState<string | null>(null);
  const pdfOcrRequestId = useRef(0);

  useEffect(() => {
    if (
      !pdfAnnotationDraft ||
      pdfAnnotationDraft.kind !== "region" ||
      pdfAnnotationDraft.ocrFailed ||
      pdfAnnotationDraft.selectedText ||
      !pdfAnnotationDraft.imageDataUrl
    ) {
      setIsPdfOcrRecognizing(false);
      return;
    }

    const requestId = ++pdfOcrRequestId.current;
    const controller = new AbortController();
    setIsPdfOcrRecognizing(true);
    setPdfOcrError(null);

    recognizePdfAnnotationDraft({
      draft: pdfAnnotationDraft,
      signal: controller.signal,
    })
      .then((text) => {
        if (pdfOcrRequestId.current !== requestId) return;
        setPdfAnnotationDraft((current) => {
          if (
            !current ||
            current.kind !== "region" ||
            current.imageDataUrl !== pdfAnnotationDraft.imageDataUrl
          ) {
            return current;
          }
          return text
            ? {
                ...current,
                selectedText: text,
              }
            : {
                ...current,
                ocrFailed: true,
              };
        });
      })
      .catch((err) => {
        if (pdfOcrRequestId.current !== requestId) return;
        const message = err instanceof Error ? err.message : "OCR 识别失败";
        setPdfOcrError(message);
        onOcrError?.(message);
        setPdfAnnotationDraft((current) => {
          if (
            !current ||
            current.kind !== "region" ||
            current.imageDataUrl !== pdfAnnotationDraft.imageDataUrl
          ) {
            return current;
          }
          return {
            ...current,
            ocrFailed: true,
          };
        });
      })
      .finally(() => {
        if (pdfOcrRequestId.current === requestId) {
          setIsPdfOcrRecognizing(false);
        }
      });

    return () => {
      if (pdfOcrRequestId.current === requestId) {
        pdfOcrRequestId.current += 1;
      }
      controller.abort();
    };
  }, [onOcrError, pdfAnnotationDraft]);

  const resetPdfAnnotationDraft = useCallback(() => {
    pdfOcrRequestId.current += 1;
    setPdfAnnotationDraft(null);
    setPdfAnnotationResetKey((key) => key + 1);
    setIsPdfOcrRecognizing(false);
    setPdfOcrError(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  const isPdfOcrPending = Boolean(
    pdfAnnotationDraft?.kind === "region" &&
      pdfAnnotationDraft.imageDataUrl &&
      !pdfAnnotationDraft.ocrFailed &&
      !pdfAnnotationDraft.selectedText?.trim(),
  );
  const isPdfOcrBusy = isPdfOcrRecognizing || isPdfOcrPending;
  const canSavePdfAnnotation = Boolean(
    pdfAnnotationDraft &&
      (pdfAnnotationDraft.kind !== "region" ||
        !pdfAnnotationDraft.imageDataUrl ||
        pdfAnnotationDraft.selectedText?.trim()),
  );

  return {
    canSavePdfAnnotation,
    isPdfOcrBusy,
    isPdfOcrRecognizing,
    pdfAnnotationDraft,
    pdfAnnotationResetKey,
    pdfOcrError,
    resetPdfAnnotationDraft,
    setPdfAnnotationDraft,
    setPdfAnnotationResetKey,
  };
}
