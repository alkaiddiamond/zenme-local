import { describe, expect, it } from "vitest";

import { readAiChatStream, readAiChatStreamDeltas } from "./ai-stream";

function streamFromChunks(chunks: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function data(content: string) {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content } }],
  })}\n\n`;
}

describe("AI chat stream reader", () => {
  it("reads streamed SSE delta content across chunks", async () => {
    await expect(
      readAiChatStream(
        streamFromChunks([
          data("你"),
          "data: {\"choices\":[{\"delta\":{\"content\":\"好",
          "呀\"}}]}\n\n",
          "data: [DONE]\n\n",
        ]),
      ),
    ).resolves.toBe("你好呀");
  });

  it("ignores malformed data lines and non-data fields", async () => {
    await expect(
      readAiChatStream(
        streamFromChunks([
          "event: message\n",
          "data: {bad json}\n\n",
          data("有效"),
          "data: \n\n",
        ]),
      ),
    ).resolves.toBe("有效");
  });

  it("flushes the final buffered event without a trailing blank line", async () => {
    await expect(
      readAiChatStream(
        streamFromChunks([
          "data: {\"choices\":[{\"delta\":{\"content\":\"尾部\"}}]}",
        ]),
      ),
    ).resolves.toBe("尾部");
  });

  it("emits deltas incrementally for streaming UI updates", async () => {
    const deltas: string[] = [];

    await readAiChatStreamDeltas(
      streamFromChunks([
        data("你"),
        "data: {\"choices\":[{\"delta\":{\"content\":\"好",
        "呀\"}}]}\n\n",
        "data: [DONE]\n\n",
      ]),
      (delta) => deltas.push(delta),
    );

    expect(deltas).toEqual(["你", "好呀"]);
  });

  it("surfaces provider errors delivered after the stream starts", async () => {
    await expect(
      readAiChatStream(
        streamFromChunks([
          'data: {"error":"模型请求过于频繁，请稍后重试"}\n\n',
          "data: [DONE]\n\n",
        ]),
      ),
    ).rejects.toThrow("模型请求过于频繁，请稍后重试");
  });
});
