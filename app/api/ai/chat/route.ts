import { NextResponse } from "next/server";

import { resolveAiModel, validateChatBody } from "@/lib/ai/request-policy";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import {
  getEnabledProviderModels,
  getLocalSettings,
  type ZenmeLocalSettings,
  type ModelProviderConfig,
} from "@/lib/local/settings";
import { authErrorResponse, requireUser } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const DEFAULT_SYSTEM_PROMPT =
  "你是 Zenme 的创作助手。用户在一个以项目为中心的无限画布上收集资料、组织想法并推进创作。请基于用户提供的项目上下文和节点内容，帮助用户梳理资料、提炼结构、生成提纲、回答问题或推动下一步。回答聚焦当前项目目标，简洁有用。";
const AI_PROVIDER_ERROR_MESSAGE = "模型调用失败，请稍后重试";

export async function POST(request: Request) {
  try {
    const { user } = await requireAiAccess();
    const userLimitResponse = checkRateLimit({
      key: `ai-chat:user:${user.id}`,
      limit: 30,
      windowMs: 60_000,
    });
    if (userLimitResponse) {
      return userLimitResponse;
    }

    const ipLimitResponse = checkRateLimit({
      key: `ai-chat:ip:${getClientIp(request)}`,
      limit: 80,
      windowMs: 60_000,
    });
    if (ipLimitResponse) {
      return ipLimitResponse;
    }

    const body = (await request.json()) as {
      model?: string;
      messages?: ChatMessage[];
      context?: string;
    };

    if (!body.messages?.length) {
      return NextResponse.json({ error: "缺少 messages" }, { status: 400 });
    }

    const settings = await getLocalSettings().catch(() => null);
    const allowedModels = getConfiguredTextModels(settings);
    const validationError = validateChatBody(body, allowedModels);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const model = resolveAiModel(body.model, allowedModels);
    const providerConfig = resolveChatProviderConfig(model, settings);

    if ("error" in providerConfig) {
      return NextResponse.json({ error: providerConfig.error }, { status: 500 });
    }

    const context = body.context?.trim() ?? "";
    const systemContent = context
      ? `${DEFAULT_SYSTEM_PROMPT}\n\n当前关注的画布节点上下文：\n${context}`
      : DEFAULT_SYSTEM_PROMPT;

    // 以 SSE 流式转发 OpenAI-compatible chat/completions，前端可逐 token 渲染。
    const upstream = await fetchProviderChatCompletion({
      messages: body.messages,
      provider: providerConfig,
      systemContent,
    });

    if ("error" in upstream) {
      return NextResponse.json({ error: upstream.error }, { status: 502 });
    }

    if (!upstream.ok || !upstream.body) {
      const safeError = await createSafeProviderError(upstream, providerConfig);
      return NextResponse.json(
        { error: safeError },
        { status: upstream.status },
      );
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      return authResponse;
    }

    return NextResponse.json(
      { error: AI_PROVIDER_ERROR_MESSAGE },
      { status: 500 },
    );
  }
}

type ChatProviderConfig =
  | {
      apiKey: string;
      authType: ModelProviderConfig["authType"];
      baseUrl: string;
      model: string;
      name: string;
    }
  | { error: string };

