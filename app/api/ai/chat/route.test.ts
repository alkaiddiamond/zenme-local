import { describe, expect, it } from "vitest";

import { createNativeAgentTools } from "@/lib/agent/tool-registry";

import {
  anthropicMessagesToChatStream,
  createAnthropicMessagesRequestBody,
  createAnthropicSseResponse,
  createChatSystemContent,
  createOpenAiChatCompletionRequestBody,
  createOpenAiOAuthRequestBody,
  createVolcengineAgentPlanResponsesRequestBody,
  fitChatContextToModel,
  shouldAllowAutomaticWebSearch,
} from "./route";
import { readModelStream } from "@/lib/agent/project-agent-model";

describe("project agent system prompt", () => {
  it("injects the internal decision loop before the dynamic project context", () => {
    const prompt = createChatSystemContent("project_agent", "当前有效事件：[]");

    expect(prompt).toContain("每个 Turn 都在内部执行以下决策循环");
    expect(prompt).toContain("每次工具调用后读取真实结果并重新判断下一步");
    expect(prompt).toContain("不得输出私有思维链");
    expect(prompt.indexOf("每个 Turn 都在内部执行以下决策循环"))
      .toBeLessThan(prompt.indexOf("当前有效事件：[]"));
  });
});

describe("isolated web extraction", () => {
  it("disables recursive automatic web search only for page extraction", () => {
    expect(shouldAllowAutomaticWebSearch("web_extraction")).toBe(false);
    expect(shouldAllowAutomaticWebSearch("research_evaluation")).toBe(false);
    expect(shouldAllowAutomaticWebSearch("agent_planning")).toBe(false);
    expect(shouldAllowAutomaticWebSearch("project_agent")).toBe(true);
    expect(shouldAllowAutomaticWebSearch("chat")).toBe(true);
  });

  it("uses an isolated no-tool system prompt for Agent planning", () => {
    const prompt = createChatSystemContent("agent_planning", "画布上下文：模块 A");
    expect(prompt).toContain("Agent 任务规划器");
    expect(prompt).toContain("不得调用工具");
    expect(prompt).toContain("项目任务规划上下文");
  });
});

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
      parallel_tool_calls: true,
      reasoning: { effort: "low", summary: "auto", context: "all_turns" },
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

  it("declares project Agent functions through the native Responses tool field", () => {
    const body = createOpenAiOAuthRequestBody({
      messages: [{ role: "user", content: "打开页面" }],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
      agentTools: [{
        name: "read_file",
        description: "读取文件",
        parameters: { type: "object", properties: { relativePath: { type: "string" } } },
      }],
    });
    expect(body).toMatchObject({
      tools: [{ type: "function", name: "read_file", strict: false }],
      tool_choice: "auto",
      parallel_tool_calls: true,
    });
  });

  it("preserves native function call history for the next Agent iteration", () => {
    const body = createOpenAiOAuthRequestBody({
      messages: [
        { role: "user", content: "检查项目" },
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "workspace_status", arguments: {} }] },
        { role: "tool", content: "项目正常", toolCallId: "call-1", name: "workspace_status" },
      ],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
    });

    expect(body.input).toEqual(expect.arrayContaining([
      { type: "function_call", call_id: "call-1", name: "workspace_status", arguments: "{}" },
      { type: "function_call_output", call_id: "call-1", output: "项目正常" },
    ]));
  });

  it("uses selectable GPT-5.6 reasoning effort and fast service tier", () => {
    const body = createOpenAiOAuthRequestBody({
      messages: [{ role: "user", content: "深入检查" }],
      provider: { model: "gpt-5.6-sol" },
      reasoningEffort: "xhigh",
      modelSpeed: "fast",
      systemContent: "系统提示",
    });

    expect(body).toMatchObject({
      reasoning: { effort: "xhigh", summary: "auto", context: "all_turns" },
      service_tier: "priority",
    });
  });

  it("maps disabled legacy thinking to none without enabling fast mode", () => {
    const body = createOpenAiOAuthRequestBody({
      messages: [{ role: "user", content: "快速回答" }],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
      thinkingEnabled: false,
    });

    expect(body).toMatchObject({ reasoning: { effort: "none" } });
    expect((body as { reasoning: { effort: string; summary?: string } }).reasoning).not.toHaveProperty("summary");
    expect(body).not.toHaveProperty("service_tier");
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

describe("OpenAI-compatible native Agent tools", () => {
  it("uses Chat Completions function tools instead of asking for JSON text", () => {
    expect(createOpenAiChatCompletionRequestBody({
      messages: [{ role: "user", content: "打开页面" }],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
      agentTools: [{ name: "read_file", description: "读取文件", parameters: { type: "object" } }],
    })).toMatchObject({
      tools: [{ type: "function", function: { name: "read_file" } }],
      tool_choice: "auto",
      parallel_tool_calls: true,
    });
  });

  it("preserves Chat Completions tool call history", () => {
    const body = createOpenAiChatCompletionRequestBody({
      messages: [
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "workspace_status", arguments: {} }] },
        { role: "tool", content: "项目正常", toolCallId: "call-1" },
      ],
      provider: { model: "compatible-model" },
      systemContent: "系统提示",
    });

    expect(body.messages).toEqual([
      { role: "system", content: "系统提示" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call-1", type: "function", function: { name: "workspace_status", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "call-1", content: "项目正常" },
    ]);
  });

  it("preserves required fields and closed object schemas across both provider transports", () => {
    const tools = createNativeAgentTools({ include: ["web_fetch"] });
    const expected = tools[0]!.parameters;
    const responsesBody = createOpenAiOAuthRequestBody({
      messages: [{ role: "user", content: "读取网页" }],
      provider: { model: "gpt-5.6-sol" },
      systemContent: "系统提示",
      agentTools: tools,
    });
    const chatBody = createOpenAiChatCompletionRequestBody({
      messages: [{ role: "user", content: "读取网页" }],
      provider: { model: "compatible-model" },
      systemContent: "系统提示",
      agentTools: tools,
    });

    expect(responsesBody.tools?.[0]).toMatchObject({
      parameters: expected,
      strict: false,
    });
    expect(chatBody.tools?.[0]?.function.parameters).toEqual(expected);
    expect(expected).toMatchObject({
      required: ["url", "prompt"],
      additionalProperties: false,
    });
  });
});

