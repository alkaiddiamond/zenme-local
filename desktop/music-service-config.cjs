function optionalSecret(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeLoopbackBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("音乐分析服务 Base URL 无效");
  }
  if (
    url.protocol !== "http:"
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    throw new Error("音乐分析服务 Base URL 必须是无凭据、无路径的本机回环 HTTP 地址");
  }
  return url.origin;
}

function resolveMusicServiceConfiguration({ desktopConfig = {}, env = process.env }) {
  const configured = desktopConfig.musicService && typeof desktopConfig.musicService === "object"
    ? desktopConfig.musicService
    : {};
  const environmentManaged = [
    env.ZENME_MUSIC_SERVICE_URL,
    env.ZENME_MUSIC_SERVICE_TOKEN,
  ].some((value) => typeof value === "string" && value.trim());
  const desktopHttpEnabled = configured.transport === "http";
  const rawBaseUrl = environmentManaged
    ? env.ZENME_MUSIC_SERVICE_URL
    : desktopHttpEnabled ? configured.baseUrl : null;
  const token = optionalSecret(environmentManaged
    ? env.ZENME_MUSIC_SERVICE_TOKEN
    : desktopHttpEnabled ? configured.token : null);
  let baseUrl = null;
  let error = null;
  try {
    baseUrl = normalizeLoopbackBaseUrl(rawBaseUrl);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  return {
    baseUrl,
    token,
    configured: Boolean(baseUrl && token && !error),
    error,
    source: environmentManaged ? "environment"
      : baseUrl || token ? "desktop-config" : "none",
  };
}

function updateMusicServiceConfiguration(desktopConfig, updates) {
  const current = desktopConfig.musicService && typeof desktopConfig.musicService === "object"
    ? desktopConfig.musicService
    : {};
  const nextMusicService = {};
  const baseUrl = normalizeLoopbackBaseUrl(
    Object.hasOwn(updates, "baseUrl") ? updates.baseUrl : current.baseUrl,
  );
  const token = optionalSecret(
    Object.hasOwn(updates, "token") ? updates.token : current.token,
  );
  if (baseUrl || token) nextMusicService.transport = "http";
  if (baseUrl) nextMusicService.baseUrl = baseUrl;
  if (token) nextMusicService.token = token;
  return { ...desktopConfig, musicService: nextMusicService };
}

module.exports = {
  normalizeLoopbackBaseUrl,
  resolveMusicServiceConfiguration,
  updateMusicServiceConfiguration,
};
