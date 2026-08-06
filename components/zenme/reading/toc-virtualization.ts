export const READING_TOC_ROW_HEIGHT = 32;
export const READING_TOC_OVERSCAN = 8;

export function getReadingTocVisibleRange(input: {
  clientHeight: number;
  itemCount: number;
  scrollTop: number;
}): [number, number] {
  if (input.itemCount <= 0) return [0, -1];

  const first = Math.max(
    0,
    Math.floor(input.scrollTop / READING_TOC_ROW_HEIGHT) -
      READING_TOC_OVERSCAN,
  );
  const last = Math.min(
    input.itemCount - 1,
    Math.ceil(
      (input.scrollTop + input.clientHeight) / READING_TOC_ROW_HEIGHT,
    ) + READING_TOC_OVERSCAN,
  );

  return [first, last];
}

export function getCenteredReadingTocScrollTop(input: {
  clientHeight: number;
  itemIndex: number;
  itemCount: number;
}) {
  const maxScrollTop = Math.max(
    0,
    input.itemCount * READING_TOC_ROW_HEIGHT - input.clientHeight,
  );
  const itemCenter =
    input.itemIndex * READING_TOC_ROW_HEIGHT + READING_TOC_ROW_HEIGHT / 2;
  return Math.min(
    maxScrollTop,
    Math.max(0, itemCenter - input.clientHeight / 2),
  );
}
