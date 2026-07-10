import { describe, expect, it } from "vitest";

import {
  getScrollRatioFromElement,
  normalizeLoadedReadingProgress,
} from "./progress-state";

describe("reading progress state helpers", () => {
  it("computes a clamped scroll ratio from a scroll container", () => {
    expect(
      getScrollRatioFromElement({
        clientHeight: 200,
        scrollHeight: 1000,
        scrollTop: 400,
      }),
    ).toBe(0.5);
    expect(
      getScrollRatioFromElement({
        clientHeight: 200,
        scrollHeight: 1000,
        scrollTop: -40,
      }),
    ).toBe(0);
    expect(
      getScrollRatioFromElement({
        clientHeight: 200,
        scrollHeight: 1000,
        scrollTop: 1200,
      }),
    ).toBe(1);
  });

  it("returns zero when content is not scrollable", () => {
    expect(
      getScrollRatioFromElement({
        clientHeight: 400,
        scrollHeight: 300,
        scrollTop: 100,
      }),
    ).toBe(0);
  });

  it("normalizes loaded progress for UI state and cache writes", () => {
    expect(
      normalizeLoadedReadingProgress({
        assetId: "asset-1",
        contentScale: 1.26,
        sectionIndex: 3,
        scrollRatio: 1.5,
        updatedAt: "2026-06-28T01:00:00.000Z",
      }),
    ).toEqual({
      contentScale: 1.3,
      scrollRatio: 1,
      sectionIndex: 3,
    });
  });

  it("falls back for missing or invalid loaded progress", () => {
    expect(normalizeLoadedReadingProgress(null)).toEqual({
      contentScale: 1,
      scrollRatio: 0,
      sectionIndex: 0,
    });
    expect(
      normalizeLoadedReadingProgress({
        assetId: "asset-1",
        contentScale: 8,
        sectionIndex: Number.NaN,
        scrollRatio: -1,
        updatedAt: "2026-06-28T01:00:00.000Z",
      }),
    ).toEqual({
      contentScale: 1.8,
      scrollRatio: 0,
      sectionIndex: 0,
    });
  });
});
