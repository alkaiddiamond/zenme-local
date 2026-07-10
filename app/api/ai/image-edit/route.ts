import { NextResponse } from "next/server";

import { getEnabledProviderModels, getLocalSettings } from "@/lib/local/settings";
import { authErrorResponse, requireUser } from "@/lib/supabase/auth";

const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const NANO_BANANA_2_MODEL = "google/gemini-3.1-flash-image-preview";
const DEFAULT_ERROR_MESSAGE = "图片编辑失败，请稍后重试";

type OpenRouterImageResponse = {
  data?: Array<{
    b64_json?: string;
    media_type?: string;
  }>;
  usage?: unknown;
};

export async function POST(request: Request) {
  try {
    await requireUser();
    const provider = await resolveImageEditProvider();
    if (!provider.apiKey) {
      return NextResponse.json(
        { error: "缺少 OpenRouter API 密钥，请到设置 > 模型配置中填写，或设置 OPENROUTER_API_KEY 环境变量" },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      imageDataUrl?: string;
      prompt?: string;
    };
    const prompt = body.prompt?.trim();
    const imageDataUrl = body.imageDataUrl?.trim();

    if (!prompt) {
      return NextResponse.json({ error: "缺少图片编辑指令" }, { status: 400 });
    }
    if (!imageDataUrl?.startsWith("data:image/")) {
      return NextResponse.json({ error: "缺少有效的参考图片" }, { status: 400 });
    }

    const upstream = await fetch(`${provider.baseUrl}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost/zenme-local",
        "X-Title": "Zenme Local",
      },
      body: JSON.stringify({
        model: provider.model,
        prompt,
        input_references: [
          {
            type: "image_url",
            image_url: {
              url: imageDataUrl,
            },
          },
        ],
        output_format: "png",
        n: 1,
      }),
    });

    const payload = (await upstream.json().catch(() => null)) as
      | (OpenRouterImageResponse & { error?: { message?: string } })
      | null;

    if (!upstream.ok) {
      return NextResponse.json(
        { error: DEFAULT_ERROR_MESSAGE },
        { status: upstream.status },
      );
    }

    const image = payload?.data?.[0];
    if (!image?.b64_json) {
      return NextResponse.json(
        { error: "OpenRouter 未返回图片结果" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      b64Json: image.b64_json,
      mediaType: image.media_type ?? "image/png",
      model: provider.model,
      usage: payload?.usage,
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      return authResponse;
    }

    return NextResponse.json({ error: DEFAULT_ERROR_MESSAGE }, { status: 500 });
  }
}

async function resolveImageEditProvider() {
  const settings = await getLocalSettings().catch(() => null);
  const provider =
    settings?.modelProviders.find(
      (item) =>
        item.enabled &&
        (item.modelMapping.imageEdit || getEnabledProviderModels(item, "image").length > 0),
    ) ??
    settings?.modelProviders.find(
      (item) => item.enabled && item.apiFormat === "openrouter",
    );
  const baseUrl = trimTrailingSlash(
    provider?.baseUrl?.trim() || DEFAULT_OPENROUTER_BASE_URL,
  );
  const model =
    provider?.modelMapping.imageEdit?.trim() ||
    (provider ? getEnabledProviderModels(provider, "image")[0]?.id : undefined) ||
    NANO_BANANA_2_MODEL;
  const apiKey =
    provider?.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || "";

  return {
    apiKey,
    baseUrl,
    model,
  };
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
