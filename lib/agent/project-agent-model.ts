import { POST as postAiChat } from "@/app/api/ai/chat/route";
import { normalizeStreamTokenUsage, type StreamTokenUsage } from "@/lib/ai/openai-responses-stream";
import type { ZenmeModelSpeed, ZenmeReasoningEffort } from "@/lib/local/settings";
import { createNativeAgentTools, type NativeAgentTool } from "@/lib/agent/tool-registry";
import type { AgentWorkspaceToolName } from "@/lib/agent/types";
import { MAX_AGENT_TOOLS } from "@/lib/ai/request-policy";
import type { ChatMessage } from "@/lib/ai/chat-message";

export type ProjectAgentModelResponse = {
  text: string;
  thinkingSummary?: string;
  toolCall?: { name: string; arguments: unknown };
  toolCalls?: Array<{ name: string; arguments: unknown }>;
  usage: StreamTokenUsage | null;
};

export class ProjectAgentModelStreamError extends Error {
  constructor(
    message: string,
    public readonly code: "max_output_tokens" | "stream_error",
    public readonly partialText: string,
    public readonly thinkingSummary: string,
    public readonly usage: StreamTokenUsage | null,
  ) {
    super(message);
    this.name = "ProjectAgentModelStreamError";
  }
}

class ProjectAgentModelRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProjectAgentModelRequestError";
  }
}

const DEFAULT_TRANSIENT_MODEL_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export async function callProjectAgentModel(input: {
  context: string;
  imageDataUrls?: string[];
  model: string;
  prompt: string;
  thinkingEnabled?: boolean;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  maxOutputTokens?: number;
  messages?: ChatMessage[];
  mode?: "project_agent" | "agent_planning" | "web_extraction";
  onThinkingDelta?: (delta: string) => void | Promise<void>;
  onTextDelta?: (delta: string) => void | Promise<void>;
  onToolCallComplete?: (toolCall: { name: string; arguments: unknown }, index: number) => void;
  allowedAgentTools?: AgentWorkspaceToolName[];
  additionalAgentTools?: NativeAgentTool[];
  signal?: AbortSignal;
  /** Runtime/test tuning only; does not change model-visible behavior. */
  transientRetryDelaysMs?: readonly number[];
  onTransientRetry?: (event: {
    attempt: number;
    maxAttempts: number;
    delayMs: number;
    message: string;
  }) => void | Promise<void>;
}): Promise<ProjectAgentModelResponse> {
  const agentTools = input.mode && input.mode !== "project_agent"
    ? undefined
    : fitProjectAgentTools(
        createNativeAgentTools({ include: input.allowedAgentTools }),
        input.additionalAgentTools ?? [],
      );
  const retryDelays = input.transientRetryDelaysMs ?? DEFAULT_TRANSIENT_MODEL_RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt += 1) {
    let emittedObservableOutput = false;
    try {
      const request = new Request("http://127.0.0.1/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          context: input.context,
          imageDataUrls: input.imageDataUrls,
          messages: input.messages?.length
            ? input.messages
            : [{ role: "user", content: input.prompt }],
          model: input.model,
          mode: input.mode ?? "project_agent",
          agentTools,
          thinkingEnabled: input.thinkingEnabled,
          reasoningEffort: input.reasoningEffort,
          modelSpeed: input.modelSpeed,
          maxOutputTokens: input.maxOutputTokens,
        }),
        signal: input.signal,
      });
      const response = await postAiChat(request);
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new ProjectAgentModelRequestError(payload?.error ?? "模型调用失败", response.status);
      }
      const headerUsage = normalizeHeaderUsage(response.headers.get("x-zenme-token-usage"));
      const result = await readModelStream(response.body, {
        onThinkingDelta: async (delta) => {
          emittedObservableOutput = true;
          await input.onThinkingDelta?.(delta);
        },
        onTextDelta: async (delta) => {
          emittedObservableOutput = true;
          await input.onTextDelta?.(delta);
        },
        onToolCallComplete: (toolCall, index) => {
          emittedObservableOutput = true;
          input.onToolCallComplete?.(toolCall, index);
        },
      });
      return {
        text: result.text.trim(),
        thinkingSummary: result.thinkingSummary || undefined,
        toolCall: result.toolCall,
        toolCalls: result.toolCalls,
        usage: result.usage ?? headerUsage,
      };
    } catch (error) {
      const retrySafeStreamFailure = error instanceof ProjectAgentModelStreamError &&
        !error.partialText && !error.thinkingSummary;
      const canRetry = attempt < retryDelays.length &&
        !input.signal?.aborted &&
        !emittedObservableOutput &&
        (error instanceof ProjectAgentModelRequestError || retrySafeStreamFailure) &&
        isTransientProjectAgentModelFailure(error);
      if (!canRetry) throw error;
      const delayMs = Math.max(0, retryDelays[attempt] ?? 0);
      await input.onTransientRetry?.({
        attempt: attempt + 1,
        maxAttempts: retryDelays.length + 1,
        delayMs,
        message: error instanceof Error ? error.message : "模型服务暂时不可用",
      });
      await waitForTransientModelRetry(delayMs, input.signal);
    }
  }
}

export function isTransientProjectAgentModelFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (error instanceof ProjectAgentModelRequestError) {
    if (error.status >= 500 && error.status <= 599) return true;
    if (error.status === 429) {
      return !/(额度不足|usage[_ -]?limit|insufficient[_ -]?quota|billing|credit)/i.test(message);
    }
  }
  if (error instanceof ProjectAgentModelStreamError && error.code !== "stream_error") return false;
  return /(overloaded|at capacity|server(?:s)? (?:are )?busy|temporar(?:ily|y) unavailable|service unavailable|try again later|rate limit|too many requests|服务(?:商)?暂时不可用|请求过于频繁)/i.test(message);
}

