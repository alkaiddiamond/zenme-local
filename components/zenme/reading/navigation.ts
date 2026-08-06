import type { ReadingFormat, ReadingSection } from "@/lib/reading/types";
import type { PdfOutlineSection } from "./types";

export type ReadingNavigationSection = {
  endIndex: number;
  index: number;
  pageNumber?: number;
  title: string;
};

export function findReadingNavigationIndex(
  sections: ReadingNavigationSection[],
  activeSection: number,
) {
  let low = 0;
  let high = sections.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const section = sections[middle];
    if (activeSection < section.index) {
      high = middle - 1;
    } else if (activeSection > section.endIndex) {
      low = middle + 1;
    } else {
      return middle;
    }
  }

  return -1;
}

export function isPagedReadingFormat(format: ReadingFormat) {
  return format === "epub" || format === "markdown" || format === "txt";
}

export function getReadingActiveTitle(input: {
  assetFormat: ReadingFormat;
  assetTitle: string;
  activeSection: number;
  pdfPageCount: number;
  sections: ReadingSection[];
}) {
  if (input.assetFormat === "pdf" || isPagedReadingFormat(input.assetFormat)) {
    const total =
      input.assetFormat === "pdf" ? input.pdfPageCount : input.sections.length;
    return total > 0
      ? `第 ${input.activeSection + 1} / ${total} 页`
      : input.assetTitle;
  }

  return input.sections[input.activeSection]?.title ?? input.assetTitle;
}

export function getReadingSectionTitle(input: {
  activeTitle: string;
  assetFormat: ReadingFormat;
  index: number;
  sections: ReadingSection[];
}) {
  if (input.assetFormat === "pdf") {
    return `第 ${input.index + 1} 页`;
  }

  return input.sections[input.index]?.title ?? input.activeTitle;
}

export function buildReadingNavigationSections(input: {
  assetFormat: ReadingFormat;
  pdfPageCount: number;
  pdfOutlineSections?: PdfOutlineSection[];
  sections: ReadingSection[];
}): ReadingNavigationSection[] {
  if (input.assetFormat === "pdf") {
    const count = Math.max(input.pdfPageCount, input.sections.length, 1);
    if (input.pdfOutlineSections?.length) {
      return input.pdfOutlineSections.map((section, index, sections) => ({
        endIndex: Math.max(
          section.index,
          (sections[index + 1]?.index ?? count) - 1,
        ),
        index: section.index,
        pageNumber: section.index + 1,
        title: section.title,
      }));
    }
    return Array.from({ length: count }, (_, index) => ({
      endIndex: index,
      index,
      pageNumber: index + 1,
      title: `第 ${index + 1} 页`,
    }));
  }

  if (isPagedReadingFormat(input.assetFormat)) {
    return buildPagedNavigationSections(input.sections);
  }

  return input.sections.map((section) => ({
    endIndex: section.index,
    index: section.index,
    title: section.title,
  }));
}

function buildPagedNavigationSections(
  sections: ReadingSection[],
): ReadingNavigationSection[] {
  const entries: ReadingNavigationSection[] = [];

  for (const section of sections) {
    const title = section.title.replace(/\s·\s\d+$/, "");
    const last = entries[entries.length - 1];
    if (last?.title === title) {
      last.endIndex = section.index;
    } else {
      entries.push({
        endIndex: section.index,
        index: section.index,
        title,
      });
    }
  }

  return entries;
}
