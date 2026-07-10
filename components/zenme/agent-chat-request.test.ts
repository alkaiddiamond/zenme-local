import { describe, expect, it, vi } from "vitest";

import { requestAgentChat } from "./agent-chat-request";

describe("agent chat request", () => {
  it("posts the selected model, messages and context to the AI chat API", async () => {
    const body = new ReadableStream<Uint8Array>();
    const fetcher = vi.fn().mockResolvedValue({
      body,
      ok: true,
    });
    const controller = new AbortController();

    await expect(
      requestAgentChat(
        {
          context: "节点上下文",
          messages: [{ role: "user", content: "写一句" }],
          model: "deepseek-chat",
          signal: controller.signal,
        },
        fetcher,
      ),
    ).resolves.toEqual({ body, ok: true });

    expect(fetcher).toHaveBeenCalledWith("/api/ai/chat", {
      body: JSON.stringify({
        context: "节点上下文",
        messages: [{ role: "user", content: "写一句" }],
        model: "deepseek-chat",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
  });

  it("returns safe error messages without writing to chat history", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      body: null,
      json: async () => ({ error: "请先登录" }),
      ok: false,
    });

    await expect(
      requestAgentChat(
        {
          messages: [],
          model: "deepseek-chat",
          signal: new AbortController().signal,
        },
        fetcher,
      ),
    ).resolves.toEqual({ error: "调用失败：请先登录", ok: false });
  });

  it("falls back when upstream error bodies are not JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      body: null,
      json: async () => {
        throw new Error("bad json");
      },
      ok: false,
    });

    await expect(
      requestAgentChat(
        {
          messages: [],
          model: "deepseek-chat",
          signal: new AbortController().signal,
        },
        fetcher,
      ),
    ).resolves.toEqual({ error: "调用失败：未知错误", ok: false });
  });
});
