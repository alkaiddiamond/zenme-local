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
      const originUrl = new URL(origin);
      if (
        originUrl.origin !== url.origin &&
        !isEquivalentLoopbackOrigin(originUrl, url)
      ) {
        return "拒绝跨源请求";
      }
    } catch {
      return "请求来源无效";
    }
  }

  return null;
}

function isEquivalentLoopbackOrigin(origin: URL, requestUrl: URL) {
  return (
    origin.protocol === "http:" &&
    requestUrl.protocol === "http:" &&
    LOOPBACK_HOSTS.has(origin.hostname.toLowerCase()) &&
    LOOPBACK_HOSTS.has(requestUrl.hostname.toLowerCase()) &&
    effectivePort(origin) === effectivePort(requestUrl)
  );
}

function effectivePort(url: URL) {
  if (url.port) return url.port;
  return url.protocol === "https:" ? "443" : "80";
}
