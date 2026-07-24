const WORD_CHARACTER_PATTERN = /[\p{L}\p{N}_-]/u;

export function getWordSelectionOffsets(text: string, rawOffset: number) {
  if (!text) {
    return { end: 0, start: 0 };
  }

  const offset = Math.max(0, Math.min(rawOffset, text.length));
  let index = offset === text.length ? text.length - 1 : offset;

  if (
    !WORD_CHARACTER_PATTERN.test(text[index] ?? "") &&
    index > 0 &&
    WORD_CHARACTER_PATTERN.test(text[index - 1] ?? "")
  ) {
    index -= 1;
  }

  if (!WORD_CHARACTER_PATTERN.test(text[index] ?? "")) {
    return { end: offset, start: offset };
  }

  let start = index;
  let end = index + 1;
  while (start > 0 && WORD_CHARACTER_PATTERN.test(text[start - 1])) {
    start -= 1;
  }
  while (end < text.length && WORD_CHARACTER_PATTERN.test(text[end])) {
    end += 1;
  }

  return { end, start };
}
