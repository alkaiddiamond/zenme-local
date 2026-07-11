import { normalizeStreamTokenUsage, type StreamTokenUsage } from "@/lib/ai/openai-responses-stream";

export function observeChatUsageStream(
  source: ReadableStream<Uint8Array>,
  onComplete: (usage: StreamTokenUsage | null) => void | Promise<void>,
) {
  const [clientStream, observerStream] = source.tee();
  void consumeUsage(observerStream, onComplete);
  return clientStream;
}

async function consumeUsage(
  source: ReadableStream<Uint8Array>,
  onComplete: (usage: StreamTokenUsage | null) => void | Promise<void>,
) {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: StreamTokenUsage | null = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = done ? "" : events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const payload = JSON.parse(data) as { usage?: unknown };
            usage = normalizeStreamTokenUsage(payload.usage) ?? usage;
          } catch {
            // Ignore keepalive and provider-specific non-JSON events.
          }
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
    await onComplete(usage);
  }
}
