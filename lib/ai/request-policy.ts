import { modelOptions } from "@/lib/zenme";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const DEFAULT_MODEL = "glm-4-flash";
const MAX_MESSAGES = 24;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_CONTEXT_LENGTH = 24_000;
const MAX_TOTAL_CONTENT_LENGTH = 32_000;

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
  model?: string;
  messages?: ChatMessage[];
  context?: string;
}, allowedModels = modelOptions) {
  if (body.model && !allowedModels.includes(body.model)) {
    return "不支持的模型";
  }

  if (!Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES) {
    return `单次对话最多支持 ${MAX_MESSAGES} 条消息`;
  }

  let totalContentLength = body.context?.length ?? 0;
  if ((body.context?.length ?? 0) > MAX_CONTEXT_LENGTH) {
    return "画布上下文过长，请减少选中内容后重试";
  }

  for (const message of body.messages) {
    if (
      !message ||
      !["user", "assistant", "system"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      return "messages 格式不正确";
    }

    if (message.content.length > MAX_MESSAGE_LENGTH) {
      return "单条消息过长，请缩短后重试";
    }

    totalContentLength += message.content.length;
  }

  if (totalContentLength > MAX_TOTAL_CONTENT_LENGTH) {
    return "请求内容过长，请减少上下文后重试";
  }

  return null;
}
