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

  it("does not search ordinary writing requests", () => {
    expect(createOpenAiWebSearchCommands([{
      role: "user",
      content: "把这段内容改写得更简洁",
    }])).toBeNull();
  });
});
