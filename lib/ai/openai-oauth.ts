import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http, { type Server } from "node:http";

import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import { resolveInside } from "@/lib/local/path-safety";
import {
  CHATGPT_IMAGE_MODEL_IDS,
  CHATGPT_PROVIDER_ID,
  getLocalSettings,
  updateLocalSettings,
  type ModelConfig,
} from "@/lib/local/settings";

const AUTH_ISSUER = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CALLBACK_PORT = 1455;
const CALLBACK_PATH = "/auth/callback";
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
const CODEX_CLIENT_VERSION = "0.150.0";
const MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLIENT_VERSION}`;
export const RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const SESSION_TTL_MS = 5 * 60 * 1000;

type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  idToken?: string;
  email?: string;
  accountId?: string;
  modelsEtag?: string;
};

type PendingSession = {
  state: string;
  codeVerifier: string;
  createdAt: number;
  server: Server;
};

type OAuthGlobal = typeof globalThis & {
  __zenmeOpenAiOAuthSession?: PendingSession;
  __zenmeOpenAiOAuthError?: string;
};

function tokenPath() {
  return resolveInside(getZenmeDataDir(), "openai-oauth.json");
}

function base64UrlSha256(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function decodeJwt(token?: string): Record<string, unknown> | undefined {
  if (!token) return undefined;
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function claimsAccountId(claims?: Record<string, unknown>) {
  if (!claims) return undefined;
  if (typeof claims.chatgpt_account_id === "string") return claims.chatgpt_account_id;
  const auth = claims["https://api.openai.com/auth"];
  if (auth && typeof auth === "object" && "chatgpt_account_id" in auth) {
    const value = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id;
    if (typeof value === "string") return value;
  }
  const organizations = claims.organizations;
  if (Array.isArray(organizations) && organizations[0] && typeof organizations[0] === "object") {
    const value = (organizations[0] as { id?: unknown }).id;
    if (typeof value === "string") return value;
  }
  return undefined;
}

async function readTokens(): Promise<StoredTokens | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(tokenPath(), "utf-8")) as Partial<StoredTokens>;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.expiresAt) return null;
    return parsed as StoredTokens;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

async function writeTokens(tokens: StoredTokens) {
  const filePath = tokenPath();
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.mkdir(getZenmeDataDir(), { recursive: true });
  try {
    await fs.writeFile(tmp, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    await fs.rename(tmp, filePath);
    await fs.chmod(filePath, 0o600).catch(() => undefined);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function requestTokens(body: URLSearchParams) {
  const response = await fetch(`${AUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(30_000),
    ...getProxyFetchOptions(`${AUTH_ISSUER}/oauth/token`),
  });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(formatTokenEndpointError(response.status, responseBody, response.headers));
  }
  return await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
  };
}

function formatTokenEndpointError(status: number, body: string, headers: Headers) {
  if (headers.get("cf-mitigated") === "challenge" || /cloudflare|just a moment/i.test(body)) {
    return `OpenAI 安全验证拦截了令牌交换（${status}），请检查网络、代理或稍后重试。`;
  }
  try {
    const payload = JSON.parse(body) as {
      error?: string | { code?: string; message?: string };
      error_description?: string;
    };
    const code = typeof payload.error === "string" ? payload.error : payload.error?.code;
    const message = payload.error_description || (typeof payload.error === "object" ? payload.error.message : undefined);
    const safeDetail = message || code;
    return safeDetail
      ? `OpenAI 拒绝令牌交换（${status}）：${safeDetail.slice(0, 240)}`
      : `OpenAI 拒绝令牌交换（${status}）。`;
  } catch {
    return `OpenAI 拒绝令牌交换（${status}），请重新登录或检查账号所在地区与 Codex 权限。`;
  }
}

