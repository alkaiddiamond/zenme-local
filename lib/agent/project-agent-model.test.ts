import { beforeEach, describe, expect, it, vi } from "vitest";

const postAiChatMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/ai/chat/route", () => ({ POST: postAiChatMock }));

import { callProjectAgentModel, fitProjectAgentTools, ProjectAgentModelStreamError, readModelStream } from "@/lib/agent/project-agent-model";
import { MAX_AGENT_TOOLS } from "@/lib/ai/request-policy";

describe("project agent model stream", () => {
  beforeEach(() => {
    postAiChatMock.mockReset();
  });

  it("retries a transient HTTP model failure before any model output", async () => {
    postAiChatMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "模型调用失败（503），服务商暂时不可用。" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"恢复成功"}}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"), { status: 200 }));
    const retries: number[] = [];

    await expect(callProjectAgentModel({
      context: "",
      model: "test:model",
      prompt: "继续",
      transientRetryDelaysMs: [0],
      onTransientRetry: ({ attempt }) => { retries.push(attempt); },
    })).resolves.toMatchObject({ text: "恢复成功" });

    expect(postAiChatMock).toHaveBeenCalledTimes(2);
    expect(retries).toEqual([1]);
  });

  it("retries an overloaded SSE failure only when the failed sample emitted nothing", async () => {
    postAiChatMock
      .mockResolvedValueOnce(new Response([
        'data: {"error":"Our servers are currently overloaded. Please try again later."}',
        "data: [DONE]",
        "",
      ].join("\n\n"), { status: 200 }))
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"第二次采样成功"}}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"), { status: 200 }));

    await expect(callProjectAgentModel({
      context: "",
      model: "test:model",
      prompt: "继续",
      transientRetryDelaysMs: [0],
    })).resolves.toMatchObject({ text: "第二次采样成功" });
    expect(postAiChatMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transient transport failure before any model output", async () => {
    postAiChatMock
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))
      .mockResolvedValueOnce(new Response([
        'data: {"choices":[{"delta":{"content":"网络恢复成功"}}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"), { status: 200 }));

    await expect(callProjectAgentModel({
      context: "",
      model: "test:model",
      prompt: "继续",
      transientRetryDelaysMs: [0],
    })).resolves.toMatchObject({ text: "网络恢复成功" });
    expect(postAiChatMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an aborted transport request", async () => {
    postAiChatMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    await expect(callProjectAgentModel({
      context: "",
      model: "test:model",
      prompt: "继续",
      transientRetryDelaysMs: [0, 0],
    })).rejects.toMatchObject({ name: "AbortError" });
    expect(postAiChatMock).toHaveBeenCalledTimes(1);
  });

  it("forwards original file attachments to the chat transport", async () => {
    let requestBody: Record<string, unknown> | undefined;
    postAiChatMock.mockImplementationOnce(async (request: Request) => {
      requestBody = await request.json() as Record<string, unknown>;
      return new Response([
        'data: {"choices":[{"delta":{"content":"已读取"}}]}',
        "data: [DONE]",
        "",
      ].join("\n\n"), { status: 200 });
    });

    await callProjectAgentModel({
      context: "",
      fileAttachments: [{
        dataUrl: "data:application/pdf;base64,JVBERi0=",
        fileName: "manual.pdf",
        mimeType: "application/pdf",
      }],
      model: "test:model",
      prompt: "总结文档",
    });

    expect(requestBody?.fileAttachments).toEqual([{
      dataUrl: "data:application/pdf;base64,JVBERi0=",
      fileName: "manual.pdf",
      mimeType: "application/pdf",
    }]);
  });

  it("cancels an open model response stream when the turn is stopped", async () => {
    const controller = new AbortController();
    let streamCancelled = false;
    postAiChatMock.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
      cancel() {
        streamCancelled = true;
      },
    }), { status: 200 }));

    const result = callProjectAgentModel({
      context: "",
      model: "test:model",
      prompt: "继续",
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(streamCancelled).toBe(true);
  });

  it("does not retry a transient stream error after user-visible output has started", async () => {
    postAiChatMock.mockResolvedValueOnce(new Response([
      'data: {"choices":[{"delta":{"content":"已经输出"}}]}',
      'data: {"error":"Our servers are currently overloaded. Please try again later."}',
      "data: [DONE]",
      "",
    ].join("\n\n"), { status: 200 }));
    const deltas: string[] = [];

    await expect(callProjectAgentModel({
      context: "",
      model: "test:model",
      prompt: "继续",
      transientRetryDelaysMs: [0, 0, 0],
      onTextDelta: (delta) => { deltas.push(delta); },
    })).rejects.toThrow("overloaded");

    expect(postAiChatMock).toHaveBeenCalledTimes(1);
    expect(deltas).toEqual(["已经输出"]);
  });

  it("keeps built-in tools and bounds lazily activated tools to the provider limit", () => {
    const builtIns = [{ name: "read_file", description: "read", parameters: { type: "object" } }];
    const additional = Array.from({ length: MAX_AGENT_TOOLS + 10 }, (_, index) => ({
      name: `mcp__server__tool_${index}`,
      description: "MCP tool",
      parameters: { type: "object" },
    }));

    const tools = fitProjectAgentTools(builtIns, [builtIns[0]!, ...additional]);

    expect(tools).toHaveLength(MAX_AGENT_TOOLS);
    expect(tools[0]?.name).toBe("read_file");
    expect(tools.filter((tool) => tool.name === "read_file")).toHaveLength(1);
  });

  it("reads text and provider usage from the same SSE stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n'));
        controller.enqueue(encoder.encode('data: {"usage":{"input_tokens":120,"output_tokens":8,"total_tokens":128}}\n\n'));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    await expect(readModelStream(stream)).resolves.toEqual({
      text: "你好",
      usage: { inputTokens: 120, outputTokens: 8, totalTokens: 128 },
    });
  });

  it("rejects a successful-looking stream with no answer text", async () => {
    const stream = new Response("data: [DONE]\n\n").body!;

    await expect(readModelStream(stream)).rejects.toThrow("模型返回了空内容，请重试");
  });

  it("reads a provider-native function call without requiring fake answer text", async () => {
    const stream = new Response([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_","arguments":"{\\"relativePath\\":\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"README.md\\"}"}}]}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n")).body!;

    await expect(readModelStream(stream)).resolves.toEqual({
      text: "",
      toolCall: { name: "read_file", arguments: { relativePath: "README.md" } },
      usage: null,
    });
  });

  it("keeps every provider-native function call in response order", async () => {
    const stream = new Response([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":"{\\"relativePath\\":\\"a.ts\\"}"}},{"index":1,"function":{"name":"read_file","arguments":"{\\"relativePath\\":\\"b.ts\\"}"}}]}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n")).body!;

    await expect(readModelStream(stream)).resolves.toMatchObject({
      toolCall: { name: "read_file", arguments: { relativePath: "a.ts" } },
      toolCalls: [
        { name: "read_file", arguments: { relativePath: "a.ts" } },
        { name: "read_file", arguments: { relativePath: "b.ts" } },
      ],
    });
  });

  it("delivers a complete Responses tool call before the stream finishes and only once", async () => {
    const observed: Array<{ name: string; arguments: unknown; index: number }> = [];
    const stream = new Response([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_file","arguments":"{\\"relativePath\\":\\"README.md\\"}"}}]}}]}',
      'data: {"zenme":{"type":"tool_call_done","index":0,"name":"read_file","arguments":"{\\"relativePath\\":\\"README.md\\"}"}}',
      'data: {"choices":[{"delta":{"content":"after-tool"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n")).body!;

    await expect(readModelStream(stream, {
      onToolCallComplete: (toolCall, index) => { observed.push({ ...toolCall, index }); },
    })).resolves.toMatchObject({ text: "after-tool", toolCall: { name: "read_file" } });
    expect(observed).toEqual([{ name: "read_file", arguments: { relativePath: "README.md" }, index: 0 }]);
  });

  it("delivers Chat Completions tool calls at finish_reason tool_calls", async () => {
    const observed: string[] = [];
    const stream = new Response([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read_","arguments":"{\\"relativePath\\":\\""}}]}}]}',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"a.ts\\"}"}}]},"finish_reason":"tool_calls"}]}',
      "data: [DONE]",
      "",
    ].join("\n\n")).body!;

    await readModelStream(stream, { onToolCallComplete: (call) => { observed.push(call.name); } });
    expect(observed).toEqual(["read_file"]);
  });

  it("streams reasoning summaries separately from the final answer", async () => {
    const deltas: string[] = [];
    const textDeltas: string[] = [];
    const stream = new Response([
      'data: {"zenme":{"type":"thinking_delta","delta":"正在读取"}}',
      'data: {"zenme":{"type":"thinking_delta","delta":"项目文件"}}',
      'data: {"choices":[{"delta":{"content":"读取完成"}}]}',
      "data: [DONE]",
      "",
    ].join("\n\n")).body!;

    await expect(readModelStream(stream, {
      onThinkingDelta: (delta) => { deltas.push(delta); },
      onTextDelta: (delta) => { textDeltas.push(delta); },
    })).resolves.toEqual({
      text: "读取完成",
      thinkingSummary: "正在读取项目文件",
      usage: null,
    });
    expect(deltas).toEqual(["正在读取", "项目文件"]);
    expect(textDeltas).toEqual(["读取完成"]);
  });

  it("preserves partial assistant output when a provider hits max_output_tokens", async () => {
    const stream = new Response([
      'data: {"choices":[{"delta":{"content":"已经完成第一部分，"}}]}',
      'data: {"zenme":{"type":"thinking_delta","delta":"继续处理"}}',
      'data: {"error":"模型输出达到长度上限，请继续生成剩余内容"}',
      "data: [DONE]",
      "",
    ].join("\n\n")).body!;

    const error = await readModelStream(stream).then(
      () => null,
      (value: unknown) => value,
    );
    expect(error).toBeInstanceOf(ProjectAgentModelStreamError);
    expect(error).toMatchObject({
      code: "max_output_tokens",
      partialText: "已经完成第一部分，",
      thinkingSummary: "继续处理",
    });
  });
});
