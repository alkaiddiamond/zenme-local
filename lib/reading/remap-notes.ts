import type { ReadingNote, ReadingSection, ReadingTextRange } from "./types";

type TextPosition = {
  offset: number;
  sectionIndex: number;
};

export function remapReadingNotesToSections(
  notes: ReadingNote[],
  previousSections: ReadingSection[],
  nextSections: ReadingSection[],
) {
  const corpus = buildSearchCorpus(nextSections);
  return notes.map((note) => {
    if (note.type === "region" || !note.selectedText.trim()) return note;
    const needle = normalizeSearchText(note.selectedText);
    if (!needle) return note;

    const matchStarts = findAllMatches(corpus.text, needle);
    if (!matchStarts.length) return note;
    const previousRatio =
      note.sectionIndex / Math.max(1, previousSections.length - 1);
    const matchStart = matchStarts.reduce((closest, candidate) => {
      const candidatePosition = corpus.positions[candidate];
      const closestPosition = corpus.positions[closest];
      const candidateRatio =
        candidatePosition.sectionIndex / Math.max(1, nextSections.length - 1);
      const closestRatio =
        closestPosition.sectionIndex / Math.max(1, nextSections.length - 1);
      return Math.abs(candidateRatio - previousRatio) <
        Math.abs(closestRatio - previousRatio)
        ? candidate
        : closest;
    });
    const positions = corpus.positions.slice(
      matchStart,
      matchStart + needle.length,
    );
    const ranges = positionsToRanges(positions);
    const firstRange = ranges[0];
    if (!firstRange) return note;

    return {
      ...note,
      chapterTitle:
        nextSections[firstRange.sectionIndex]?.title ?? note.chapterTitle,
      length: firstRange.length,
      offset: firstRange.offset,
      ranges,
      sectionIndex: firstRange.sectionIndex,
    };
  });
}

function buildSearchCorpus(sections: ReadingSection[]) {
  let text = "";
  const positions: TextPosition[] = [];

  for (const section of sections) {
    let pendingSpace =
      text.length > 0 &&
      !text.endsWith(" ") &&
      !/^\s*<p\b[^>]*\breading-paragraph-continuation\b/i.test(section.html);
    for (let offset = 0; offset < section.text.length; offset += 1) {
      const character = section.text[offset];
      if (/\s/.test(character)) {
        pendingSpace = text.length > 0 && !text.endsWith(" ");
        continue;
      }
      if (pendingSpace) {
        text += " ";
        positions.push({ offset, sectionIndex: section.index });
        pendingSpace = false;
      }
      text += character;
      positions.push({ offset, sectionIndex: section.index });
    }
  }

  return { positions, text };
}

function normalizeSearchText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function findAllMatches(text: string, needle: string) {
  const matches: number[] = [];
  let offset = 0;
  while (offset <= text.length - needle.length) {
    const match = text.indexOf(needle, offset);
    if (match < 0) break;
    matches.push(match);
    offset = match + 1;
  }
  return matches;
}

function positionsToRanges(positions: TextPosition[]) {
  const ranges: ReadingTextRange[] = [];
  for (const position of positions) {
    const current = ranges.at(-1);
    if (!current || current.sectionIndex !== position.sectionIndex) {
      ranges.push({
        length: 1,
        offset: position.offset,
        sectionIndex: position.sectionIndex,
      });
      continue;
    }
    current.length = Math.max(
      current.length,
      position.offset - current.offset + 1,
    );
  }
  return ranges;
}
