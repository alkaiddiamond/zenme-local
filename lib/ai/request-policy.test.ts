import { describe, expect, it } from "vitest";

import {
  getAllowedAiModels,
  resolveAiModel,
  validateChatBody,
} from "./request-policy";

describe("AI request policy", () => {
  it("exposes the server-side model allowlist", () => {
    expect(getAllowedAiModels()).toContain("glm-4-flash");
  });

  it("resolves unsupported models to the safe default", () => {
    expect(resolveAiModel("not-a-real-model")).toBe("glm-4.5");
    expect(resolveAiModel("not-a-real-model", ["custom-model"])).toBe(
      "custom-model",
    );
    expect(resolveAiModel("glm-4.5")).toBe("glm-4.5");
  });

  it("rejects unsupported requested models", () => {
    expect(
      validateChatBody({
        model: "not-a-real-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toBe("不支持的模型");
  });

  it("rejects oversized chat requests", () => {
    expect(
      validateChatBody({
        messages: Array.from({ length: 25 }, () => ({
          role: "user" as const,
          content: "hello",
        })),
      }),
    ).toBe("单次对话最多支持 24 条消息");

    expect(
      validateChatBody({
        context: "x".repeat(24_001),
        messages: [{ role: "user", content: "hello" }],
      }),
    ).toBe("画布上下文过长，请减少选中内容后重试");

    expect(
      validateChatBody({
        messages: [{ role: "user", content: "x".repeat(8_001) }],
      }),
    ).toBe("单条消息过长，请缩短后重试");
  });
});
