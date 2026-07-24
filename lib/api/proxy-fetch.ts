import { ProxyAgent } from "undici";

import type { NetworkProxyConfig } from "@/lib/local/settings";

const proxyAgents = new Map<string, ProxyAgent>();

export function getProxyFetchOptions(
  targetUrl: string | URL,
  config?: NetworkProxyConfig,
) {
  const target = targetUrl instanceof URL ? targetUrl : new URL(targetUrl);
  if (
    isLoopbackHostname(target.hostname) ||
    shouldBypassProxy(
      target.hostname,
      config?.mode === "custom" ? config.noProxy : undefined,
    )
  ) {
    return {};
  }

  if (config?.mode === "direct") return {};
  const proxyUrl =
    config?.mode === "custom" ? normalizeProxyUrl(config.url) : getProxyUrl();
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
  return normalizeProxyUrl(value);
}

function normalizeProxyUrl(value: string | undefined) {
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

function shouldBypassProxy(hostname: string, configuredNoProxy?: string) {
  const entries = (
    configuredNoProxy ??
    process.env.NO_PROXY ??
    process.env.no_proxy ??
    ""
  )
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const host = hostname.toLowerCase();
  return entries.some((entry) => {
    const normalized = entry.split(":")[0].replace(/^\./, "");
    return normalized === "*" || host === normalized || host.endsWith(`.${normalized}`);
  });
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}
