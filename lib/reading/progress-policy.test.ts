import { describe, expect, it } from "vitest";

import {
  normalizeReadingContentScale,
  normalizeReadingScrollRatio,
  normalizeReadingSectionIndex,
} from "./progress-policy";

describe("reading progress policy", () => {
  it("normalizes content scale to the supported reader range", () => {
    expect(normalizeReadingContentScale(1.26)).toBe(1.3);
    expect(normalizeReadingContentScale(0.1)).toBe(0.8);
    expect(normalizeReadingContentScale(8)).toBe(1.8);
    expect(normalizeReadingContentScale(Number.NaN)).toBe(0.8);
  });

  it("normalizes scroll ratio and section index values", () => {
    expect(normalizeReadingScrollRatio(-1)).toBe(0);
    expect(normalizeReadingScrollRatio(1.2)).toBe(1);
    expect(normalizeReadingScrollRatio(0.42)).toBe(0.42);
    expect(normalizeReadingSectionIndex(-2)).toBe(0);
    expect(normalizeReadingSectionIndex(3.9)).toBe(3);
    expect(normalizeReadingSectionIndex(Number.NaN)).toBe(0);
  });
});
