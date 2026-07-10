import type { PointerEvent as ReactPointerEvent } from "react";

import type { ReadingNote } from "@/lib/reading/types";

import { HIGHLIGHT_STYLES } from "./constants";
import type { PdfAnnotationDraft } from "./types";

type PdfPageOverlaysProps = {
  draftRect: PdfAnnotationDraft["rect"] | null;
  focusedNoteId: string | null;
  hasSelectableText: boolean | null;
  notes: ReadingNote[];
  onPointerCancel: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  pageIndex: number;
  textSelectionPreviewRects: NonNullable<PdfAnnotationDraft["rects"]> | null;
};

export function PdfPageOverlays({
  draftRect,
  focusedNoteId,
  hasSelectableText,
  notes,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  pageIndex,
  textSelectionPreviewRects,
}: PdfPageOverlaysProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-0">
        {textSelectionPreviewRects?.map((rect, index) => (
          <div
            className="absolute rounded-[1px] bg-zinc-950/20"
            data-pdf-selection-preview={pageIndex}
            key={`${pageIndex}-selection-${index}`}
            style={{
              height: `${rect.h * 100}%`,
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
            }}
          />
        ))}
        {notes.map((note) =>
          note.rect ? (
            <div
              className={`absolute rounded-sm border ${
                focusedNoteId === note.id ? "zenme-note-focus-ring" : ""
              }`}
              data-pdf-annotation-note={note.id}
              data-pdf-region-note={note.id}
              key={note.id}
              style={{
                background: HIGHLIGHT_STYLES[note.color],
                borderColor: HIGHLIGHT_STYLES[note.color],
                height: `${note.rect.h * 100}%`,
                left: `${note.rect.x * 100}%`,
                top: `${note.rect.y * 100}%`,
                width: `${note.rect.w * 100}%`,
              }}
            />
          ) : null,
        )}
      </div>
      <div
        className={`absolute inset-0 ${
          hasSelectableText === false ? "cursor-crosshair" : "pointer-events-none"
        }`}
        data-pdf-page-overlay={pageIndex}
        onPointerCancel={onPointerCancel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {hasSelectableText === false && draftRect ? (
          <div
            className="absolute cursor-move rounded-sm border border-zinc-500 bg-zinc-950/15"
            data-pdf-draft-region="move"
            style={{
              height: `${draftRect.h * 100}%`,
              left: `${draftRect.x * 100}%`,
              top: `${draftRect.y * 100}%`,
              width: `${draftRect.w * 100}%`,
            }}
          >
            {[
              ["nw", "-left-1.5 -top-1.5 cursor-nwse-resize"],
              ["n", "left-1/2 -top-1.5 -translate-x-1/2 cursor-ns-resize"],
              ["ne", "-right-1.5 -top-1.5 cursor-nesw-resize"],
              ["e", "-right-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize"],
              ["se", "-bottom-1.5 -right-1.5 cursor-nwse-resize"],
              ["s", "-bottom-1.5 left-1/2 -translate-x-1/2 cursor-ns-resize"],
              ["sw", "-bottom-1.5 -left-1.5 cursor-nesw-resize"],
              ["w", "-left-1.5 top-1/2 -translate-y-1/2 cursor-ew-resize"],
            ].map(([edge, className]) => (
              <span
                className={`absolute size-3 rounded-full border border-zinc-500 bg-white shadow-sm ${className}`}
                data-pdf-draft-region={edge}
                key={edge}
              />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