function waitForTransientModelRetry(delayMs: number, signal?: AbortSignal) {
  if (delayMs <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function fitProjectAgentTools(
  builtInTools: NativeAgentTool[],
  additionalTools: NativeAgentTool[],
) {
  if (builtInTools.length >= MAX_AGENT_TOOLS) return builtInTools.slice(0, MAX_AGENT_TOOLS);
  const names = new Set(builtInTools.map((tool) => tool.name));
  const merged = [...builtInTools];
  for (const tool of additionalTools) {
    if (merged.length >= MAX_AGENT_TOOLS) break;
    if (names.has(tool.name)) continue;
    names.add(tool.name);
    merged.push(tool);
  }
  return merged;
}

export async function readModelStream(
  body: ReadableStream<Uint8Array>,
  options: {
    onThinkingDelta?: (delta: string) => void | Promise<void>;
    onTextDelta?: (delta: string) => void | Promise<void>;
    onToolCallComplete?: (toolCall: { name: string; arguments: unknown }, index: number) => void;
  } = {},
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let thinkingSummary = "";
  let usage: StreamTokenUsage | null = null;
  const toolCalls = new Map<number, { name: string; arguments: string }>();
  const deliveredToolCalls = new Set<number>();
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
          const payload = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: unknown; tool_calls?: Array<{ index?: number; function?: { name?: unknown; arguments?: unknown } }> }; finish_reason?: unknown }>;
            error?: unknown;
            usage?: unknown;
            zenme?: { type?: unknown; delta?: unknown; index?: unknown; name?: unknown; arguments?: unknown };
          };
          if (typeof payload.error === "string") {
            throw new ProjectAgentModelStreamError(
              payload.error,
              isMaxOutputTokensMessage(payload.error) ? "max_output_tokens" : "stream_error",
              text,
              thinkingSummary,
              usage,
            );
          }
          if (payload.zenme?.type === "thinking_delta" && typeof payload.zenme.delta === "string") {
            thinkingSummary += payload.zenme.delta;
            await options.onThinkingDelta?.(payload.zenme.delta);
          }
          if (payload.zenme?.type === "tool_call_done" && typeof payload.zenme.index === "number" &&
            typeof payload.zenme.name === "string" && typeof payload.zenme.arguments === "string") {
            deliverToolCall(payload.zenme.index, payload.zenme.name, payload.zenme.arguments, deliveredToolCalls, options.onToolCallComplete);
          }
          const delta = payload.choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            text += delta;
            await options.onTextDelta?.(delta);
          }
          for (const call of payload.choices?.[0]?.delta?.tool_calls ?? []) {
            const index = typeof call.index === "number" ? call.index : 0;
            const current = toolCalls.get(index) ?? { name: "", arguments: "" };
            if (typeof call.function?.name === "string") current.name += call.function.name;
            if (typeof call.function?.arguments === "string") current.arguments += call.function.arguments;
            toolCalls.set(index, current);
          }
          if (payload.choices?.[0]?.finish_reason === "tool_calls") {
            for (const [index, call] of toolCalls) {
              deliverToolCall(index, call.name, call.arguments, deliveredToolCalls, options.onToolCallComplete);
            }
          }
          usage = normalizeStreamTokenUsage(payload.usage) ?? usage;
        } catch (error) {
          if (error instanceof Error && error.message !== "Unexpected end of JSON input") throw error;
        }
      }
    }
    if (done) break;
  }
  const orderedToolCalls = [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call);
  const firstToolCall = orderedToolCalls[0];
  if (!text.trim() && !firstToolCall?.name) throw new Error("模型返回了空内容，请重试");
  const parsedToolCalls = orderedToolCalls.map((call) => {
    if (!call.name) throw new Error("模型返回了无效的工具名称，请重试");
    try {
      return { name: call.name, arguments: JSON.parse(call.arguments || "{}") };
    } catch {
      throw new Error("模型返回了无效的工具参数，请重试");
    }
  });
  parsedToolCalls.forEach((call, index) => {
    if (!deliveredToolCalls.has(index)) options.onToolCallComplete?.(call, index);
  });
  return {
    text,
    ...(thinkingSummary ? { thinkingSummary } : {}),
    ...(parsedToolCalls[0] ? { toolCall: parsedToolCalls[0] } : {}),
    ...(parsedToolCalls.length > 1 ? { toolCalls: parsedToolCalls } : {}),
    usage,
  };
}

function deliverToolCall(
  index: number,
  name: string,
  argumentsJson: string,
  delivered: Set<number>,
  listener: ((toolCall: { name: string; arguments: unknown }, index: number) => void) | undefined,
) {
  if (delivered.has(index) || !name) return;
  try {
    const args = JSON.parse(argumentsJson || "{}") as unknown;
    delivered.add(index);
    listener?.({ name, arguments: args }, index);
  } catch {
    // A fragmented Chat Completions tool call is delivered only after its
    // finish_reason, or by the final strict parser below.
  }
}

function normalizeHeaderUsage(value: string | null) {
  if (!value) return null;
  try {
    return normalizeStreamTokenUsage(JSON.parse(value));
  } catch {
    return null;
  }
}

function isMaxOutputTokensMessage(message: string) {
  return /max[_ -]?output[_ -]?tokens|output token limit|输出.{0,12}(?:长度|token).{0,12}(?:上限|限制)/i.test(message);
}
