import { describe, expect, it } from "vitest";

import {
  createOpenAiOAuthRequestBody,
  createVolcengineAgentPlanResponsesRequestBody,
} from "./route";

describe("ChatGPT OAuth chat request", () => {
  it("uses the official Responses Lite shape for GPT-5.6 models", () => {
    expect(createOpenAiOAuthRequestBody({
      messages: [
        { role: "system", content: "旧系统提示" },
        { role: "user", content: "查询最新世界杯信息" },
      ],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "新系统提示",
    })).toMatchObject({
      model: "gpt-5.6-sol",
      input: [
        {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "新系统提示" }],
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "查询最新世界杯信息" }],
        },
      ],
      tool_choice: "auto",
      parallel_tool_calls: false,
      reasoning: { effort: "low", context: "all_turns" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      text: { verbosity: "low" },
    });
  });

  it("adds prefetched web context without declaring a reserved tool", () => {
    const body = createOpenAiOAuthRequestBody({
      messages: [{ role: "user", content: "评价这个网站" }],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
    }, "Example (https://example.com)\nsource text");

    expect(body.input[0]).toMatchObject({
      type: "message",
      role: "developer",
      content: [{
        type: "input_text",
        text: expect.stringContaining("Example (https://example.com)"),
      }],
    });
    expect(JSON.stringify(body)).not.toContain("additional_tools");
  });

  it("keeps the standard Responses shape for older models", () => {
    expect(createOpenAiOAuthRequestBody({
      messages: [{ role: "user", content: "继续" }],
      provider: { model: "gpt-5.5" },
      systemContent: "系统提示",
    })).toEqual({
      model: "gpt-5.5",
      instructions: "系统提示",
      input: [{ type: "message", role: "user", content: "继续" }],
      stream: true,
      store: false,
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
