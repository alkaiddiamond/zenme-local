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
  let emittedText = false;

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
                text?: unknown;
                message?: unknown;
                code?: unknown;
                error?: { code?: unknown; message?: unknown; type?: unknown };
                response?: {
                  error?: { code?: unknown; message?: unknown };
                  incomplete_details?: { reason?: unknown };
                  output?: Array<{
                    content?: Array<{
                      refusal?: unknown;
                      text?: unknown;
                      type?: unknown;
                    }>;
                    type?: unknown;
                  }>;
                  usage?: Record<string, unknown>;
                };
              };
              if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") {
                emitContent(controller, encoder, payload.delta);
                emittedText = true;
              }
              if (
                payload.type === "response.output_text.done" &&
                !emittedText &&
                typeof payload.text === "string"
              ) {
                emitContent(controller, encoder, payload.text);
                emittedText = true;
              }
              if (payload.type === "response.completed") {
                completed = true;
                if (!emittedText) {
                  const completedText = getCompletedResponseText(payload.response?.output);
                  if (completedText) {
                    emitContent(controller, encoder, completedText);
                    emittedText = true;
                  }
                }
                const usage = normalizeStreamTokenUsage(payload.response?.usage);
                if (usage) await options.onUsage?.(usage);
              }
              if (payload.type === "response.failed" || payload.type === "error") {
                completed = true;
                emitError(
                  controller,
                  encoder,
                  getResponseFailureMessage(payload),
                );
              }
              if (payload.type === "response.incomplete") {
                completed = true;
                emitError(
                  controller,
                  encoder,
                  getIncompleteResponseMessage(
                    payload.response?.incomplete_details?.reason,
                  ),
                );
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

function emitContent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  content: string,
) {
  controller.enqueue(
    encoder.encode(
      `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
    ),
  );
}

function emitError(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  error: string,
) {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ error })}\n\n`),
  );
}

function getCompletedResponseText(
  output: Array<{
    content?: Array<{ refusal?: unknown; text?: unknown; type?: unknown }>;
    type?: unknown;
  }> | undefined,
) {
  return (output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .map((item) => {
      if (item.type === "output_text" && typeof item.text === "string") {
        return item.text;
      }
      if (item.type === "refusal" && typeof item.refusal === "string") {
        return item.refusal;
      }
      return "";
    })
    .join("");
}

function getResponseFailureMessage(payload: {
  code?: unknown;
  error?: { code?: unknown; message?: unknown; type?: unknown };
  message?: unknown;
  response?: { error?: { code?: unknown; message?: unknown } };
}) {
  const code = payload.response?.error?.code ?? payload.error?.code ?? payload.code;
  const message = payload.response?.error?.message ?? payload.error?.message ?? payload.message;

  if (code === "usage_limit_reached" || code === "insufficient_quota") {
    return "当前账号的模型用量已达到限制，请等待额度重置或切换其他模型";
  }
  if (code === "rate_limit_exceeded") {
    return "模型请求达到速率或用量限制，请稍后重试，或切换其他模型";
  }
  if (code === "context_length_exceeded") {
    return "发送给模型的上下文过长，请减少画布节点内容后重试";
  }
  if (code === "model_not_found" || code === "unsupported_model") {
    return "当前账号暂时无法使用所选模型，请切换模型或检查账号权限";
  }
  if (typeof message === "string" && message.trim()) {
    return `模型调用失败：${message.trim().slice(0, 300)}`;
  }
  return "模型调用失败，请稍后重试";
}

function getIncompleteResponseMessage(reason: unknown) {
  if (reason === "max_output_tokens") {
    return "模型输出达到长度上限，请缩短上下文后重试";
  }
  if (reason === "content_filter") {
    return "模型输出被安全策略中止，请调整请求内容后重试";
  }
  return "模型未完成响应，请重试";
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
