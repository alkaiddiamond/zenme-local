import { describe, expect, it } from "vitest";

import { createOpenAiOAuthRequestBody } from "./route";

describe("ChatGPT OAuth chat request", () => {
  it("enables web search and excludes duplicated system messages", () => {
    expect(createOpenAiOAuthRequestBody({
      messages: [
        { role: "system", content: "旧系统提示" },
        { role: "user", content: "查询最新世界杯信息" },
      ],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "新系统提示",
    })).toMatchObject({
      instructions: "新系统提示",
      input: [{ role: "user", content: "查询最新世界杯信息" }],
      model: "gpt-5.6-sol",
      tools: [{ type: "web_search" }],
    });
  });
});
