import { requestAiChatStream } from "@/components/zenme/ai-chat-request";
import { readAiChatStream } from "@/components/zenme/canvas/ai-stream";

type TextGenerationRequestInput = {
  context: string;
  fetcher?: typeof fetch;
  model: string;
  prompt: string;
};

export async function requestTextGenerationResponse({
  context,
  fetcher = fetch,
  model,
  prompt,
}: TextGenerationRequestInput) {
  const response = await requestAiChatStream({
    context: context || "没有可用的上游上下文。",
    fetcher,
    messages: [{ role: "user", content: prompt }],
    model,
  });

  if (!response.ok) {
    throw new Error(response.error ?? "AI 生成失败");
  }

  return readAiChatStream(response.body);
}
