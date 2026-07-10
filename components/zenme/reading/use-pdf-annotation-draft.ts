import { useCallback, useEffect, useRef, useState } from "react";

import { recognizePdfAnnotationDraft } from "./api";
import type { PdfAnnotationDraft } from "./types";

export function usePdfAnnotationDraft(input: {
  setError: (error: string | null) => void;
}) {
  const { setError } = input;
  const [pdfAnnotationDraft, setPdfAnnotationDraft] =
    useState<PdfAnnotationDraft | null>(null);
  const [pdfAnnotationResetKey, setPdfAnnotationResetKey] = useState(0);
  const [isPdfOcrRecognizing, setIsPdfOcrRecognizing] = useState(false);
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
    setIsPdfOcrRecognizing(true);
    setError(null);

    recognizePdfAnnotationDraft({ draft: pdfAnnotationDraft })
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
        setError(err instanceof Error ? err.message : "OCR 识别失败");
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
  }, [pdfAnnotationDraft, setError]);

  const resetPdfAnnotationDraft = useCallback(() => {
    pdfOcrRequestId.current += 1;
    setPdfAnnotationDraft(null);
    setPdfAnnotationResetKey((key) => key + 1);
    setIsPdfOcrRecognizing(false);
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
    resetPdfAnnotationDraft,
    setPdfAnnotationDraft,
    setPdfAnnotationResetKey,
  };
}
