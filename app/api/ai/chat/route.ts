import { NextResponse } from "next/server";

import { resolveAiModel, validateChatBody } from "@/lib/ai/request-policy";
import {
  createOpenAiAuthHeaders,
  ensureFreshOpenAiTokens,
  RESPONSES_URL,
} from "@/lib/ai/openai-oauth";
import { openAiResponsesToChatStream } from "@/lib/ai/openai-responses-stream";
import { normalizeStreamTokenUsage } from "@/lib/ai/openai-responses-stream";
import { observeChatUsageStream } from "@/lib/ai/chat-usage-stream";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { normalizeProviderApiBaseUrl } from "@/lib/api/provider-url";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import {
  getEnabledProviderModels,
  getLocalSettings,
  type ZenmeLocalSettings,
  type ModelProviderConfig,
} from "@/lib/local/settings";
import { recordTokenUsage } from "@/lib/local/token-usage";

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const DEFAULT_SYSTEM_PROMPT =
  "你是 Zenme 的创作助手。用户在一个以项目为中心的无限画布上收集资料、组织想法并推进创作。请基于用户提供的项目上下文和节点内容，帮助用户梳理资料、提炼结构、生成提纲、回答问题或推动下一步。回答聚焦当前项目目标，简洁有用。如果当前请求涉及新闻、赛程、政策、价格、人物职务等可能变化的信息，并且已提供网页搜索工具，应先搜索核实再回答，不要仅依赖模型记忆。";
const AI_PROVIDER_ERROR_MESSAGE = "模型调用失败，请稍后重试";

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    const user = { id: "local" };
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

    const recordUsage = (usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null) =>
      recordTokenUsage({
        providerId: providerConfig.id,
        providerName: providerConfig.name,
        modelId: providerConfig.model,
        modality: "text",
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        totalTokens: usage?.totalTokens,
        durationMs: Date.now() - startedAt,
        messageCount: body.messages?.length,
      }).catch(() => undefined);

    let responseBody: ReadableStream<Uint8Array>;
    if (
      providerConfig.apiFormat === "openai_oauth" ||
      providerConfig.apiFormat === "volcengine_agent_plan"
    ) {
      responseBody = openAiResponsesToChatStream(upstream.body, { onUsage: recordUsage });
    } else if (providerConfig.apiFormat === "anthropic") {
      const usage = normalizeStreamTokenUsage(
        JSON.parse(upstream.headers.get("x-zenme-token-usage") || "null"),
      );
      void recordUsage(usage);
      responseBody = upstream.body;
    } else {
      responseBody = observeChatUsageStream(upstream.body, recordUsage);
    }

    return new Response(responseBody, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch {
    return NextResponse.json(
      { error: AI_PROVIDER_ERROR_MESSAGE },
      { status: 500 },
    );
  }
}

type ChatProviderConfig =
  | {
      apiKey: string;
      id: string;
      apiFormat: ModelProviderConfig["apiFormat"];
      authType: ModelProviderConfig["authType"];
      baseUrl: string;
      model: string;
      name: string;
      networkProxy: ModelProviderConfig["networkProxy"];
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
    );
  const providerBaseUrl = provider?.baseUrl?.trim();
  const providerApiKey = provider?.apiKey?.trim();
  const providerName = provider?.name?.trim() || "所选模型服务商";
  const baseUrl = normalizeProviderApiBaseUrl(
    getProviderEnvBaseUrl(provider) ||
      providerBaseUrl ||
      "https://open.bigmodel.cn/api/paas/v4",
    provider?.apiFormat,
  );
  const apiKey = provider
    ? providerApiKey || getProviderEnvApiKey(provider)
    : process.env.ZHIPU_API_KEY?.trim();

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
    id: provider?.id ?? "unknown",
    apiFormat: provider?.apiFormat ?? "openai",
    authType: provider?.authType ?? "bearer",
    baseUrl,
    model,
    name: providerName,
    networkProxy: provider?.networkProxy ?? {
      mode: "environment",
      url: "",
      noProxy: "localhost,127.0.0.1,::1",
    },
  };
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
  if (provider.apiFormat === "volcengine_agent_plan") {
    return process.env.VOLCENGINE_AGENT_PLAN_API_KEY?.trim();
  }
  return undefined;
}

