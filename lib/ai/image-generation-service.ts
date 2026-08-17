import {
  buildImageEditPrompt,
  buildImageEditSystemPrompt,
  buildImageGenerationSystemPrompt,
  getImageEditAspectRatioOption,
  normalizeImageCameraControl,
  type ImageCameraControl,
} from "@/components/zenme/image-edit-options";
import { readOpenAiImageGenerationStream } from "@/lib/ai/openai-image-generation";
import {
  getProviderModelSelections,
  resolveProviderModelSelection,
} from "@/lib/ai/provider-model-resolution";
import { getVolcengineSeedreamSize } from "@/lib/ai/volcengine-image-size";
import {
  createOpenAiAuthHeaders,
  ensureFreshOpenAiTokens,
  RESPONSES_URL,
} from "@/lib/ai/openai-oauth";
import { normalizeStreamTokenUsage } from "@/lib/ai/openai-responses-stream";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import {
  normalizeProviderApiBaseUrl,
  normalizeProviderBaseUrl,
} from "@/lib/api/provider-url";
import {
  getLocalSettings,
  type ModelProviderConfig,
} from "@/lib/local/settings";
import { recordTokenUsage } from "@/lib/local/token-usage";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const IMAGE_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

export class ImageGenerationServiceError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
  }
}

export type GenerateConfiguredImageInput = {
  aspectRatio?: string;
  cameraControl?: Partial<ImageCameraControl>;
  imageDataUrls?: string[];
  model?: string;
  operation?: "edit" | "generate";
  prompt: string;
  quality?: string;
};

export type GeneratedConfiguredImage = {
  b64Json: string;
  mediaType: string;
  model: string;
  providerId: string;
  providerName: string;
  revisedPrompt?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
};

type OpenRouterImageResponse = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string } | string;
  usage?: unknown;
};

export async function generateConfiguredImage(
  input: GenerateConfiguredImageInput,
): Promise<GeneratedConfiguredImage> {
  const startedAt = Date.now();
  const prompt = input.prompt.trim();
  const imageDataUrls = (input.imageDataUrls ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);
  if (!prompt) throw new ImageGenerationServiceError("缺少图片生成或编辑指令");
  if (imageDataUrls.some((value) => !value.startsWith("data:image/"))) {
    throw new ImageGenerationServiceError("参考图片格式无效");
  }

  const settings = await getLocalSettings().catch(() => null);
  const selection = settings
    ? input.model?.trim()
      ? resolveProviderModelSelection(input.model.trim(), settings.modelProviders, "image")
      : getProviderModelSelections(settings.modelProviders, "image")[0] ?? null
    : null;
  if (!selection) {
    throw new ImageGenerationServiceError(
      input.model?.trim() ? "未启用该图片模型" : "未配置可用的图片模型",
    );
  }

  const { modelId, provider } = selection;
  const cameraControl = normalizeImageCameraControl(input.cameraControl);
  const operation = input.operation ?? (imageDataUrls.length ? "edit" : "generate");
  const request = {
    aspectRatio: input.aspectRatio,
    cameraControl,
    imageDataUrls,
    model: modelId,
    operation,
    prompt,
    provider,
    quality: input.quality,
  };
  const result = provider.apiFormat === "openai_oauth"
    ? await generateWithChatGpt(request)
    : provider.apiFormat === "volcengine_agent_plan"
      ? await generateWithVolcengineAgentPlan(request)
      : await generateWithOpenRouter(request);

  void recordTokenUsage({
    providerId: provider.id,
    providerName: provider.name,
    modelId,
    modality: "image",
    inputTokens: result.usage?.inputTokens,
    outputTokens: result.usage?.outputTokens,
    totalTokens: result.usage?.totalTokens,
    durationMs: Date.now() - startedAt,
    messageCount: 1,
  }).catch(() => undefined);

  return {
    ...result,
    model: modelId,
    providerId: provider.id,
    providerName: provider.name,
    usage: result.usage ?? undefined,
  };
}

async function generateWithVolcengineAgentPlan(input: ImageProviderRequest) {
  const apiKey = input.provider.apiKey?.trim() || process.env.VOLCENGINE_AGENT_PLAN_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageGenerationServiceError("缺少火山方舟 Agent Plan API 密钥，请到设置 > 模型配置中填写");
  }
  const upstream = await fetch(
    `${normalizeProviderApiBaseUrl(input.provider.baseUrl, input.provider.apiFormat)}/images/generations`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(createVolcengineAgentPlanImageRequestBody(input)),
      signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
      ...getProxyFetchOptions(input.provider.baseUrl, input.provider.networkProxy),
    },
  );
  const payload = (await upstream.json().catch(() => null)) as OpenRouterImageResponse | null;
  if (!upstream.ok) {
    throw new ImageGenerationServiceError(formatUpstreamError("火山方舟 Agent Plan 图片调用失败", upstream.status));
  }
  const image = payload?.data?.[0];
  if (!image?.b64_json) {
    throw new ImageGenerationServiceError("火山方舟 Agent Plan 未返回可用图片，请检查 Seedream 模型权限");
  }
  return {
    b64Json: image.b64_json,
    mediaType: image.media_type ?? "image/png",
    revisedPrompt: undefined,
    usage: normalizeStreamTokenUsage(payload?.usage),
  };
}

