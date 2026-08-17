import { describe, expect, it, vi } from "vitest";

import { AgentWebFetchError, analyzeWebPage, fetchProjectWebPage, parseWebPageExtraction } from "@/lib/agent/web-fetch";

describe("agent web fetch", () => {
  it("extracts readable text and metadata from a public HTML page", async () => {
    const fetchImpl = vi.fn(async () => new Response(
      "<html><head><title>Docs &amp; API</title><style>hidden</style></head><body><main><h1>Hello</h1><p>Useful text.</p></main></body></html>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));
    const analyze = vi.fn(async (input) => ({
      summary: `针对 ${input.prompt} 的摘要`,
      claims: [{ claim: "Useful text is present.", evidence: "Useful text." }],
    }));
    const result = await fetchProjectWebPage({ url: "https://example.com/docs", prompt: "提取正文要点", model: "test:model" }, {
      fetchImpl: fetchImpl as typeof fetch,
      lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) as never,
      analyze,
    });
    expect(result).toMatchObject({
      finalUrl: "https://example.com/docs",
      title: "Docs & API",
      summary: "针对 提取正文要点 的摘要",
      claims: [{ claim: "Useful text is present.", evidence: "Useful text." }],
      truncated: false,
    });
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining("Useful text."),
      prompt: "提取正文要点",
    }));
  });

  it("blocks localhost and private addresses before fetching", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchProjectWebPage({ url: "http://127.0.0.1/private", prompt: "提取", model: "test:model" }, { fetchImpl: fetchImpl as typeof fetch }))
      .rejects.toMatchObject({ code: "unsafe_url" } satisfies Partial<AgentWebFetchError>);
    await expect(fetchProjectWebPage({ url: "https://internal.example", prompt: "提取", model: "test:model" }, {
      fetchImpl: fetchImpl as typeof fetch,
      lookup: vi.fn(async () => [{ address: "10.0.0.3", family: 4 }]) as never,
    })).rejects.toMatchObject({ code: "unsafe_url" } satisfies Partial<AgentWebFetchError>);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("normalizes a bounded structured page extraction", () => {
    expect(parseWebPageExtraction(JSON.stringify({
      summary: "页面级摘要",
      claims: [{ claim: "事实", evidence: "证据", date: "2026-08-12" }, { invalid: true }],
    }))).toEqual({
      summary: "页面级摘要",
      claims: [{ claim: "事实", evidence: "证据", date: "2026-08-12" }],
    });
  });

  it("lets isolated page analysis inherit the unified reasoning defaults", async () => {
    const callModel = vi.fn(async () => ({
      text: JSON.stringify({ summary: "摘要", claims: [] }),
      usage: null,
    }));

    await expect(analyzeWebPage({
      content: "网页正文",
      model: "provider:gpt-5.6-sol",
      prompt: "提取相关事实",
      url: "https://example.com",
    }, { callModel })).resolves.toEqual({ summary: "摘要", claims: [] });
    expect(callModel).toHaveBeenCalledWith(expect.objectContaining({
      mode: "web_extraction",
    }));
    expect(callModel.mock.calls[0]?.[0]).not.toHaveProperty("thinkingEnabled");
    expect(callModel.mock.calls[0]?.[0]).not.toHaveProperty("reasoningEffort");
  });

  it("reports page-analysis failures separately from page-fetch failures", async () => {
    await expect(analyzeWebPage({
      content: "网页正文",
      model: "provider:gpt-5.6-sol",
      prompt: "提取相关事实",
      url: "https://example.com",
    }, {
      callModel: vi.fn(async () => { throw new Error("上游返回 400"); }),
    })).rejects.toMatchObject({
      code: "web_fetch_failed",
      message: expect.stringContaining("网页已读取，但页面内容分析失败"),
    });
  });
});
