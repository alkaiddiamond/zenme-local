import { describe, expect, it } from "vitest";

import { normalizeProviderBaseUrl } from "./provider-url";

describe("normalizeProviderBaseUrl", () => {
  it("normalizes HTTP and HTTPS provider addresses", () => {
    expect(normalizeProviderBaseUrl(" https://example.com/api/v1/ ")).toBe(
      "https://example.com/api/v1",
    );
    expect(normalizeProviderBaseUrl("http://127.0.0.1:11434/v1")).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });

  it("rejects unsupported protocols and embedded credentials", () => {
    expect(() => normalizeProviderBaseUrl("file:///tmp/models")).toThrow(
      "只支持 HTTP 或 HTTPS",
    );
    expect(() => normalizeProviderBaseUrl("https://user:pass@example.com/v1")).toThrow(
      "不能包含登录凭据",
    );
  });

  it("rejects query strings and fragments", () => {
    expect(() => normalizeProviderBaseUrl("https://example.com/v1?token=x")).toThrow(
      "不能包含查询参数或片段",
    );
  });
});
