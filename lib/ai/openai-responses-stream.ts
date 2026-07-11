export type StreamTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export function openAiResponsesToChatStream(
  source: ReadableStream<Uint8Array>,
  options: { onUsage?: (usage: StreamTokenUsage) => void | Promise<void> } = {},
) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let completed = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = done ? "" : events.pop() ?? "";
          for (const event of events) {
            const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
            if (!data || data === "[DONE]") continue;
            try {
              const payload = JSON.parse(data) as {
                type?: string;
                delta?: unknown;
                response?: { usage?: Record<string, unknown> };
              };
              if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: payload.delta } }] })}\n\n`));
              }
              if (payload.type === "response.completed") {
                completed = true;
                const usage = normalizeStreamTokenUsage(payload.response?.usage);
                if (usage) await options.onUsage?.(usage);
              }
            } catch {
              // Ignore non-JSON keepalive events.
            }
          }
          if (done) break;
        }
        if (!completed) completed = true;
        if (completed) controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export function normalizeStreamTokenUsage(value: unknown): StreamTokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = tokenCount(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = tokenCount(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = tokenCount(usage.total_tokens) || inputTokens + outputTokens;
  return totalTokens || inputTokens || outputTokens
    ? { inputTokens, outputTokens, totalTokens }
    : null;
}

function tokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}
