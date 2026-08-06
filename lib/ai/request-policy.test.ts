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

  it("rejects excessive message counts and only applies a transport safety cap", () => {
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
    ).toBeNull();

    expect(
      validateChatBody({
        messages: [{ role: "user", content: "x".repeat(2_000_001) }],
      }),
    ).toBe("请求文本数据过大，请减少内容后重试");
  });

  it("accepts image data URLs and rejects invalid multimodal input", () => {
    expect(validateChatBody({
      imageDataUrls: ["data:image/png;base64,aW1hZ2U="],
      messages: [{ role: "user", content: "识别图片" }],
    })).toBeNull();

    expect(validateChatBody({
      imageDataUrls: ["https://example.com/image.png"],
      messages: [{ role: "user", content: "识别图片" }],
    })).toBe("图片输入格式不正确或图片过大");

    expect(validateChatBody({
      imageDataUrls: Array.from({ length: 5 }, () => "data:image/png;base64,YQ=="),
      messages: [{ role: "user", content: "识别图片" }],
    })).toBe("单次对话最多支持 4 张图片");
  });
});
