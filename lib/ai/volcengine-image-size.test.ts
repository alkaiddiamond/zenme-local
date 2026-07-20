import { describe, expect, it } from "vitest";

import { getVolcengineSeedreamSize } from "./volcengine-image-size";

describe("Volcengine Seedream image size", () => {
  it("maps explicit aspect ratios to exact Seedream pixel dimensions", () => {
    expect(
      getVolcengineSeedreamSize({ aspectRatio: "3:4", quality: "1K" }),
    ).toBe("1728x2304");
    expect(
      getVolcengineSeedreamSize({ aspectRatio: "4:3", quality: "2K" }),
    ).toBe("2304x1728");
    expect(
      getVolcengineSeedreamSize({ aspectRatio: "9:16", quality: "4K" }),
    ).toBe("2304x4096");
  });

  it("lets Seedream choose the ratio only when auto is selected", () => {
    expect(
      getVolcengineSeedreamSize({ aspectRatio: "auto", quality: "1K" }),
    ).toBe("2K");
    expect(
      getVolcengineSeedreamSize({ aspectRatio: "auto", quality: "4K" }),
    ).toBe("3K");
  });

  it("normalizes unsupported values to the configured defaults", () => {
    expect(
      getVolcengineSeedreamSize({
        aspectRatio: "unsupported",
        quality: "unsupported",
      }),
    ).toBe("2848x1600");
  });
});
