import { modelOptions } from "@/lib/zenme";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const DEFAULT_MODEL = "glm-4-flash";
const MAX_MESSAGES = 24;
const MAX_REQUEST_TEXT_LENGTH = 2_000_000;
const MAX_CHAT_IMAGES = 4;
const MAX_CHAT_IMAGE_LENGTH = 12_000_000;
const MAX_CHAT_IMAGES_TOTAL_LENGTH = 32_000_000;

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
}, allowedModels = modelOptions) {
  if (body.model && !allowedModels.includes(body.model)) {
    return "不支持的模型";
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
      !["user", "assistant", "system"].includes(message.role) ||
      typeof message.content !== "string"
    ) {
      return "messages 格式不正确";
    }

    totalContentLength += message.content.length;
  }

  if (totalContentLength > MAX_REQUEST_TEXT_LENGTH) {
    return "请求文本数据过大，请减少内容后重试";
  }

  return null;
}
