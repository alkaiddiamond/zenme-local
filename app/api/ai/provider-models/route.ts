import { NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import type { ModelProviderConfig } from "@/lib/local/settings";
import { authErrorResponse, requireUser } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

type ModelsResponse = {
  data?: Array<{
    id?: string;
  }>;
};

export async function POST(request: Request) {
  try {
    const { user } = await requireAiAccess();
    const userLimitResponse = checkRateLimit({
      key: `provider-models:user:${user.id}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (userLimitResponse) {
      return userLimitResponse;
    }

    const ipLimitResponse = checkRateLimit({
      key: `provider-models:ip:${getClientIp(request)}`,
      limit: 40,
      windowMs: 60_000,
    });
    if (ipLimitResponse) {
      return ipLimitResponse;
    }

    const body = (await request.json()) as {
      provider?: ModelProviderConfig;
    };
    const provider = body.provider;
    if (!provider) {
      return NextResponse.json({ error: "缺少服务商配置" }, { status: 400 });
    }

    if (provider.apiFormat === "openrouter") {
      return NextResponse.json(
        { error: "OpenRouter 模型池请手动维护，不从接口拉取。" },
        { status: 400 },
      );
    }

    const baseUrl = trimTrailingSlash(provider.baseUrl?.trim() ?? "");
    if (!baseUrl) {
      return NextResponse.json({ error: "缺少接口地址" }, { status: 400 });
    }

    const apiKey = resolveProviderApiKey(provider);
    if (!apiKey && provider.authType !== "none") {
      return NextResponse.json({ error: "缺少 API 密钥" }, { status: 400 });
    }

    const upstream = await fetch(`${baseUrl}/models`, {
      headers: createProviderHeaders(provider, apiKey),
      method: "GET",
    });
    const payload = (await upstream.json().catch(() => null)) as
      | ModelsResponse
      | null;

    if (!upstream.ok) {
      return NextResponse.json(
        { error: "模型拉取失败，请检查接口地址和 API 密钥。" },
        { status: upstream.status },
      );
    }

    const modelIds = Array.from(
      new Set(
        (payload?.data ?? [])
          .map((item) => item.id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    );

    return NextResponse.json({
      data: modelIds.map((id) => ({ id })),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      return authResponse;
    }

    return NextResponse.json({ error: "模型拉取失败" }, { status: 500 });
  }
}

async function requireAiAccess() {
  if (isExplicitLocalStorageMode()) {
    return { user: { id: "local" } };
  }

  return requireUser();
}

function isExplicitLocalStorageMode() {
  return process.env.ZENME_STORAGE_DRIVER === "local" && isLocalStorageMode();
}

function createProviderHeaders(
  provider: ModelProviderConfig,
  apiKey: string,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider.authType === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  if (provider.authType === "api-key" && apiKey) {
    headers["X-API-Key"] = apiKey;
  }

  return headers;
}

function resolveProviderApiKey(provider: ModelProviderConfig) {
  if (provider.apiFormat === "zhipu") {
    return provider.apiKey?.trim() || process.env.ZHIPU_API_KEY?.trim() || "";
  }
  return provider.apiKey?.trim() || process.env.ZENME_PROVIDER_API_KEY?.trim() || "";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
