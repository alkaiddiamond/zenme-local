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
});
