import { getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { resolveInside } from "@/lib/local/path-safety";
import {
  CHATGPT_PROVIDER_ID,
  createVolcengineAgentPlanProvider,
} from "@/lib/ai/provider-presets";

export { CHATGPT_PROVIDER_ID, createChatGptProvider } from "@/lib/ai/provider-presets";

export type ZenmeLocalSettings = {
  version: 1;
  dataDir: string;
  autoSaveIntervalMs: number;
  lastTextModelId?: string;
  lastImageModelId?: string;
  lastVideoModelId?: string;
  lastImageAspectRatio?: string;
  lastImageQuality?: string;
  modelProviders: ModelProviderConfig[];
};

export type NetworkProxyMode = "environment" | "custom" | "direct";

export type NetworkProxyConfig = {
  mode: NetworkProxyMode;
  url: string;
  noProxy: string;
};

export type ModelProviderApiFormat =
  | "openai"
  | "openai_oauth"
  | "anthropic"
  | "openrouter"
  | "ollama"
  | "volcengine_agent_plan"
  | "zhipu"
  | "custom";

export type ModelProviderAuthType = "bearer" | "api-key" | "none";

export type ModelModality =
  | "text"
  | "vision"
  | "image"
  | "embedding"
  | "audio"
  | "video"
  | "rerank"
  | "tool";

export type ModelConfig = {
  id: string;
  alias?: string;
  enabled: boolean;
  contextWindow?: number;
  modalities: ModelModality[];
};

export type ModelProviderConfig = {
  id: string;
  name: string;
  note?: string;
  baseUrl: string;
  apiFormat: ModelProviderApiFormat;
  authType: ModelProviderAuthType;
  apiKey?: string;
  enabled: boolean;
  isDefault: boolean;
  modelMapping: {
    main: string;
    image?: string;
    video?: string;
  };
  models: ModelConfig[];
  contextWindows: Record<string, number>;
  modelModalities: Record<string, ModelModality[]>;
  networkProxy: NetworkProxyConfig;
};

export function createDefaultLocalSettings(dataDir = getZenmeDataDir()): ZenmeLocalSettings {
  return {
    version: 1,
    dataDir,
    autoSaveIntervalMs: 5_000,
    modelProviders: createDefaultModelProviders(),
  };
}

export function getLocalSettingsPath(dataDir = getZenmeDataDir()) {
  return resolveInside(dataDir, "settings.json");
}

export async function getLocalSettings(dataDir = getZenmeDataDir()) {
  const defaults = createDefaultLocalSettings(dataDir);
  return readJsonFile<ZenmeLocalSettings>(getLocalSettingsPath(dataDir), {
    defaultValue: defaults,
    normalize: (value) => normalizeLocalSettings(value, defaults),
  });
}

export async function updateLocalSettings(
  updates: Partial<Omit<ZenmeLocalSettings, "version">>,
  dataDir = getZenmeDataDir(),
) {
  const current = await getLocalSettings(dataDir);
  const next = normalizeLocalSettings(
    {
      ...current,
      ...updates,
      version: 1,
      dataDir: updates.dataDir ?? current.dataDir,
    },
    createDefaultLocalSettings(dataDir),
  );
  await writeJsonFile(getLocalSettingsPath(dataDir), next);
  return next;
}

function normalizeLocalSettings(
  value: unknown,
  defaults: ZenmeLocalSettings,
): ZenmeLocalSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }

  const settings = value as Partial<ZenmeLocalSettings>;
  return {
    version: 1,
    dataDir: typeof settings.dataDir === "string" && settings.dataDir.trim()
      ? settings.dataDir
      : defaults.dataDir,
    autoSaveIntervalMs:
      typeof settings.autoSaveIntervalMs === "number" &&
      Number.isFinite(settings.autoSaveIntervalMs)
        ? Math.min(300_000, Math.max(5_000, Math.floor(settings.autoSaveIntervalMs)))
        : defaults.autoSaveIntervalMs,
    lastTextModelId:
      typeof settings.lastTextModelId === "string" ? settings.lastTextModelId : undefined,
    lastImageModelId:
      typeof settings.lastImageModelId === "string" ? settings.lastImageModelId : undefined,
    lastVideoModelId:
      typeof settings.lastVideoModelId === "string" ? settings.lastVideoModelId : undefined,
    lastImageAspectRatio:
      typeof settings.lastImageAspectRatio === "string"
        ? settings.lastImageAspectRatio
        : undefined,
    lastImageQuality:
      typeof settings.lastImageQuality === "string"
        ? settings.lastImageQuality
        : undefined,
    modelProviders: normalizeModelProviders(
      settings.modelProviders,
      defaults.modelProviders,
      normalizeNetworkProxy(
        (settings as Partial<ZenmeLocalSettings> & {
          networkProxy?: unknown;
        }).networkProxy,
        createDefaultNetworkProxy(),
      ),
    ),
  };
}

export function createDefaultNetworkProxy(): NetworkProxyConfig {
  return {
    mode: "environment",
    url: "",
    noProxy: "localhost,127.0.0.1,::1",
  };
}

