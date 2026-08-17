import crypto from "node:crypto";

import { createOpenAiAuthHeaders, ensureFreshOpenAiTokens, SEARCH_URL } from "@/lib/ai/openai-oauth";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalSettings } from "@/lib/local/settings";
import { resolveProviderModelSelection } from "@/lib/ai/provider-model-resolution";
import type { AgentWorkspaceToolArguments, AgentWorkspaceToolResult } from "@/lib/agent/types";

export class AgentWebSearchError extends Error {
  constructor(message: string, readonly code: "invalid_arguments" | "web_search_unavailable" | "web_search_failed") {
    super(message);
    this.name = "AgentWebSearchError";
  }
}

export async function searchProjectWeb(
  input: AgentWorkspaceToolArguments["web_search"],
  dataDir = getZenmeDataDir(),
): Promise<AgentWorkspaceToolResult["web_search"]> {
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (!query || query.length > 1_000) {
    throw new AgentWebSearchError("网页搜索词无效", "invalid_arguments");
  }
  const settings = await getLocalSettings(dataDir);
  const selected = input.model
    ? resolveProviderModelSelection(input.model, settings.modelProviders, "text")
    : null;
  const provider = selected?.provider ?? settings.modelProviders.find((item) => item.apiFormat === "openai_oauth" && item.enabled);
  const model = selected?.modelId ?? provider?.modelMapping.main;
  if (!provider || provider.apiFormat !== "openai_oauth" || !model) {
    throw new AgentWebSearchError("当前模型服务商没有配置可用的网页搜索工具", "web_search_unavailable");
  }
  const tokens = await ensureFreshOpenAiTokens();
  if (!tokens) throw new AgentWebSearchError("ChatGPT 登录已失效，无法使用网页搜索", "web_search_unavailable");
  let response: Response;
  try {
    response = await fetch(SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...createOpenAiAuthHeaders(tokens) },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        model,
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: query }] }],
        commands: { search_query: [{ q: query }], response_length: "short" },
        settings: { allowed_callers: ["direct"], external_web_access: true },
        max_output_tokens: 10_000,
      }),
      signal: AbortSignal.timeout(60_000),
      ...getProxyFetchOptions(SEARCH_URL, provider.networkProxy),
    });
  } catch {
    throw new AgentWebSearchError("网页搜索服务连接失败", "web_search_failed");
  }
  if (!response.ok) {
    throw new AgentWebSearchError(`网页搜索失败（${response.status}）`, "web_search_failed");
  }
  const payload = await response.json().catch(() => null) as { output?: unknown } | null;
  const content = typeof payload?.output === "string" ? payload.output.trim() : "";
  if (!content) throw new AgentWebSearchError("网页搜索没有返回可用结果", "web_search_failed");
  const sources = [...new Set(content.match(/https?:\/\/[^\s<>)\]}"']+/g) ?? [])]
    .map(cleanSourceUrl)
    .filter(Boolean)
    .slice(0, 12);
  if (!sources.length) throw new AgentWebSearchError("网页搜索没有返回可验证的来源", "web_search_failed");
  // 搜索响应只用于发现候选 URL。聚合正文不进入 Agent 上下文，避免模型把
  // 搜索摘要误当作已经阅读、验证过的证据直接复述给用户。
  return { query, sources };
}

function cleanSourceUrl(value: string) {
  return value.replace(/[.,;:!?，。；：！？]+$/, "");
}