function resolveChatProviderConfig(
  model: string,
  settings: ZenmeLocalSettings | null,
): ChatProviderConfig {
  const provider =
    settings?.modelProviders.find(
      (item) =>
        item.enabled &&
        getEnabledProviderModels(item, "text").some(
          (providerModel) => providerModel.id === model,
        ),
    ) ??
    settings?.modelProviders.find((item) => item.enabled && item.isDefault);
  const providerBaseUrl = provider?.baseUrl?.trim();
  const providerApiKey = provider?.apiKey?.trim();
  const providerName = provider?.name?.trim() || "默认模型服务商";
  const baseUrl = trimTrailingSlash(
    process.env.ZHIPU_BASE_URL?.trim() ||
      providerBaseUrl ||
      "https://open.bigmodel.cn/api/paas/v4",
  );
  const apiKey =
    process.env.ZHIPU_API_KEY?.trim() ||
    providerApiKey ||
    getProviderEnvApiKey(provider);

  if (!baseUrl) {
    return { error: `缺少 ${providerName} 的接口地址，请到设置 > 模型配置中补全。` };
  }

  if (!apiKey && provider?.authType !== "none") {
    return {
      error: `缺少 ${providerName} 的 API 密钥，请到设置 > 模型配置中填写，或设置对应环境变量。`,
    };
  }

  return {
    apiKey: apiKey ?? "",
    authType: provider?.authType ?? "bearer",
    baseUrl,
    model,
    name: providerName,
  };
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

function getConfiguredTextModels(settings: ZenmeLocalSettings | null) {
  const modelIds = new Set<string>();

  for (const provider of settings?.modelProviders ?? []) {
    if (!provider.enabled) {
      continue;
    }

    for (const model of getEnabledProviderModels(provider, "text")) {
      modelIds.add(model.id);
    }
  }

  return Array.from(modelIds);
}

function getProviderEnvApiKey(provider?: ModelProviderConfig) {
  if (!provider) {
    return undefined;
  }
  if (provider.apiFormat === "openrouter") {
    return process.env.OPENROUTER_API_KEY?.trim();
  }
  if (provider.apiFormat === "zhipu") {
    return process.env.ZHIPU_API_KEY?.trim();
  }
  return undefined;
}

function createProviderHeaders(provider: Exclude<ChatProviderConfig, { error: string }>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider.authType === "bearer" && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`;
  }
  if (provider.authType === "api-key" && provider.apiKey) {
    headers["X-API-Key"] = provider.apiKey;
  }

  return headers;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

async function fetchProviderChatCompletion(input: {
  messages: ChatMessage[];
  provider: Exclude<ChatProviderConfig, { error: string }>;
  systemContent: string;
}): Promise<Response | { error: string }> {
  try {
    return await fetch(`${input.provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: createProviderHeaders(input.provider),
      body: JSON.stringify({
        model: input.provider.model,
        messages: [
          { role: "system", content: input.systemContent },
          ...input.messages,
        ],
        stream: true,
      }),
    });
  } catch (error) {
    console.warn("[Zenme AI] provider request threw", {
      errorType: error instanceof Error ? error.name : typeof error,
      model: input.provider.model,
      provider: input.provider.name,
    });

    return {
      error: `${input.provider.name} 调用 ${input.provider.model} 失败，无法连接服务商，请检查接口地址或网络。`,
    };
  }
}

async function createSafeProviderError(
  upstream: Response,
  provider: Exclude<ChatProviderConfig, { error: string }>,
) {
  const status = upstream.status || 500;
  const upstreamText = await upstream.text().catch(() => "");
  const trimmed = upstreamText.trim().slice(0, 600);

  if (trimmed) {
    console.warn("[Zenme AI] provider request failed", {
      model: provider.model,
      provider: provider.name,
      status,
      upstream: trimmed,
    });
  } else {
    console.warn("[Zenme AI] provider request failed", {
      model: provider.model,
      provider: provider.name,
      status,
    });
  }

  if (status === 401 || status === 403) {
    return `${provider.name} 调用 ${provider.model} 失败（${status}），请检查 API 密钥或模型权限。`;
  }

  if (status === 404) {
    return `${provider.name} 调用 ${provider.model} 失败（404），请检查模型名称或接口地址。`;
  }

  if (status === 429) {
    return `${provider.name} 调用 ${provider.model} 失败（429），请求过于频繁或额度不足。`;
  }

  if (status >= 400 && status < 500) {
    return `${provider.name} 调用 ${provider.model} 失败（${status}），请检查模型配置和请求内容。`;
  }

  if (status >= 500) {
    return `${provider.name} 调用 ${provider.model} 失败（${status}），服务商暂时不可用。`;
  }

  return AI_PROVIDER_ERROR_MESSAGE;
}
