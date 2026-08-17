import { modelOptions } from "@/lib/zenme";
import type { ZenmeModelSpeed, ZenmeReasoningEffort } from "@/lib/local/settings";
import type { ChatMessage } from "@/lib/ai/chat-message";

const DEFAULT_MODEL = "glm-4-flash";
const MAX_MESSAGES = 1_000;
// This is a transport/memory safety cap, not the model context policy. The
// model-specific fitter trims by tokens after validation; 8M characters keeps
// 1M-token models usable without accepting unbounded request bodies.
const MAX_REQUEST_TEXT_LENGTH = 8_000_000;
const MAX_CHAT_IMAGES = 4;
const MAX_CHAT_IMAGE_LENGTH = 12_000_000;
const MAX_CHAT_IMAGES_TOTAL_LENGTH = 32_000_000;
// OpenAI-compatible tool calling supports up to 128 function tools. Keep the
// transport guard aligned with that provider boundary instead of the old
// 32-tool MVP limit: the built-in Project Agent registry already contains more
// than 32 tools, before any lazily activated MCP tools are added.
export const MAX_AGENT_TOOLS = 128;

export function getAllowedAiModels() {
  return modelOptions;
}

export function resolveAiModel(model?: string, allowedModels = modelOptions) {
  if (model && allowedModels.includes(model)) {
    return model;
  }

  return allowedModels[0] ?? DEFAULT_MODEL;
}

export function validateChatBody(body: {
  imageDataUrls?: string[];
  model?: string;
  messages?: ChatMessage[];
  context?: string;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  maxOutputTokens?: number;
  agentTools?: Array<{ name?: unknown; description?: unknown; parameters?: unknown }>;
}, allowedModels = modelOptions) {
  if (body.model && !allowedModels.includes(body.model)) {
    return "不支持的模型";
  }
  if (body.reasoningEffort !== undefined && !["low", "medium", "high", "xhigh"].includes(body.reasoningEffort)) {
    return "不支持的推理强度";
  }
  if (body.modelSpeed !== undefined && body.modelSpeed !== "standard" && body.modelSpeed !== "fast") {
    return "不支持的模型速度";
  }
  if (body.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(body.maxOutputTokens) || body.maxOutputTokens < 1_024 || body.maxOutputTokens > 64_000)) {
    return "模型输出上限必须在 1024 到 64000 tokens 之间";
  }
  if (body.agentTools !== undefined && !Array.isArray(body.agentTools)) {
    return "Agent 工具定义无效";
  }
  if (body.agentTools && body.agentTools.length > MAX_AGENT_TOOLS) {
    return `Agent 工具数量超过 ${MAX_AGENT_TOOLS} 个`;
  }
  if (body.agentTools?.some((tool) =>
      !tool || typeof tool.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) ||
      typeof tool.description !== "string" || tool.description.length > 4_000 ||
      !tool.parameters || typeof tool.parameters !== "object" || Array.isArray(tool.parameters)
    )) {
    return "Agent 工具定义无效";
  }

  if (!Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES) {
    return `单次对话最多支持 ${MAX_MESSAGES} 条消息`;
  }

  if (body.imageDataUrls !== undefined) {
    if (!Array.isArray(body.imageDataUrls) || body.imageDataUrls.length > MAX_CHAT_IMAGES) {
      return `单次对话最多支持 ${MAX_CHAT_IMAGES} 张图片`;
    }
    if (body.imageDataUrls.some((image) =>
      typeof image !== "string" ||
      !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(image) ||
      image.length > MAX_CHAT_IMAGE_LENGTH
    )) {
      return "图片输入格式不正确或图片过大";
    }
    if (body.imageDataUrls.reduce((total, image) => total + image.length, 0) > MAX_CHAT_IMAGES_TOTAL_LENGTH) {
      return "图片输入总大小过大";
    }
  }

  let totalContentLength = body.context?.length ?? 0;

  for (const message of body.messages) {
    if (
      !message ||
      !["user", "assistant", "system", "tool"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      return "messages 格式不正确";
    }

    if (message.role === "tool") {
      if (!message.toolCallId?.trim() || (message.name !== undefined && typeof message.name !== "string")) {
        return "messages 格式不正确";
      }
    } else if (message.toolCalls !== undefined && (
      message.role !== "assistant" || !Array.isArray(message.toolCalls) ||
      message.toolCalls.some((call) => !call || typeof call.id !== "string" || !call.id.trim() ||
        typeof call.name !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(call.name))
    )) {
      return "messages 格式不正确";
    }

    totalContentLength += message.content.length;
    if (message.role !== "tool") {
      for (const call of message.toolCalls ?? []) {
        totalContentLength += call.id.length + call.name.length + JSON.stringify(call.arguments ?? {}).length;
      }
    }
  }

  if (totalContentLength > MAX_REQUEST_TEXT_LENGTH) {
    return "请求文本数据过大，请减少内容后重试";
  }

  return null;
}