export function createVolcengineAgentPlanImageRequestBody(input: Omit<ImageProviderRequest, "provider">) {
  const isEditing = input.operation === "edit" || input.imageDataUrls.length > 0;
  const prompt = isEditing
    ? buildImageEditPrompt({ ...input, referenceCount: input.imageDataUrls.length })
    : `${buildImageGenerationSystemPrompt(input)}\n\n用户生成指令：\n${input.prompt}`;
  return {
    model: input.model,
    prompt,
    ...(input.imageDataUrls.length > 0 ? { image: input.imageDataUrls } : {}),
    response_format: "b64_json",
    sequential_image_generation: "disabled",
    size: getVolcengineSeedreamSize(input),
    n: 1,
  };
}

async function generateWithChatGpt(input: ImageProviderRequest) {
  const tokens = await ensureFreshOpenAiTokens();
  if (!tokens) throw new ImageGenerationServiceError("ChatGPT 登录已失效，请到设置 > 模型配置中重新登录");
  const instructions = input.operation === "edit"
    ? buildImageEditSystemPrompt({ ...input, referenceCount: input.imageDataUrls.length })
    : buildImageGenerationSystemPrompt(input);
  const content: Array<Record<string, string>> = [{ type: "input_text", text: input.prompt }];
  for (const imageDataUrl of input.imageDataUrls) {
    content.push({ type: "input_image", image_url: imageDataUrl });
  }
  const upstream = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...createOpenAiAuthHeaders(tokens) },
    body: JSON.stringify({
      model: input.model,
      instructions,
      input: [{ type: "message", role: "user", content }],
      tools: [{ type: "image_generation", action: input.operation, output_format: "png" }],
      tool_choice: { type: "image_generation" },
      stream: true,
      store: false,
    }),
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    ...getProxyFetchOptions(RESPONSES_URL, input.provider.networkProxy),
  });
  if (!upstream.ok || !upstream.body) {
    const detail = await readUpstreamError(upstream);
    throw new ImageGenerationServiceError(formatUpstreamError("ChatGPT 图片调用失败", upstream.status, detail));
  }
  try {
    return await readOpenAiImageGenerationStream(upstream.body);
  } catch {
    throw new ImageGenerationServiceError("ChatGPT 图片调用失败，请稍后重试");
  }
}

async function generateWithOpenRouter(input: ImageProviderRequest) {
  const apiKey = input.provider.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new ImageGenerationServiceError("缺少 OpenRouter API 密钥，请到设置 > 模型配置中填写");
  const fullPrompt = input.operation === "edit"
    ? buildImageEditPrompt({ ...input, referenceCount: input.imageDataUrls.length })
    : `${buildImageGenerationSystemPrompt(input)}\n\n用户生成指令：\n${input.prompt}`;
  const aspectRatio = getImageEditAspectRatioOption(input.aspectRatio).value;
  const baseUrl = input.provider.baseUrl || DEFAULT_OPENROUTER_BASE_URL;
  const upstream = await fetch(`${normalizeProviderBaseUrl(baseUrl)}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost/zenme-local",
      "X-Title": "Zenme Local",
    },
    body: JSON.stringify({
      model: input.model,
      prompt: fullPrompt,
      ...(input.imageDataUrls.length
        ? { input_references: input.imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })) }
        : {}),
      ...(aspectRatio === "auto" ? {} : { aspect_ratio: aspectRatio }),
      resolution: input.quality === "512P" ? "512" : input.quality ?? "1K",
      output_format: "png",
      n: 1,
    }),
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    ...getProxyFetchOptions(baseUrl, input.provider.networkProxy),
  });
  const payload = (await upstream.json().catch(() => null)) as OpenRouterImageResponse | null;
  if (!upstream.ok) {
    throw new ImageGenerationServiceError(formatUpstreamError("OpenRouter 图片调用失败", upstream.status));
  }
  const image = payload?.data?.[0];
  if (!image?.b64_json) throw new ImageGenerationServiceError("OpenRouter 未返回图片结果");
  return {
    b64Json: image.b64_json,
    mediaType: image.media_type ?? "image/png",
    revisedPrompt: undefined,
    usage: normalizeStreamTokenUsage(payload?.usage),
  };
}

type ImageProviderRequest = {
  aspectRatio?: string;
  cameraControl?: ImageCameraControl;
  imageDataUrls: string[];
  model: string;
  operation: "edit" | "generate";
  prompt: string;
  provider: ModelProviderConfig;
  quality?: string;
};

async function readUpstreamError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    return typeof payload.error === "string" ? payload.error : payload.error?.message ?? payload.message;
  } catch {
    return text;
  }
}

function formatUpstreamError(prefix: string, status: number, detail?: string) {
  const safeDetail = detail?.replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏密钥]").trim();
  return safeDetail
    ? `${prefix}（${status}）：${safeDetail.slice(0, 300)}`
    : `${prefix}（${status}），请检查账号权限、模型状态或稍后重试`;
}

export function isImageGenerationTimeoutError(error: unknown) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
