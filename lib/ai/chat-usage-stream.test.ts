import { describe, expect, it } from "vitest";

import { observeChatUsageStream } from "@/lib/ai/chat-usage-stream";

describe("observeChatUsageStream", () => {
  it("keeps the client stream intact and observes final usage", async () => {
    const sourceText = [
      'data: {"choices":[{"delta":{"content":"hello"}}]}',
      'data: {"choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}',
      "data: [DONE]",
      "",
    ].join("\n\n");
    const source = new Response(sourceText).body!;
    let usage: unknown = null;
    const output = await new Response(observeChatUsageStream(source, (value) => {
      usage = value;
    })).text();

    expect(output).toBe(sourceText);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(usage).toEqual({ inputTokens: 8, outputTokens: 3, totalTokens: 11 });
  });
});