function getProviderEnvBaseUrl(provider?: ModelProviderConfig) {
  if (provider?.apiFormat === "zhipu") {
    return process.env.ZHIPU_BASE_URL?.trim();
  }
  if (provider?.apiFormat === "volcengine_agent_plan") {
    return process.env.VOLCENGINE_AGENT_PLAN_BASE_URL?.trim();
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

async function fetchProviderChatCompletion(input: {
  messages: ChatMessage[];
  provider: Exclude<ChatProviderConfig, { error: string }>;
  systemContent: string;
}): Promise<Response | { error: string }> {
  try {
    if (input.provider.apiFormat === "openai_oauth") {
      const tokens = await ensureFreshOpenAiTokens();
      if (!tokens) {
        return { error: "ChatGPT 登录已失效，请到设置 > 模型配置中重新登录。" };
      }
      return await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...createOpenAiAuthHeaders(tokens),
        },
        body: JSON.stringify(createOpenAiOAuthRequestBody(input)),
        ...getProxyFetchOptions(
          RESPONSES_URL,
          input.provider.networkProxy,
        ),
      });
    }

    if (input.provider.apiFormat === "anthropic") {
      const response = await fetch(`${input.provider.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          ...(input.provider.apiKey ? { "x-api-key": input.provider.apiKey } : {}),
        },
        body: JSON.stringify({
          max_tokens: 4096,
          messages: input.messages.filter((message) => message.role !== "system"),
          model: input.provider.model,
          stream: false,
          system: input.systemContent,
        }),
        ...getProxyFetchOptions(
          input.provider.baseUrl,
          input.provider.networkProxy,
        ),
      });
      if (!response.ok) return response;
      const payload = (await response.json()) as {
        content?: Array<{ text?: string; type?: string }>;
        usage?: Record<string, unknown>;
      };
      const content = (payload.content ?? [])
        .filter((item) => item.type === "text" && item.text)
        .map((item) => item.text)
        .join("");
      return createTextSseResponse(content, payload.usage);
    }

    if (input.provider.apiFormat === "volcengine_agent_plan") {
      return await fetch(`${input.provider.baseUrl}/responses`, {
        method: "POST",
        headers: createProviderHeaders(input.provider),
        body: JSON.stringify(
          createVolcengineAgentPlanResponsesRequestBody(input),
        ),
        ...getProxyFetchOptions(
          input.provider.baseUrl,
          input.provider.networkProxy,
        ),
      });
    }

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
        stream_options: { include_usage: true },
      }),
      ...getProxyFetchOptions(
        input.provider.baseUrl,
        input.provider.networkProxy,
      ),
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

export function createVolcengineAgentPlanResponsesRequestBody(input: {
  messages: ChatMessage[];
  provider: { model: string };
  systemContent: string;
}) {
  return {
    model: input.provider.model,
    instructions: input.systemContent,
    input: input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        type: "message",
        role: message.role,
        content: message.content,
      })),
    stream: true,
    store: false,
  };
}

export function createOpenAiOAuthRequestBody(input: {
  messages: ChatMessage[];
  provider: { model: string };
  systemContent: string;
}) {
  return {
    model: input.provider.model,
    instructions: input.systemContent,
    input: input.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        type: "message",
        role: message.role,
        content: message.content,
      })),
    stream: true,
    store: false,
    tools: [{ type: "web_search" as const }],
  };
}

function createTextSseResponse(content: string, usage?: Record<string, unknown>) {
  const encoder = new TextEncoder();
  const payload = JSON.stringify({ choices: [{ delta: { content } }] });
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${payload}\n\ndata: [DONE]\n\n`));
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        ...(usage ? { "x-zenme-token-usage": JSON.stringify(usage) } : {}),
      },
    },
  );
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
    if (provider.apiFormat === "openai_oauth") {
      return `ChatGPT 调用 ${provider.model} 失败（${status}），请重新登录或检查账号模型权限。`;
    }
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
