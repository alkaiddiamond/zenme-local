import { describe, expect, it, vi } from "vitest";

import { requestTextGenerationResponse } from "./text-generation-request";

function streamFromText(text: string) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: text } }],
          })}\n\n`,
        ),
      );
      controller.close();
    },
  });
}

describe("text generation request", () => {
  it("posts prompt, model and context to the AI chat API", async () => {
    const body = streamFromText("生成结果");
    const fetcher = vi.fn().mockResolvedValue({ body, ok: true });

    await expect(
      requestTextGenerationResponse({
        context: "上游内容",
        fetcher,
        model: "deepseek-chat",
        prompt: "写一句广告语",
      }),
    ).resolves.toBe("生成结果");

    expect(fetcher).toHaveBeenCalledWith("/api/ai/chat", {
      body: expect.any(String),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      context: "上游内容",
      messages: [{ role: "user", content: "写一句广告语" }],
      model: "deepseek-chat",
    });
  });

  it("uses a fallback context when no upstream context is available", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      body: streamFromText("结果"),
      ok: true,
    });

    await requestTextGenerationResponse({
      context: "",
      fetcher,
      model: "deepseek-chat",
      prompt: "继续",
    });

    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      context: "没有可用的上游上下文。",
      messages: [{ role: "user", content: "继续" }],
      model: "deepseek-chat",
    });
  });

  it("throws a stable error when the AI chat response fails", async () => {
    const fetcher = vi.fn().mockResolvedValue({ body: null, ok: false });

    await expect(
      requestTextGenerationResponse({
        context: "上游内容",
        fetcher,
        model: "deepseek-chat",
        prompt: "写一句",
      }),
    ).rejects.toThrow("AI 生成失败");
  });
});
