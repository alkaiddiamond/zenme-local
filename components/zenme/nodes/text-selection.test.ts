import { describe, expect, it } from "vitest";

import { getWordSelectionOffsets } from "./text-selection";

describe("getWordSelectionOffsets", () => {
  it("selects only the double-clicked word", () => {
    const text = "Lo-fi dream pop";
    const offsets = getWordSelectionOffsets(text, 8);

    expect(text.slice(offsets.start, offsets.end)).toBe("dream");
  });

  it("supports Chinese text and a caret at the end of a word", () => {
    const text = "继续生成 内容";
    const offsets = getWordSelectionOffsets(text, 4);

    expect(text.slice(offsets.start, offsets.end)).toBe("继续生成");
  });

  it("returns a collapsed range when whitespace is clicked", () => {
    expect(getWordSelectionOffsets("word, next", 5)).toEqual({
      end: 5,
      start: 5,
    });
  });
});
