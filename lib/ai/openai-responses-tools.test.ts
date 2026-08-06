import { describe, expect, it } from "vitest";

import { createOpenAiWebSearchCommands } from "./openai-responses-tools";

describe("Responses Lite web context", () => {
  it("turns a referenced URL into a scoped search query", () => {
    expect(createOpenAiWebSearchCommands([{
      role: "user",
      content: "从 https://www.myvix.net/about.html 网站看，如何评价这家公司？",
    }])).toEqual({
      search_query: [{
        q: "site:myvix.net/about.html myvix company about 从 网站看，如何评价这家公司？",
      }],
      response_length: "long",
    });
  });

  it("searches requests that explicitly require current information", () => {
    expect(createOpenAiWebSearchCommands([{
      role: "user",
      content: "查询今天的黄金价格",
    }])).toEqual({
      search_query: [{ q: "查询今天的黄金价格" }],
      response_length: "long",
    });
  });

  it("keeps current-information intent from connected canvas context", () => {
    expect(createOpenAiWebSearchCommands([{
      role: "user",
      content: "为什么没有 MiniMax H3？",
    }], "上游提问：帮我了解一下最新的开源视频模型")).toEqual({
      search_query: [{
        q: "为什么没有 MiniMax H3？\n相关画布上下文：上游提问：帮我了解一下最新的开源视频模型",
      }],
      response_length: "long",
    });
  });

  it("does not search ordinary writing requests", () => {
    expect(createOpenAiWebSearchCommands([{
      role: "user",
      content: "把这段内容改写得更简洁",
    }])).toBeNull();
  });
});
