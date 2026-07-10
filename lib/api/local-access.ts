const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function validateLocalRequest(request: Request) {
  const url = new URL(request.url);
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    return "Zenme API 仅允许从本机访问";
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    return "拒绝跨站请求";
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== url.origin) {
        return "拒绝跨源请求";
      }
    } catch {
      return "请求来源无效";
    }
  }

  return null;
}
