import { describe, expect, it } from "vitest";

import {
  createOpenAiOAuthRequestBody,
  createVolcengineAgentPlanResponsesRequestBody,
  fitChatContextToModel,
} from "./route";

describe("model-aware chat context", () => {
  it("does not reject context merely because it exceeds 24,000 characters", () => {
    const context = "长上下文".repeat(8_000);

    expect(fitChatContextToModel({
      context,
      contextWindow: 128_000,
      messages: [{ role: "user", content: "总结" }],
    })).toBe(context);
  });

  it("truncates according to the configured model window", () => {
    const context = fitChatContextToModel({
      context: "正文内容".repeat(4_000),
      contextWindow: 8_000,
      messages: [{ role: "user", content: "总结" }],
    });

    expect(context).toContain("[其余画布上下文因模型窗口限制已省略]");
  });
});

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

  it("adds connected images to the GPT-5.6 user message", () => {
    const body = createOpenAiOAuthRequestBody({
      imageDataUrls: ["data:image/png;base64,aW1hZ2U="],
      messages: [{ role: "user", content: "识别图片内容" }],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
    });

    expect(body.input[1]).toMatchObject({
      role: "user",
      content: [
        { type: "input_text", text: "识别图片内容" },
        { type: "input_image", image_url: "data:image/png;base64,aW1hZ2U=" },
      ],
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

  it("adds connected images using Responses API image parts", () => {
    expect(createVolcengineAgentPlanResponsesRequestBody({
      imageDataUrls: ["data:image/jpeg;base64,aW1hZ2U="],
      messages: [{ role: "user", content: "分析图片" }],
      provider: { model: "doubao-seed-2.0-pro" },
      systemContent: "系统提示",
    }).input[0]).toEqual({
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "分析图片" },
        { type: "input_image", image_url: "data:image/jpeg;base64,aW1hZ2U=" },
      ],
    });
  });
});
