import { ProxyAgent } from "undici";

const proxyAgents = new Map<string, ProxyAgent>();

export function getProxyFetchOptions(targetUrl: string | URL) {
  const target = targetUrl instanceof URL ? targetUrl : new URL(targetUrl);
  if (shouldBypassProxy(target.hostname)) return {};

  const proxyUrl = getProxyUrl();
  if (!proxyUrl) return {};

  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }

  return { dispatcher: agent };
}

function getProxyUrl() {
  const value =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function shouldBypassProxy(hostname: string) {
  const entries = (process.env.NO_PROXY || process.env.no_proxy || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const host = hostname.toLowerCase();
  return entries.some((entry) => {
    const normalized = entry.split(":")[0].replace(/^\./, "");
    return normalized === "*" || host === normalized || host.endsWith(`.${normalized}`);
  });
}
