import { describe, expect, it } from "vitest";

import {
  normalizeProviderApiBaseUrl,
  normalizeProviderBaseUrl,
} from "./provider-url";

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

  it("normalizes the Volcengine Agent Plan console URL to its OpenAI v3 API", () => {
    expect(
      normalizeProviderApiBaseUrl(
        "https://ark.cn-beijing.volces.com/api/plan",
        "volcengine_agent_plan",
      ),
    ).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
    expect(
      normalizeProviderApiBaseUrl(
        "https://ark.cn-beijing.volces.com/api/plan/v3",
        "volcengine_agent_plan",
      ),
    ).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
  });

  it("keeps legacy OpenAI Agent Plan configurations compatible", () => {
    expect(
      normalizeProviderApiBaseUrl(
        "https://ark.cn-beijing.volces.com/api/plan",
        "openai",
      ),
    ).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
  });
});
