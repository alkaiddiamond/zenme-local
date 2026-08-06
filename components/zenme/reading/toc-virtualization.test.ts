import { describe, expect, it } from "vitest";

import {
  getCenteredReadingTocScrollTop,
  getReadingTocVisibleRange,
  READING_TOC_OVERSCAN,
  READING_TOC_ROW_HEIGHT,
} from "./toc-virtualization";

describe("reading table of contents virtualization", () => {
  it("renders only the visible rows plus a small overscan buffer", () => {
    expect(
      getReadingTocVisibleRange({
        clientHeight: READING_TOC_ROW_HEIGHT * 10,
        itemCount: 4_000,
        scrollTop: READING_TOC_ROW_HEIGHT * 1_000,
      }),
    ).toEqual([1_000 - READING_TOC_OVERSCAN, 1_010 + READING_TOC_OVERSCAN]);
  });

  it("centers the active row without reading its DOM geometry", () => {
    expect(
      getCenteredReadingTocScrollTop({
        clientHeight: 320,
        itemCount: 4_000,
        itemIndex: 2_000,
      }),
    ).toBe(2_000 * READING_TOC_ROW_HEIGHT - 144);
  });
});