function normalizeNetworkProxy(
  value: unknown,
  defaults: NetworkProxyConfig,
): NetworkProxyConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaults;
  }
  const proxy = value as Partial<NetworkProxyConfig>;
  const mode =
    proxy.mode === "custom" ||
    proxy.mode === "direct" ||
    proxy.mode === "environment"
      ? proxy.mode
      : defaults.mode;
  const rawUrl = typeof proxy.url === "string" ? proxy.url.trim() : "";
  let url = "";
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        url = parsed.toString().replace(/\/$/, "");
      }
    } catch {
      url = "";
    }
  }
  return {
    mode,
    url,
    noProxy:
      typeof proxy.noProxy === "string"
        ? proxy.noProxy.slice(0, 2_000)
        : defaults.noProxy,
  };
}

function createDefaultModelProviders(): ModelProviderConfig[] {
  return [];
}

// ChatGPT OAuth 的模型清单会随账户订阅变化；仅将已由 Responses
// image_generation 工具支持的模型标记为候选，最终仍以同步清单为准。
export const CHATGPT_IMAGE_MODEL_IDS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4-mini",
]);

function normalizeModelProviders(
  value: unknown,
  defaults: ModelProviderConfig[],
  legacyNetworkProxy: NetworkProxyConfig,
): ModelProviderConfig[] {
  if (!Array.isArray(value)) {
    return defaults;
  }

  const providers = value
    .map((provider) => normalizeModelProvider(provider, legacyNetworkProxy))
    .filter((provider): provider is ModelProviderConfig => Boolean(provider));

  if (providers.length === 0) {
    return defaults;
  }

  const normalizedProviders = providers.map((provider) =>
    provider.id === CHATGPT_PROVIDER_ID
      ? {
          ...provider,
          name: "ChatGPT",
          note: "通过 ChatGPT 账号使用 Codex 模型",
          baseUrl: "https://chatgpt.com/backend-api/codex",
          apiFormat: "openai_oauth" as const,
          authType: "none" as const,
          apiKey: "",
          models: provider.models.map(withChatGptImageCapability),
          modelModalities: Object.fromEntries(
            provider.models.map((model) => {
              const normalized = withChatGptImageCapability(model);
              return [normalized.id, normalized.modalities];
            }),
          ),
        }
      : provider,
  );
  return normalizedProviders.map((provider) => ({
    ...provider,
    isDefault: false,
  }));
}

function withChatGptImageCapability(model: ModelConfig): ModelConfig {
  if (!CHATGPT_IMAGE_MODEL_IDS.has(model.id) || model.modalities.includes("image")) {
    return model;
  }
  return { ...model, modalities: [...model.modalities, "image"] };
}

function normalizeModelProvider(
  value: unknown,
  fallbackNetworkProxy: NetworkProxyConfig,
): ModelProviderConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const provider = value as Partial<ModelProviderConfig>;
  const id = typeof provider.id === "string" && provider.id.trim()
    ? provider.id
    : crypto.randomUUID();
  const modelMapping =
    provider.modelMapping &&
    typeof provider.modelMapping === "object" &&
    !Array.isArray(provider.modelMapping)
      ? provider.modelMapping
      : { main: "" };
  const legacyImageModel = (modelMapping as Record<string, unknown>).imageEdit;
  const normalizedModelMapping = {
    main: typeof modelMapping.main === "string" ? modelMapping.main : "",
    image: typeof modelMapping.image === "string"
      ? modelMapping.image
      : typeof legacyImageModel === "string"
        ? legacyImageModel
        : "",
    video: typeof modelMapping.video === "string" ? modelMapping.video : "",
  };
  const contextWindows = normalizeContextWindows(provider.contextWindows);
  const modelModalities = normalizeModelModalities(provider.modelModalities);
  let models = normalizeModelConfigs(
    provider.models,
    normalizedModelMapping,
    contextWindows,
    modelModalities,
  );

  const baseUrl =
    typeof provider.baseUrl === "string" ? provider.baseUrl : "";
  const apiFormat = isVolcengineAgentPlanBaseUrl(baseUrl)
    ? "volcengine_agent_plan"
    : isOllamaBaseUrl(baseUrl)
      ? "ollama"
      : normalizeApiFormat(provider.apiFormat);
  const isLegacyAgentPlan =
    apiFormat === "volcengine_agent_plan" &&
    provider.apiFormat !== "volcengine_agent_plan";
  if (isLegacyAgentPlan && models.length === 0) {
    models = createVolcengineAgentPlanProvider().models;
  }
  const agentPlanDefaults = createVolcengineAgentPlanProvider();
  const nextModelMapping = isLegacyAgentPlan
    ? {
        main: normalizedModelMapping.main || agentPlanDefaults.modelMapping.main,
        image: normalizedModelMapping.image || agentPlanDefaults.modelMapping.image,
      }
    : normalizedModelMapping;

  return {
    id,
    name: typeof provider.name === "string" && provider.name.trim()
      ? provider.name
      : "未命名服务商",
    note: typeof provider.note === "string" ? provider.note : "",
    baseUrl,
    apiFormat,
    authType: normalizeAuthType(provider.authType),
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
    enabled: provider.enabled !== false,
    isDefault: false,
    modelMapping: {
      ...nextModelMapping,
    },
    models,
    contextWindows: normalizeContextWindowsFromModels(contextWindows, models),
    modelModalities: normalizeModelModalitiesFromModels(modelModalities, models),
    networkProxy: normalizeNetworkProxy(
      provider.networkProxy,
      fallbackNetworkProxy,
    ),
  };
}

