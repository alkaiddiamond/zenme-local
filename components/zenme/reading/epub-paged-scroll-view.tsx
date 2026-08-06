import { memo, useMemo } from "react";
import type { MutableRefObject } from "react";

import type { ReadingNote, ReadingSection } from "@/lib/reading/types";

import {
  EPUB_PAGE_GAP,
  EPUB_PAGE_HEIGHT,
  EPUB_PAGE_WIDTH,
  READING_PAGE_FOOTER_CLASSNAME,
  READING_PAGE_FRAME_PADDING,
  READING_PAGE_HEADER_WITH_TITLE_CLASSNAME,
} from "./constants";
import {
  getEpubPageSlotHeight,
  isChineseReadingText,
  renderHighlightedSectionHtml,
} from "./utils";
import type { TextSelection } from "./types";

type SelectionRect = TextSelection["rects"][number];

type EpubPagedScrollViewProps = {
  contentScale: number;
  focusedNoteId: string | null;
  notes: ReadingNote[];
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  selectionPreview: TextSelection | null;
  sections: ReadingSection[];
  visibleRange: [number, number];
};

export const EpubPagedScrollView = memo(function EpubPagedScrollView({
  contentScale,
  focusedNoteId,
  notes,
  pageRefs,
  selectionPreview,
  sections,
  visibleRange,
}: EpubPagedScrollViewProps) {
  const isChineseEpub = useMemo(
    () =>
      isChineseReadingText(
        sections
          .map((section) => section.text)
          .join("\n")
          .slice(0, 8000),
      ),
    [sections],
  );
  const pageSurfaceWidth = EPUB_PAGE_WIDTH * contentScale;
  const pageFrameWidth = pageSurfaceWidth + READING_PAGE_FRAME_PADDING * 2;
  const pageHeight = EPUB_PAGE_HEIGHT * contentScale;
  const pageSlotHeight = getEpubPageSlotHeight(contentScale);
  const horizontalPadding = 40 * contentScale;
  const verticalPadding = 20 * contentScale;
  const bodyFontSize = 16 * contentScale;
  const bodyLineHeight = 32 * contentScale;
  const firstVisibleIndex = Math.max(0, visibleRange[0]);
  const visibleSections = useMemo(
    () => sections.slice(firstVisibleIndex, visibleRange[1] + 1),
    [firstVisibleIndex, sections, visibleRange],
  );

  return (
    <div className="mx-auto" style={{ width: pageFrameWidth }}>
      <div
        className="relative"
        style={{
          height: sections.length * pageSlotHeight + EPUB_PAGE_GAP,
          width: pageFrameWidth,
        }}
      >
        {visibleSections.map((section, offset) => {
          const pageIndex = firstVisibleIndex + offset;
          return (
            <EpubPageSlot
              bodyFontSize={bodyFontSize}
              bodyLineHeight={bodyLineHeight}
              contentScale={contentScale}
              focusedNoteId={focusedNoteId}
              horizontalPadding={horizontalPadding}
              isChineseEpub={isChineseEpub}
              key={section.index}
              notes={notes}
              pageFrameWidth={pageFrameWidth}
              pageHeight={pageHeight}
              pageRefs={pageRefs}
              pageSlotHeight={pageSlotHeight}
              section={section}
              selectionRects={
                selectionPreview?.ranges.find(
                  (range) => range.sectionIndex === section.index,
                )?.rects ?? null
              }
              verticalPadding={verticalPadding}
              visibleIndex={pageIndex}
            />
          );
        })}
      </div>
    </div>
  );
});

type EpubPageSlotProps = {
  bodyFontSize: number;
  bodyLineHeight: number;
  contentScale: number;
  focusedNoteId: string | null;
  horizontalPadding: number;
  isChineseEpub: boolean;
  notes: ReadingNote[];
  pageFrameWidth: number;
  pageHeight: number;
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  pageSlotHeight: number;
  section: ReadingSection;
  selectionRects: SelectionRect[] | null;
  verticalPadding: number;
  visibleIndex: number;
};

const EpubPageSlot = memo(function EpubPageSlot({
  bodyFontSize,
  bodyLineHeight,
  contentScale,
  focusedNoteId,
  horizontalPadding,
  isChineseEpub,
  notes,
  pageFrameWidth,
  pageHeight,
  pageRefs,
  pageSlotHeight,
  section,
  selectionRects,
  verticalPadding,
  visibleIndex,
}: EpubPageSlotProps) {
  const pageHtml = useMemo(
    () => renderHighlightedSectionHtml(section, notes, focusedNoteId),
    [focusedNoteId, notes, section],
  );
  const pageTitle = section.title.replace(/\s·\s\d+$/, "");

  return (
    <div
      className="absolute left-0"
      style={{
        top: visibleIndex * pageSlotHeight,
        width: pageFrameWidth,
      }}
    >
      <section
        className="relative flex flex-col overflow-hidden rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm"
        data-reading-section-index={section.index}
        ref={(node) => {
          pageRefs.current[section.index] = node;
        }}
        style={{
          height: pageHeight,
          padding: READING_PAGE_FRAME_PADDING,
          width: pageFrameWidth,
        }}
      >
        <div className={READING_PAGE_HEADER_WITH_TITLE_CLASSNAME}>
          <span className="min-w-0 truncate">{pageTitle}</span>
        </div>
        <div
          className={`reading-prose reading-prose-epub min-h-0 flex-1 overflow-hidden text-zinc-800 ${
            isChineseEpub ? "reading-prose-cjk" : ""
          }`}
          dangerouslySetInnerHTML={{
            __html: pageHtml,
          }}
          style={{
            fontSize: bodyFontSize,
            lineHeight: `${bodyLineHeight}px`,
            padding: `${verticalPadding}px ${horizontalPadding}px 0`,
          }}
        />
        <div
          className={`${READING_PAGE_FOOTER_CLASSNAME} justify-center`}
          style={{
            fontSize: 11 * contentScale,
            marginTop: 16 * contentScale,
            paddingTop: 12 * contentScale,
          }}
        >
          <span className="whitespace-nowrap">第 {section.index + 1} 页</span>
        </div>
        <EpubSelectionOverlay
          rects={selectionRects}
          sectionIndex={section.index}
        />
      </section>
    </div>
  );
});

const EpubSelectionOverlay = memo(function EpubSelectionOverlay({
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
