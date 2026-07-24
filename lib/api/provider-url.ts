export function normalizeProviderBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("缺少接口地址");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("接口地址格式无效");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("接口地址只支持 HTTP 或 HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("接口地址不能包含登录凭据");
  }
  if (url.search || url.hash) {
    throw new Error("接口地址不能包含查询参数或片段");
  }

  return url.toString().replace(/\/$/, "");
}

export function normalizeProviderApiBaseUrl(
  value: string,
  apiFormat?: string,
) {
  const baseUrl = normalizeProviderBaseUrl(value);
  const url = new URL(baseUrl);
  const isVolcengineAgentPlan =
    apiFormat === "volcengine_agent_plan" ||
    (
      url.hostname.toLowerCase() === "ark.cn-beijing.volces.com" &&
      /^\/api\/plan(?:\/v3)?\/?$/i.test(url.pathname)
    );

  if (!isVolcengineAgentPlan || /\/v3$/i.test(url.pathname)) {
    return baseUrl;
  }

  url.pathname = `${url.pathname.replace(/\/$/, "")}/v3`;
  return url.toString().replace(/\/$/, "");
}
