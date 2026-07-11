import { describe, expect, it } from "vitest";

import { readOpenAiImageGenerationStream } from "@/lib/ai/openai-image-generation";

describe("readOpenAiImageGenerationStream", () => {
  it("extracts the final base64 image and usage from Responses SSE", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'data: {"type":"response.output_item.done","item":{"type":"image_generation_call","output_format":"png","result":"aW1hZ2U=","revised_prompt":"revised"}}\n\n',
        ));
        controller.enqueue(encoder.encode(
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":3,"total_tokens":11}}}\n\n',
        ));
        controller.close();
      },
    });

    await expect(readOpenAiImageGenerationStream(source)).resolves.toEqual({
      b64Json: "aW1hZ2U=",
      mediaType: "image/png",
      revisedPrompt: "revised",
      usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
    });
  });

  it("fails when the stream completes without an image", async () => {
    const source = new ReadableStream<Uint8Array>({ start: (controller) => controller.close() });
    await expect(readOpenAiImageGenerationStream(source)).rejects.toThrow("未返回图片结果");
  });
});
