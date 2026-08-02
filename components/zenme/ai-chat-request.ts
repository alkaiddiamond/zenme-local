import type { AgentMessage } from "@/components/zenme/agent-types";

type AiChatStreamRequestInput = {
  context?: string;
  fetcher?: typeof fetch;
  imageDataUrls?: string[];
  messages: AgentMessage[];
  model: string;
  signal?: AbortSignal;
};

type AiChatStreamRequestResult =
  | { body: ReadableStream<Uint8Array>; ok: true }
  | { error?: string; ok: false };

export async function requestAiChatStream({
  context,
  fetcher = fetch,
  imageDataUrls,
  messages,
  model,
  signal,
}: AiChatStreamRequestInput): Promise<AiChatStreamRequestResult> {
  const response = await fetcher("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      context,
      imageDataUrls,
      messages,
      model,
    }),
  });

  if (response.ok && response.body) {
    return { body: response.body, ok: true };
  }

  const payload =
    typeof response.json === "function"
      ? ((await response.json().catch(() => null)) as { error?: string } | null)
      : null;

  return { error: payload?.error, ok: false };
}