function normalizeTokens(response: Awaited<ReturnType<typeof requestTokens>>, existing?: StoredTokens) {
  if (!response.access_token || (!response.refresh_token && !existing?.refreshToken)) {
    throw new Error("OpenAI OAuth response is incomplete");
  }
  const claims = decodeJwt(response.id_token) ?? decodeJwt(response.access_token);
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? existing!.refreshToken,
    expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
    idToken: response.id_token ?? existing?.idToken,
    email: typeof claims?.email === "string" ? claims.email : existing?.email,
    accountId: claimsAccountId(claims) ?? existing?.accountId,
    modelsEtag: existing?.modelsEtag,
  } satisfies StoredTokens;
}

export async function ensureFreshOpenAiTokens() {
  const existing = await readTokens();
  if (!existing) return null;
  if (existing.expiresAt - Date.now() > 5 * 60 * 1000) return existing;
  try {
    const refreshed = await requestTokens(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: existing.refreshToken,
      client_id: CLIENT_ID,
      scope: "openid profile email",
    }));
    const next = normalizeTokens(refreshed, existing);
    await writeTokens(next);
    return next;
  } catch {
    return null;
  }
}

export function createOpenAiAuthHeaders(tokens: StoredTokens) {
  return {
    Authorization: `Bearer ${tokens.accessToken}`,
    originator: "codex_cli_rs",
    "User-Agent": `codex-cli/${CODEX_CLIENT_VERSION}`,
    ...(tokens.accountId ? { "ChatGPT-Account-Id": tokens.accountId } : {}),
  };
}

function parseModels(payload: unknown): ModelConfig[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const items = Array.isArray(root.models) ? root.models : Array.isArray(root.data) ? root.data : [];
  const seen = new Set<string>();
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const model = item as Record<string, unknown>;
    if (model.visibility === "hide") return [];
    const idValue = model.slug ?? model.id ?? model.model ?? model.value;
    const id = typeof idValue === "string" ? idValue.trim() : "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const aliasValue = model.display_name ?? model.displayName ?? model.name ?? model.label;
    const contextValue = model.context_window ?? model.contextWindow;
    const inputModalities = Array.isArray(model.input_modalities)
      ? model.input_modalities.filter((value): value is string => typeof value === "string")
      : [];
    return [{
      id,
      alias: typeof aliasValue === "string" ? aliasValue : id,
      enabled: true,
      contextWindow: typeof contextValue === "number" ? contextValue : undefined,
      modalities: [
        "text",
        ...(inputModalities.some((value) => /image/i.test(value)) ? ["vision" as const] : []),
        ...(CHATGPT_IMAGE_MODEL_IDS.has(id) ? ["image" as const] : []),
        "tool",
      ] as ModelConfig["modalities"],
    }];
  });
}

export async function syncOpenAiModels() {
  const tokens = await ensureFreshOpenAiTokens();
  if (!tokens) throw new Error("请先登录 ChatGPT");
  const response = await fetch(MODELS_URL, {
    headers: {
      ...createOpenAiAuthHeaders(tokens),
      ...(tokens.modelsEtag ? { "If-None-Match": tokens.modelsEtag } : {}),
    },
    signal: AbortSignal.timeout(30_000),
    ...getProxyFetchOptions(MODELS_URL),
  });
  if (response.status === 304) return (await getLocalSettings()).modelProviders.find((p) => p.id === CHATGPT_PROVIDER_ID)?.models ?? [];
  if (!response.ok) throw new Error(`拉取 ChatGPT 模型失败（${response.status}）`);
  const models = parseModels(await response.json());
  if (!models.length) throw new Error("ChatGPT 未返回可用模型");
  const settings = await getLocalSettings();
  await updateLocalSettings({
    modelProviders: settings.modelProviders.map((provider) => provider.id !== CHATGPT_PROVIDER_ID ? provider : {
      ...provider,
      enabled: true,
      modelMapping: { ...provider.modelMapping, main: models.some((m) => m.id === provider.modelMapping.main) ? provider.modelMapping.main : models[0].id },
      models,
      contextWindows: Object.fromEntries(models.flatMap((m) => m.contextWindow ? [[m.id, m.contextWindow]] : [])),
      modelModalities: Object.fromEntries(models.map((m) => [m.id, m.modalities])),
    }),
  });
  const etag = response.headers.get("etag") ?? undefined;
  if (etag !== tokens.modelsEtag) await writeTokens({ ...tokens, modelsEtag: etag });
  delete (globalThis as OAuthGlobal).__zenmeOpenAiOAuthError;
  return models;
}

