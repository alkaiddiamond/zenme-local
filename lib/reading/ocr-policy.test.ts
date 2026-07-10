import { describe, expect, it } from "vitest";

import {
  getAllowedOcrProviders,
  getDefaultOcrProvider,
  resolveOcrProvider,
} from "./ocr-policy";

describe("OCR provider policy", () => {
  it("uses the configured default provider when valid", () => {
    expect(getDefaultOcrProvider({ READING_OCR_PROVIDER: "tencent" })).toBe(
      "tencent",
    );
    expect(getDefaultOcrProvider({ READING_OCR_PROVIDER: "local-model" })).toBe(
      "local-model",
    );
  });

  it("falls back to Tencent when credentials exist and no provider is configured", () => {
    expect(
      getDefaultOcrProvider({
        TENCENT_CLOUD_SECRET_ID: "id",
        TENCENT_CLOUD_SECRET_KEY: "key",
      }),
    ).toBe("tencent");
  });

  it("parses the allowlist and ignores unknown providers", () => {
    expect(
      getAllowedOcrProviders({
        READING_OCR_ALLOWED_PROVIDERS: "local-model, tencent, other",
      }),
    ).toEqual(["local-model", "tencent"]);
  });

  it("rejects providers outside the allowlist", () => {
    expect(
      resolveOcrProvider({
        env: { READING_OCR_ALLOWED_PROVIDERS: "local-model" },
        requestedProvider: "tencent",
      }),
    ).toEqual({ error: "不支持的 OCR 服务", provider: null });
  });
});
