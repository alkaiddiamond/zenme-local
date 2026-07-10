import type { AgentMessage } from "@/components/zenme/agent-types";
import { requestAiChatStream } from "@/components/zenme/ai-chat-request";

type AgentChatRequestInput = {
  context?: string;
  messages: AgentMessage[];
  model: string;
  signal: AbortSignal;
};

type AgentChatRequestResult =
  | { body: ReadableStream<Uint8Array>; ok: true }
  | { error: string; ok: false };

type Fetcher = typeof fetch;

export async function requestAgentChat(
  input: AgentChatRequestInput,
  fetcher: Fetcher = fetch,
): Promise<AgentChatRequestResult> {
  const response = await requestAiChatStream({
    context: input.context,
    fetcher,
    messages: input.messages,
    model: input.model,
    signal: input.signal,
  });

  if (response.ok) {
    return response;
  }

  return {
    error: `调用失败：${response.error ?? "未知错误"}`,
    ok: false,
  };
}
