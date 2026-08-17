import { describe, expect, it } from "vitest";

import { fitProjectAgentTools, ProjectAgentModelStreamError, readModelStream } from "@/lib/agent/project-agent-model";
import { MAX_AGENT_TOOLS } from "@/lib/ai/request-policy";

describe("project agent model stream", () => {
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