function html(title: string, message: string, success: boolean) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f7f7f8;color:#202123}.card{padding:36px 44px;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 12px 35px #0001;text-align:center}h1{font-size:22px;color:${success ? "#16803c" : "#c7352d"}}p{color:#666}</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div>${success ? "<script>setTimeout(()=>window.close(),1800)</script>" : ""}</body></html>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function closePendingSession() {
  const globalState = globalThis as OAuthGlobal;
  const session = globalState.__zenmeOpenAiOAuthSession;
  delete globalState.__zenmeOpenAiOAuthSession;
  if (!session?.server.listening) return;
  await new Promise<void>((resolve) => {
    session.server.close(() => resolve());
  });
}

export async function startOpenAiOAuth() {
  await closePendingSession();
  delete (globalThis as OAuthGlobal).__zenmeOpenAiOAuthError;
  const state = randomBytes(32).toString("hex");
  const codeVerifier = randomBytes(64).toString("hex");
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", REDIRECT_URI);
    const session = (globalThis as OAuthGlobal).__zenmeOpenAiOAuthSession;
    if (url.pathname !== CALLBACK_PATH || !session) {
      response.writeHead(404).end();
      return;
    }
    try {
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== session.state) throw new Error("登录回调无效或已经过期");
      const raw = await requestTokens(new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: session.codeVerifier,
      }));
      await writeTokens(normalizeTokens(raw));
      await syncOpenAiModels();
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html("ChatGPT 登录成功", "模型已同步，可以关闭此页面返回 Zenme。", true));
    } catch (error) {
      (globalThis as OAuthGlobal).__zenmeOpenAiOAuthError = error instanceof Error
        ? error.message
        : "ChatGPT 登录失败，请重试。";
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html("ChatGPT 登录失败", error instanceof Error ? error.message : "请返回 Zenme 重试", false));
    } finally {
      setTimeout(() => void closePendingSession(), 100);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(CALLBACK_PORT, "localhost", () => resolve());
  });
  (globalThis as OAuthGlobal).__zenmeOpenAiOAuthSession = { state, codeVerifier, createdAt: Date.now(), server };
  server.unref();
  setTimeout(() => {
    const session = (globalThis as OAuthGlobal).__zenmeOpenAiOAuthSession;
    if (session?.state === state && Date.now() - session.createdAt >= SESSION_TTL_MS) void closePendingSession();
  }, SESSION_TTL_MS).unref();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
    code_challenge: base64UrlSha256(codeVerifier),
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs",
    state,
  });
  return `${AUTH_ISSUER}/oauth/authorize?${params}`;
}

export async function getOpenAiOAuthStatus() {
  const tokens = await ensureFreshOpenAiTokens();
  const provider = (await getLocalSettings()).modelProviders.find((item) => item.id === CHATGPT_PROVIDER_ID);
  return {
    loggedIn: Boolean(tokens),
    email: tokens?.email ?? null,
    accountId: tokens?.accountId ?? null,
    modelCount: provider?.models.length ?? 0,
    error: (globalThis as OAuthGlobal).__zenmeOpenAiOAuthError ?? null,
  };
}

export async function logoutOpenAi() {
  await closePendingSession();
  delete (globalThis as OAuthGlobal).__zenmeOpenAiOAuthError;
  await fs.rm(tokenPath(), { force: true });
  const settings = await getLocalSettings();
  await updateLocalSettings({
    lastTextModelId: settings.modelProviders.some((p) => p.id !== CHATGPT_PROVIDER_ID && p.models.some((m) => m.id === settings.lastTextModelId)) ? settings.lastTextModelId : undefined,
    modelProviders: settings.modelProviders.map((provider) => provider.id !== CHATGPT_PROVIDER_ID ? provider : {
      ...provider,
      isDefault: false,
      modelMapping: { main: "" },
      models: [],
      contextWindows: {},
      modelModalities: {},
    }),
  });
}
