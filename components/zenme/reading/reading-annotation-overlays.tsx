"use client";

import type { ReadingAnnotationColor } from "@/lib/reading/types";

import { ReadingAnnotationPalette } from "./reading-annotation-palette";
import type { PdfAnnotationDraft, TextSelection } from "./types";

type ReadingAnnotationOverlaysProps = {
  canSavePdfAnnotation: boolean;
  isSavingNote: boolean;
  onClearSelection: () => void;
  onCreateNote: (color: ReadingAnnotationColor) => void;
  onCreatePdfAnnotationNote: (color: ReadingAnnotationColor) => void;
  onResetPdfAnnotationDraft: () => void;
  pdfAnnotationDraft: PdfAnnotationDraft | null;
  selectedColor: ReadingAnnotationColor;
  selection: TextSelection | null;
  setSelectedColor: (color: ReadingAnnotationColor) => void;
};

export function ReadingAnnotationOverlays({
  canSavePdfAnnotation,
  isSavingNote,
  onClearSelection,
  onCreateNote,
  onCreatePdfAnnotationNote,
  onResetPdfAnnotationDraft,
  pdfAnnotationDraft,
  selectedColor,
  selection,
  setSelectedColor,
}: ReadingAnnotationOverlaysProps) {
  return (
    <>
      {selection ? (
        <ReadingAnnotationPalette
          disabled={isSavingNote}
          labelSuffix="高亮"
          onClose={onClearSelection}
          onSelectColor={(color) => {
            setSelectedColor(color);
            onCreateNote(color);
          }}
          selectedColor={selectedColor}
          x={selection.x}
          y={selection.y}
        />
      ) : null}

      {pdfAnnotationDraft ? (
        <ReadingAnnotationPalette
          disabled={isSavingNote || !canSavePdfAnnotation}
          labelSuffix="区域标注"
          onClose={onResetPdfAnnotationDraft}
          onSelectColor={(color) => {
            setSelectedColor(color);
            onCreatePdfAnnotationNote(color);
          }}
          selectedColor={selectedColor}
          x={pdfAnnotationDraft.x}
          y={pdfAnnotationDraft.y}
        />
      ) : null}
    </>
  );
}