function normalizeApiFormat(value: unknown): ModelProviderApiFormat {
  if (
    value === "openai" ||
    value === "openai_oauth" ||
    value === "anthropic" ||
    value === "openrouter" ||
    value === "ollama" ||
    value === "volcengine_agent_plan" ||
    value === "zhipu" ||
    value === "custom"
  ) {
    return value;
  }
  return "openai";
}

function isVolcengineAgentPlanBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.hostname.toLowerCase() === "ark.cn-beijing.volces.com" &&
      /^\/api\/plan(?:\/v3)?\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isOllamaBaseUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "11434" &&
      /^\/v1\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function normalizeAuthType(value: unknown): ModelProviderAuthType {
  if (value === "bearer" || value === "api-key" || value === "none") {
    return value;
  }
  return "bearer";
}

function normalizeContextWindows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, count]) => {
      if (typeof count !== "number" || !Number.isFinite(count)) {
        return [];
      }

      return [[key, Math.max(1, Math.floor(count))]];
    }),
  );
}

function normalizeModelModalities(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([model, modalities]) => [
      model,
      Array.isArray(modalities)
        ? modalities.filter(isModelModality)
        : [],
    ]),
  );
}

function normalizeModelModalityList(value: unknown) {
  const modalities = Array.isArray(value)
    ? value.filter(isModelModality)
    : [];
  return modalities.length > 0 ? modalities : ["text" as const];
}

function normalizeModelConfigs(
  value: unknown,
  modelMapping: Partial<ModelProviderConfig["modelMapping"]>,
  contextWindows: Record<string, number>,
  modelModalities: Record<string, ModelModality[]>,
): ModelConfig[] {
  const models = Array.isArray(value)
    ? value
        .map((item) => normalizeModelConfig(item))
        .filter((item): item is ModelConfig => Boolean(item))
    : [];

  const byId = new Map<string, ModelConfig>();
  for (const model of models) {
    byId.set(model.id, model);
  }

  for (const [mappingKey, modelId] of Object.entries(modelMapping)) {
    const id = modelId?.trim();
    if (!id || byId.has(id)) {
      continue;
    }

    byId.set(id, {
      id,
      alias: "",
      enabled: true,
      contextWindow: contextWindows[id],
      modalities:
        modelModalities[id] ??
        (mappingKey === "image" ? ["image", "vision"] : ["text"]),
    });
  }

  for (const [id, modalities] of Object.entries(modelModalities)) {
    if (!id.trim() || byId.has(id)) {
      continue;
    }

    byId.set(id, {
      id,
      alias: "",
      enabled: true,
      contextWindow: contextWindows[id],
      modalities,
    });
  }

  return Array.from(byId.values());
}

function normalizeModelConfig(value: unknown): ModelConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const item = value as Partial<ModelConfig>;
  const id = typeof item.id === "string" ? item.id.trim() : "";
  if (!id) {
    return null;
  }

  const contextWindow =
    typeof item.contextWindow === "number" && Number.isFinite(item.contextWindow)
      ? Math.max(0, Math.floor(item.contextWindow))
      : undefined;

  return {
    id,
    alias: typeof item.alias === "string" ? item.alias : "",
    enabled: item.enabled !== false,
    contextWindow,
    modalities: normalizeModelModalityList(item.modalities),
  };
}

function normalizeContextWindowsFromModels(
  contextWindows: Record<string, number>,
  models: ModelConfig[],
) {
  const next = { ...contextWindows };
  for (const model of models) {
    if (typeof model.contextWindow === "number") {
      next[model.id] = model.contextWindow;
    }
  }
  return next;
}

function normalizeModelModalitiesFromModels(
  modelModalities: Record<string, ModelModality[]>,
  models: ModelConfig[],
) {
  const next = { ...modelModalities };
  for (const model of models) {
    next[model.id] = model.modalities;
  }
  return next;
}

export function getEnabledProviderModels(
  provider: ModelProviderConfig,
  modality?: ModelModality,
) {
  return provider.models.filter((model) => {
    if (!model.enabled) {
      return false;
    }
    if (!modality) {
      return true;
    }
    return model.modalities.includes(modality);
  });
}

function isModelModality(value: unknown): value is ModelModality {
  return (
    value === "text" ||
    value === "vision" ||
    value === "image" ||
    value === "embedding" ||
    value === "audio" ||
    value === "video" ||
    value === "rerank" ||
    value === "tool"
  );
}
