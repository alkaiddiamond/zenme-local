import { EPUB_VIRTUAL_BUFFER } from "./constants";
import { getEpubPageSlotHeight } from "./utils";

export function getEpubVisibleRange(input: {
  clientHeight: number;
  contentScale: number;
  pageCount: number;
  scrollTop: number;
}): [number, number] {
  const pageSlotHeight = getEpubPageSlotHeight(input.contentScale);
  const first = Math.max(
    0,
    Math.floor(input.scrollTop / pageSlotHeight) - EPUB_VIRTUAL_BUFFER,
  );
  const last = Math.min(
    input.pageCount - 1,
    Math.floor((input.scrollTop + input.clientHeight) / pageSlotHeight) +
      EPUB_VIRTUAL_BUFFER,
  );

  return [first, last];
}

export function getClosestEpubSectionIndex(input: {
  clientHeight: number;
  contentScale: number;
  pageCount: number;
  scrollTop: number;
}) {
  const pageSlotHeight = getEpubPageSlotHeight(input.contentScale);
  return Math.min(
    input.pageCount - 1,
    Math.max(
      0,
      Math.floor((input.scrollTop + input.clientHeight / 2) / pageSlotHeight),
    ),
  );
}
