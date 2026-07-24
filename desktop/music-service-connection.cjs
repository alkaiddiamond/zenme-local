/* eslint-disable @typescript-eslint/no-require-imports */
const { normalizeLoopbackBaseUrl } = require("./music-service-config.cjs");

const NOT_CONFIGURED_MESSAGE = "external API service not configured（未配置外部音乐分析 API）";

class MusicServiceConnection {
  constructor({
    baseUrl,
    token,
    configurationError = null,
    configurationSource = "explicit",
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
  } = {}) {
    this.baseUrl = null;
    this.token = typeof token === "string" && token.trim() ? token.trim() : null;
    this.configurationSource = configurationSource;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.version = null;
    this.protocolVersion = null;
    this.lastError = configurationError;
    this.errorCode = configurationError ? "external_api_invalid_configuration" : null;
    try {
      this.baseUrl = normalizeLoopbackBaseUrl(baseUrl);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.errorCode = "external_api_invalid_configuration";
    }
    this.configured = Boolean(this.baseUrl && this.token && !this.lastError);
    this.status = this.lastError ? "failed" : this.configured ? "disconnected" : "not_configured";
    if (!this.configured && !this.lastError) {
      this.lastError = NOT_CONFIGURED_MESSAGE;
      this.errorCode = "external_api_not_configured";
    }
  }

  async connect() {
    if (!this.configured) return this.snapshot();
    if (this.status === "connected") return this.snapshot();
    this.status = "connecting";
    this.lastError = null;
    this.errorCode = null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/health`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`外部音乐分析 API 健康检查失败 (${response.status})`);
      const health = await response.json();
      if (health.status !== "ok" || health.protocolVersion !== 1) {
        throw new Error("外部音乐分析 API 协议不兼容");
      }
      this.version = health.version || null;
      this.protocolVersion = health.protocolVersion;
      this.status = "connected";
      return this.snapshot();
    } catch (error) {
      this.status = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      this.errorCode = "external_api_connection_failed";
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  clear() {
    this.baseUrl = null;
    this.token = null;
    this.configured = false;
    this.status = "disconnected";
    this.version = null;
    this.protocolVersion = null;
    this.lastError = null;
    this.errorCode = null;
  }

  configuration() {
    return {
      configured: this.configured,
      source: this.configurationSource,
      baseUrl: this.baseUrl,
      tokenConfigured: Boolean(this.token),
    };
  }

  snapshot() {
    return {
      status: this.status,
      available: this.status === "connected",
      configured: this.configured,
      version: this.version,
      protocolVersion: this.protocolVersion,
      error: this.lastError,
      errorCode: this.errorCode,
    };
  }

  serverEnvironment() {
    return this.configured && this.baseUrl && this.token
      ? { ZENME_MUSIC_SERVICE_URL: this.baseUrl, ZENME_MUSIC_SERVICE_TOKEN: this.token }
      : {};
  }
}

module.exports = { MusicServiceConnection, NOT_CONFIGURED_MESSAGE };
