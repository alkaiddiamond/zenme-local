import { musicMcpRequest } from "@/lib/music/mcp-client";

export async function musicServiceRequest(path: string, init?: RequestInit) {
  const baseUrl = process.env.ZENME_MUSIC_SERVICE_URL;
  const token = process.env.ZENME_MUSIC_SERVICE_TOKEN;
  if (baseUrl && token) {
    return requestMusicHttpApi(baseUrl, token, path, init);
  }
  if (process.env.ZENME_MUSIC_MCP_ENABLED === "1") {
    try {
      return await musicMcpRequest(path, init);
    } catch (error) {
      throw new Error(`音乐分析 MCP 不可用：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error("音乐分析 API 未配置");
}

function requestMusicHttpApi(baseUrl: string, token: string, path: string, init?: RequestInit) {
  if (!path.startsWith("/v1/")) throw new Error("无效的音乐服务路径");
  const serviceUrl = new URL(baseUrl);
  if (
    serviceUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(serviceUrl.hostname) ||
    serviceUrl.username ||
    serviceUrl.password ||
    serviceUrl.pathname !== "/"
  ) {
    throw new Error("音乐分析服务地址必须是本机回环 HTTP 地址");
  }
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return fetch(new URL(path, serviceUrl), {
    ...init,
    headers,
    cache: "no-store",
  });
}
