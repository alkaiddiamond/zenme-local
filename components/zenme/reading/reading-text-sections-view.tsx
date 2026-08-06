import { memo, useMemo } from "react";
import type { RefObject } from "react";

import type { ReadingNote, ReadingSection } from "@/lib/reading/types";

import {
  indexReadingNotesBySection,
  renderHighlightedSectionHtml,
} from "./utils";
import type { TextSelection } from "./types";

type SelectionRect = TextSelection["rects"][number];
const EMPTY_READING_NOTES: ReadingNote[] = [];

type ReadingTextSectionsViewProps = {
  focusedNoteId: string | null;
  notes: ReadingNote[];
  selectionPreview: TextSelection | null;
  sectionRefs: RefObject<Record<number, HTMLElement | null>>;
  sections: ReadingSection[];
};

export const ReadingTextSectionsView = memo(function ReadingTextSectionsView({
  focusedNoteId,
  notes,
  selectionPreview,
  sectionRefs,
  sections,
}: ReadingTextSectionsViewProps) {
  const notesBySection = useMemo(
    () => indexReadingNotesBySection(notes),
    [notes],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {sections.map((section) => (
        <ReadingTextSectionCard
          focusedNoteId={focusedNoteId}
          key={section.index}
          notes={notesBySection.get(section.index) ?? EMPTY_READING_NOTES}
          section={section}
          sectionRefs={sectionRefs}
          selectionRects={
            selectionPreview?.ranges.find(
              (range) => range.sectionIndex === section.index,
            )?.rects ?? null
          }
        />
      ))}
    </div>
  );
});

type ReadingTextSectionCardProps = {
  focusedNoteId: string | null;
  notes: ReadingNote[];
  section: ReadingSection;
  sectionRefs: RefObject<Record<number, HTMLElement | null>>;
  selectionRects: SelectionRect[] | null;
};

const ReadingTextSectionCard = memo(function ReadingTextSectionCard({
  focusedNoteId,
  notes,
  section,
  sectionRefs,
  selectionRects,
}: ReadingTextSectionCardProps) {
  const sectionHtml = useMemo(
    () => renderHighlightedSectionHtml(section, notes, focusedNoteId),
    [focusedNoteId, notes, section],
  );

  return (
    <section
      className="relative rounded-md border border-zinc-200 bg-white px-10 py-9 text-zinc-950 shadow-sm"
      data-reading-section-index={section.index}
      ref={(node) => {
        sectionRefs.current[section.index] = node;
      }}
    >
      <h2 className="mb-6 text-center text-xl font-semibold tracking-normal">
        {section.title}
      </h2>
      <div
        className="reading-prose text-base leading-8 text-zinc-800"
        dangerouslySetInnerHTML={{
          __html: sectionHtml,
        }}
      />
      <ReadingSelectionOverlay
        rects={selectionRects}
        sectionIndex={section.index}
      />
    </section>
  );
});

const ReadingSelectionOverlay = memo(function ReadingSelectionOverlay({
  rects,
  sectionIndex,
}: {
  rects: SelectionRect[] | null;
  sectionIndex: number;
}) {
  if (!rects) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      {rects.map((rect, rectIndex) => (
        <div
          className="absolute rounded-[1px] bg-zinc-950/20"
          key={`${sectionIndex}-selection-${rectIndex}`}
          style={{
            height: `${rect.h * 100}%`,
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
          }}
        />
      ))}
    </div>
  );
});
