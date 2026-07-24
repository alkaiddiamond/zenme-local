import { NextResponse } from "next/server";

import {
  buildImageEditPrompt,
  buildImageEditSystemPrompt,
  buildImageGenerationSystemPrompt,
  getImageEditAspectRatioOption,
  normalizeImageCameraControl,
  type ImageCameraControl,
} from "@/components/zenme/image-edit-options";
import { readOpenAiImageGenerationStream } from "@/lib/ai/openai-image-generation";
import { resolveProviderModelSelection } from "@/lib/ai/provider-model-resolution";
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
const DEFAULT_ERROR_MESSAGE = "图片生成或编辑失败，请稍后重试";
const IMAGE_REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

class ImageApiError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
  }
}

type ImageRequestBody = {
  aspectRatio?: string;
  cameraControl?: Partial<ImageCameraControl>;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  model?: string;
  operation?: "edit" | "generate";
  prompt?: string;
  quality?: string;
};

type OpenRouterImageResponse = {
  data?: Array<{ b64_json?: string; media_type?: string }>;
  error?: { message?: string } | string;
  usage?: unknown;
};

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const body = (await request.json()) as ImageRequestBody;
    const prompt = body.prompt?.trim();
    const imageDataUrl = body.imageDataUrl?.trim();
    const imageDataUrls = [
      ...(imageDataUrl ? [imageDataUrl] : []),
      ...(body.imageDataUrls ?? []),
    ].map((value) => value.trim()).filter(Boolean).slice(0, 8);
    const model = body.model?.trim();
    const cameraControl = normalizeImageCameraControl(body.cameraControl);

    if (!prompt) return NextResponse.json({ error: "缺少图片生成或编辑指令" }, { status: 400 });
    if (!model) return NextResponse.json({ error: "缺少图片模型" }, { status: 400 });
    if (imageDataUrls.some((value) => !value.startsWith("data:image/"))) {
      return NextResponse.json({ error: "参考图片格式无效" }, { status: 400 });
    }

    const selection = await resolveImageProvider(model);
    if (!selection) return NextResponse.json({ error: "未启用该图片模型" }, { status: 400 });
    const { modelId, provider } = selection;

    const operation = body.operation ?? (imageDataUrls.length ? "edit" : "generate");
    const result = provider.apiFormat === "openai_oauth"
      ? await generateWithChatGpt({
          aspectRatio: body.aspectRatio,
          cameraControl,
          imageDataUrls,
          model: modelId,
          operation,
          prompt,
          provider,
          quality: body.quality,
        })
      : provider.apiFormat === "volcengine_agent_plan"
        ? await generateWithVolcengineAgentPlan({
            aspectRatio: body.aspectRatio,
            cameraControl,
            imageDataUrls,
            model: modelId,
            operation,
            prompt,
            provider,
            quality: body.quality,
          })
      : await generateWithOpenRouter({
          aspectRatio: body.aspectRatio,
          cameraControl,
          imageDataUrls,
          model: modelId,
          operation,
          prompt,
          provider,
          quality: body.quality,
        });

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

    return NextResponse.json({
      b64Json: result.b64Json,
      mediaType: result.mediaType,
      model: modelId,
      revisedPrompt: result.revisedPrompt,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[image-api] Image request failed", error);
    const message = error instanceof ImageApiError
      ? error.publicMessage
      : isTimeoutError(error)
        ? "图片任务执行超过 15 分钟，已停止等待。原有图片不会被清除，可以直接重试"
        : DEFAULT_ERROR_MESSAGE;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function generateWithVolcengineAgentPlan(input: {
  aspectRatio?: string;
  cameraControl?: ImageCameraControl;
  imageDataUrls: string[];
  model: string;
  operation: "edit" | "generate";
  prompt: string;
  provider: ModelProviderConfig;
  quality?: string;
}) {
  if (input.operation === "edit" || input.imageDataUrls.length > 0) {
    throw new ImageApiError(
      "火山方舟 Agent Plan 当前仅接入 Seedream 文生图，暂不支持参考图编辑",
    );
  }

  const apiKey =
    input.provider.apiKey?.trim() ||
    process.env.VOLCENGINE_AGENT_PLAN_API_KEY?.trim();
  if (!apiKey) {
    throw new ImageApiError(
      "缺少火山方舟 Agent Plan API 密钥，请到设置 > 模型配置中填写",
    );
  }

  const fullPrompt =
    `${buildImageGenerationSystemPrompt(input)}\n\n用户生成指令：\n${input.prompt}`;
  const upstream = await fetch(
    `${normalizeProviderApiBaseUrl(
      input.provider.baseUrl,
      input.provider.apiFormat,
    )}/images/generations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        prompt: fullPrompt,
        response_format: "b64_json",
        sequential_image_generation: "disabled",
        size: getVolcengineSeedreamSize(input),
        n: 1,
      }),
      signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
      ...getProxyFetchOptions(
        input.provider.baseUrl,
        input.provider.networkProxy,
      ),
    },
  );
  const payload = (await upstream.json().catch(() => null)) as
    | OpenRouterImageResponse
    | null;
  if (!upstream.ok) {
    throw new ImageApiError(
      formatUpstreamError(
        "火山方舟 Agent Plan 图片调用失败",
        upstream.status,
      ),
    );
  }
  const image = payload?.data?.[0];
  if (!image?.b64_json) {
    throw new ImageApiError(
      "火山方舟 Agent Plan 未返回可用图片，请检查 Seedream 模型权限",
    );
  }

  return {
    b64Json: image.b64_json,
    mediaType: image.media_type ?? "image/png",
    revisedPrompt: undefined,
    usage: normalizeStreamTokenUsage(payload?.usage),
  };
}

async function generateWithChatGpt(input: {
  aspectRatio?: string;
  cameraControl?: ImageCameraControl;
  imageDataUrls: string[];
  model: string;
  operation: "edit" | "generate";
  prompt: string;
  provider: ModelProviderConfig;
  quality?: string;
}) {
  const tokens = await ensureFreshOpenAiTokens();
  if (!tokens) throw new ImageApiError("ChatGPT 登录已失效，请到设置 > 模型配置中重新登录");

  const instructions = input.operation === "edit"
    ? buildImageEditSystemPrompt({
        ...input,
        referenceCount: input.imageDataUrls.length,
      })
    : buildImageGenerationSystemPrompt(input);
  const content: Array<Record<string, string>> = [
    { type: "input_text", text: input.prompt },
  ];
  for (const imageDataUrl of input.imageDataUrls) {
    content.push({ type: "input_image", image_url: imageDataUrl });
  }

  const upstream = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...createOpenAiAuthHeaders(tokens),
    },
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
    throw new ImageApiError(formatUpstreamError("ChatGPT 图片调用失败", upstream.status, detail));
  }

  try {
    return await readOpenAiImageGenerationStream(upstream.body);
  } catch {
    throw new ImageApiError("ChatGPT 图片调用失败，请稍后重试");
  }
}

async function generateWithOpenRouter(input: {
  aspectRatio?: string;
  cameraControl?: ImageCameraControl;
  imageDataUrls: string[];
  model: string;
  operation: "edit" | "generate";
  prompt: string;
  provider: ModelProviderConfig;
  quality?: string;
}) {
  const apiKey = input.provider.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new ImageApiError("缺少 OpenRouter API 密钥，请到设置 > 模型配置中填写");

  const fullPrompt = input.operation === "edit"
    ? buildImageEditPrompt({
        ...input,
        referenceCount: input.imageDataUrls.length,
      })
    : `${buildImageGenerationSystemPrompt(input)}\n\n用户生成指令：\n${input.prompt}`;
  const aspectRatio = getImageEditAspectRatioOption(input.aspectRatio).value;
  const upstream = await fetch(`${normalizeProviderBaseUrl(input.provider.baseUrl || DEFAULT_OPENROUTER_BASE_URL)}/images`, {
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
      resolution: getOpenRouterImageResolution(input.quality),
      output_format: "png",
      n: 1,
    }),
    signal: AbortSignal.timeout(IMAGE_REQUEST_TIMEOUT_MS),
    ...getProxyFetchOptions(
      input.provider.baseUrl || DEFAULT_OPENROUTER_BASE_URL,
      input.provider.networkProxy,
    ),
  });
  const payload = (await upstream.json().catch(() => null)) as OpenRouterImageResponse | null;
  if (!upstream.ok) {
    throw new ImageApiError(formatUpstreamError("OpenRouter 图片调用失败", upstream.status));
  }
  const image = payload?.data?.[0];
  if (!image?.b64_json) throw new ImageApiError("OpenRouter 未返回图片结果");

  return {
    b64Json: image.b64_json,
    mediaType: image.media_type ?? "image/png",
    revisedPrompt: undefined,
    usage: normalizeStreamTokenUsage(payload?.usage),
  };
}

function getOpenRouterImageResolution(quality?: string) {
  return quality === "512P" ? "512" : quality ?? "1K";
}

async function resolveImageProvider(model: string) {
  const settings = await getLocalSettings().catch(() => null);
  if (!settings) return null;
  return resolveProviderModelSelection(
    model,
    settings.modelProviders,
    "image",
  );
}

async function readUpstreamError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    const payload = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    return typeof payload.error === "string"
      ? payload.error
      : payload.error?.message ?? payload.message;
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

function isTimeoutError(error: unknown) {
  return error instanceof Error &&
    (error.name === "TimeoutError" ||
      error.name === "AbortError");
}
