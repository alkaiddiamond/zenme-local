import { describe, expect, it } from "vitest";

import {
  estimateTextTokenCount,
  getCanvasContextTokenBudget,
  truncateTextToTokenBudget,
} from "./context-budget";

describe("model context budget", () => {
  it("uses the configured model window instead of a fixed character cap", () => {
    expect(getCanvasContextTokenBudget({ contextWindow: 200_000 })).toBeGreaterThan(
      getCanvasContextTokenBudget({ contextWindow: 128_000 }),
    );
  });

  it("estimates CJK and ASCII text without treating characters as tokens equally", () => {
    expect(estimateTextTokenCount("中文内容")).toBe(4);
    expect(estimateTextTokenCount("abcdefghijklmn")).toBe(4);
  });

  it("truncates to a token budget and preserves an omission marker", () => {
    const result = truncateTextToTokenBudget(
      "正文".repeat(100),
      30,
      "\n[已省略]",
    );

    expect(estimateTextTokenCount(result)).toBeLessThanOrEqual(30);
    expect(result).toContain("[已省略]");
  });
});
