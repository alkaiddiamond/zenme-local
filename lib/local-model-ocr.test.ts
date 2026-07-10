import { describe, expect, it } from "vitest";

import { shouldLogLocalModelOcrProgress } from "./local-model-ocr";

describe("local model OCR logging", () => {
  it("keeps progress logging disabled by default outside production", () => {
    expect(shouldLogLocalModelOcrProgress({ NODE_ENV: "development" })).toBe(
      false,
    );
  });

  it("enables progress logging only with the explicit debug flag", () => {
    expect(
      shouldLogLocalModelOcrProgress({
        LOCAL_MODEL_OCR_DEBUG: "1",
        NODE_ENV: "development",
      }),
    ).toBe(true);
  });

  it("does not log progress in production even with the debug flag", () => {
    expect(
      shouldLogLocalModelOcrProgress({
        LOCAL_MODEL_OCR_DEBUG: "1",
        NODE_ENV: "production",
      }),
    ).toBe(false);
  });
});
