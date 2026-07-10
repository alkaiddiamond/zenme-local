import { describe, expect, it, vi } from "vitest";

import { requestAiChatStream } from "./ai-chat-request";

describe("AI chat stream request", () => {
  it("posts normalized AI chat requests", async () => {
    const body = new ReadableStream<Uint8Array>();
    const fetcher = vi.fn().mockResolvedValue({ body, ok: true });
    const controller = new AbortController();

    await expect(
      requestAiChatStream({
        context: "上下文",
        fetcher,
        messages: [{ role: "user", content: "生成" }],
        model: "deepseek-chat",
        signal: controller.signal,
      }),
    ).resolves.toEqual({ body, ok: true });

    expect(fetcher).toHaveBeenCalledWith("/api/ai/chat", {
      body: expect.any(String),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      context: "上下文",
      messages: [{ role: "user", content: "生成" }],
      model: "deepseek-chat",
    });
  });

  it("returns upstream error text when available", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      body: null,
      json: async () => ({ error: "请先登录" }),
      ok: false,
    });

    await expect(
      requestAiChatStream({
        fetcher,
        messages: [],
        model: "deepseek-chat",
      }),
    ).resolves.toEqual({ error: "请先登录", ok: false });
  });

  it("does not throw when upstream error bodies are not JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      body: null,
      json: async () => {
        throw new Error("bad json");
      },
      ok: false,
    });

    await expect(
      requestAiChatStream({
        fetcher,
        messages: [],
        model: "deepseek-chat",
      }),
    ).resolves.toEqual({ error: undefined, ok: false });
  });
});
