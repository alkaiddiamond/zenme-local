import { describe, expect, it } from "vitest";

import { openAiResponsesToChatStream } from "@/lib/ai/openai-responses-stream";

describe("openAiResponsesToChatStream", () => {
  it("converts chunked Responses events into the existing chat SSE protocol", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_'));
        controller.enqueue(encoder.encode('text.delta","delta":"你好"}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":5,"total_tokens":17}}}\n\n'));
        controller.close();
      },
    });

    let usage: unknown = null;
    const output = await new Response(openAiResponsesToChatStream(source, {
      onUsage: (value) => { usage = value; },
    })).text();
    expect(output).toContain('"content":"你好"');
    expect(output).toContain("data: [DONE]");
    expect(usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 });
  });

  it("recovers text from the completed response when no delta event arrives", async () => {
    const source = new Response(
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"完整结果"}]}]}}\n\n',
    ).body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();

    expect(output).toContain('"content":"完整结果"');
    expect(output).toContain("data: [DONE]");
  });

  it("forwards displayable reasoning summaries without mixing them into answer text", async () => {
    const source = new Response([
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"正在检查项目结构"}',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"检查完成"}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}',
      "",
    ].join("\n\n")).body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();

    expect(output).toContain('"type":"thinking_delta","delta":"正在检查项目结构"');
    expect(output).toContain('"content":"检查完成"');
    expect(output).not.toContain('"content":"正在检查项目结构"');
  });

  it("forwards a failed Responses event as a readable chat stream error", async () => {
    const source = new Response(
      'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"context_length_exceeded","message":"too long"}}}\n\n',
    ).body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();

    expect(output).toContain("发送给模型的上下文过长");
    expect(output).toContain("data: [DONE]");
  });

  it("reads account usage errors nested in an error event", async () => {
    const source = new Response(
      'event: error\ndata: {"type":"error","error":{"type":"usage_limit_error","code":"usage_limit_reached","message":"usage limit reached"}}\n\n',
    ).body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();

    expect(output).toContain("当前账号的模型用量已达到限制");
    expect(output).not.toContain("usage limit reached");
  });

  it("does not turn an interrupted upstream stream into an empty success", async () => {
    const source = new Response('event: response.created\ndata: {"type":"response.created"}\n\n').body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();

    expect(output).toContain("模型响应意外中断，请重试");
    expect(output).toContain("data: [DONE]");
  });

  it("reports a completed response that contains no answer text", async () => {
    const source = new Response('event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}\n\n').body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();

    expect(output).toContain("模型返回了空内容，请重试");
  });

  it("forwards Responses function calls through the chat SSE protocol", async () => {
    const source = new Response([
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc-1","call_id":"call-1","name":"read_file","arguments":"{\\"relativePath\\":\\"README.md\\"}"}}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}',
      "",
    ].join("\n\n")).body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();
    expect(output).toContain('"name":"read_file"');
    expect(output).toContain('"arguments":"{\\"relativePath\\":\\"README.md\\"}"');
    expect(output).toContain('"type":"tool_call_done"');
    expect(output).not.toContain("模型返回了空内容");
  });

  it("assigns stable indices to multiple Responses function calls", async () => {
    const source = new Response([
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-1","name":"read_file","arguments":"{\\"relativePath\\":\\"a.ts\\"}"}}',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call-2","name":"read_file","arguments":"{\\"relativePath\\":\\"b.ts\\"}"}}',
      'event: response.completed\ndata: {"type":"response.completed","response":{"output":[]}}',
      "",
    ].join("\n\n")).body!;

    const output = await new Response(openAiResponsesToChatStream(source)).text();
    expect(output).toContain('"index":0');
    expect(output).toContain('"index":1');
    expect(output).toContain('"call-1"');
    expect(output).toContain('"call-2"');
  });
});
