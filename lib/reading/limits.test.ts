import { describe, expect, it } from "vitest";

import {
  READING_ASSET_FORMDATA_MAX_BYTES,
  READING_ASSET_MAX_BYTES,
  formatReadingAssetSize,
  getReadingAssetSizeError,
  shouldUseBinaryReadingAssetUpload,
} from "./limits";

describe("reading upload limits", () => {
  it("formats upload sizes for user-facing errors", () => {
    expect(formatReadingAssetSize(512)).toBe("512B");
    expect(formatReadingAssetSize(2 * 1024)).toBe("2KB");
    expect(formatReadingAssetSize(50 * 1024 * 1024)).toBe("50MB");
  });

  it("allows files at the storage bucket limit", () => {
    expect(getReadingAssetSizeError(READING_ASSET_MAX_BYTES)).toBeNull();
  });

  it("rejects files above the storage bucket limit", () => {
    expect(getReadingAssetSizeError(READING_ASSET_MAX_BYTES + 1)).toBe(
      "阅读资料不能超过 50MB",
    );
  });

  it("uses binary upload only above the FormData threshold", () => {
    expect(
      shouldUseBinaryReadingAssetUpload(READING_ASSET_FORMDATA_MAX_BYTES),
    ).toBe(false);
    expect(
      shouldUseBinaryReadingAssetUpload(READING_ASSET_FORMDATA_MAX_BYTES + 1),
    ).toBe(true);
  });
});
