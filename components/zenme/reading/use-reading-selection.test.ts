import { describe, expect, it, vi } from "vitest";

import { clearNativeReadingSelection } from "./use-reading-selection";

describe("reading selection lifecycle", () => {
  it("clears the native range after capturing a stable paged selection", () => {
    const removeAllRanges = vi.fn();

    clearNativeReadingSelection({ removeAllRanges });
    clearNativeReadingSelection(null);

    expect(removeAllRanges).toHaveBeenCalledTimes(1);
  });
});
