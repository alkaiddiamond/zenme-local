import { describe, expect, it } from "vitest";

import {
  createOpenAiOAuthRequestBody,
  createVolcengineAgentPlanResponsesRequestBody,
} from "./route";

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

describe("Volcengine Agent Plan response request", () => {
  it("uses the Responses API shape without duplicating system messages", () => {
    expect(
      createVolcengineAgentPlanResponsesRequestBody({
        messages: [
          { role: "system", content: "旧系统提示" },
          { role: "user", content: "整理项目计划" },
        ],
        provider: { model: "doubao-seed-2.0-pro" },
        systemContent: "Zenme 系统提示",
      }),
    ).toEqual({
      model: "doubao-seed-2.0-pro",
      instructions: "Zenme 系统提示",
      input: [
        {
          type: "message",
          role: "user",
          content: "整理项目计划",
        },
      ],
      stream: true,
      store: false,
    });
  });
});
