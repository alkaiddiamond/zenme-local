import { normalizeStreamTokenUsage, type StreamTokenUsage } from "@/lib/ai/openai-responses-stream";

type ImageGenerationResult = {
  b64Json: string;
  mediaType: string;
  revisedPrompt?: string;
  usage: StreamTokenUsage | null;
};

export async function readOpenAiImageGenerationStream(
  source: ReadableStream<Uint8Array>,
): Promise<ImageGenerationResult> {
  const decoder = new TextDecoder();
  const reader = source.getReader();
  let buffer = "";
  let result = "";
  let outputFormat = "png";
  let revisedPrompt: string | undefined;
  let usage: StreamTokenUsage | null = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : events.pop() ?? "";

      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;

        try {
          const payload = JSON.parse(data) as {
            type?: string;
            item?: {
              output_format?: string;
              result?: string;
              revised_prompt?: string;
              type?: string;
            };
            response?: {
              output?: Array<{
                output_format?: string;
                result?: string;
                revised_prompt?: string;
                type?: string;
              }>;
              usage?: unknown;
            };
          };

          if (payload.type === "response.output_item.done" && payload.item?.type === "image_generation_call") {
            result = payload.item.result || result;
            outputFormat = payload.item.output_format || outputFormat;
            revisedPrompt = payload.item.revised_prompt || revisedPrompt;
          }

          if (payload.type === "response.completed") {
            const image = payload.response?.output?.find((item) => item.type === "image_generation_call");
            result = image?.result || result;
            outputFormat = image?.output_format || outputFormat;
            revisedPrompt = image?.revised_prompt || revisedPrompt;
            usage = normalizeStreamTokenUsage(payload.response?.usage);
          }
        } catch {
          // Ignore keepalive and malformed events while continuing the image stream.
        }
      }

      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }

  if (!result) {
    throw new Error("ChatGPT 未返回图片结果");
  }

  return {
    b64Json: result,
    mediaType: outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png",
    revisedPrompt,
    usage,
  };
}