describe("Anthropic native Agent tools", () => {
  it("accepts a turn-scoped max output override for recovery retries", () => {
    expect(createAnthropicMessagesRequestBody({
      messages: [{ role: "user", content: "继续" }],
      provider: { model: "claude-sonnet" },
      systemContent: "系统提示",
      maxOutputTokens: 64_000,
    })).toMatchObject({ max_tokens: 64_000 });
  });

  it("declares tools and preserves the tool_use/tool_result trajectory", () => {
    const body = createAnthropicMessagesRequestBody({
      messages: [
        { role: "user", content: "检查项目" },
        { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "workspace_status", arguments: {} }] },
        { role: "tool", content: "项目正常", toolCallId: "call-1", name: "workspace_status" },
      ],
      provider: { model: "claude-sonnet" },
      systemContent: "系统提示",
      agentTools: [{
        name: "workspace_status",
        description: "检查工作区",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      }],
    });

    expect(body).toMatchObject({
      tools: [{
        name: "workspace_status",
        description: "检查工作区",
        input_schema: { type: "object", additionalProperties: false },
      }],
      tool_choice: { type: "auto" },
      messages: [
        { role: "user", content: [{ type: "text", text: "检查项目" }] },
        { role: "assistant", content: [{ type: "tool_use", id: "call-1", name: "workspace_status", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call-1", content: "项目正常" }] },
      ],
    });
  });

  it("maps thinking, text, tool_use and usage into the shared Agent stream", async () => {
    const response = createAnthropicSseResponse({
      content: [
        { type: "thinking", thinking: "先检查工作区" },
        { type: "text", text: "正在检查。" },
        { type: "tool_use", id: "toolu-1", name: "workspace_status", input: { includeFiles: true } },
      ],
      usage: { input_tokens: 12, output_tokens: 7 },
    });

    await expect(readModelStream(response.body!)).resolves.toMatchObject({
      text: "正在检查。",
      thinkingSummary: "先检查工作区",
      toolCall: { name: "workspace_status", arguments: { includeFiles: true } },
      usage: { inputTokens: 12, outputTokens: 7, totalTokens: 19 },
    });
    expect(response.headers.get("x-zenme-token-usage")).toContain("input_tokens");
  });

  it("streams Anthropic thinking, text and fragmented tool arguments without waiting for the full message", async () => {
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const payload of [
          { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "检查" } },
          { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "开始。" } },
          { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu-1", name: "read_file", input: {} } },
          { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"relativePath\":" } },
          { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"README.md\"}" } },
          { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 6 } },
        ]) controller.enqueue(encoder.encode(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.close();
      },
    });

    await expect(readModelStream(anthropicMessagesToChatStream(upstream))).resolves.toMatchObject({
      text: "开始。",
      thinkingSummary: "检查",
      toolCall: { name: "read_file", arguments: { relativePath: "README.md" } },
      usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
    });
  });

  it("maps Anthropic max_tokens termination to the recoverable shared stream error", async () => {
    const encoder = new TextEncoder();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const payload of [
          { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } },
          { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "部分输出" } },
          { type: "message_delta", delta: { stop_reason: "max_tokens" }, usage: { output_tokens: 4096 } },
        ]) controller.enqueue(encoder.encode(`event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`));
        controller.close();
      },
    });

    const error = await readModelStream(anthropicMessagesToChatStream(upstream)).then(
      () => null,
      (value: unknown) => value,
    );
    expect(error).toMatchObject({
      code: "max_output_tokens",
      partialText: "部分输出",
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
