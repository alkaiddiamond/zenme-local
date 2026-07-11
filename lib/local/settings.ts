import { getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { resolveInside } from "@/lib/local/path-safety";

export type ZenmeLocalSettings = {
  version: 1;
  dataDir: string;
  autoSaveIntervalMs: number;
  lastTextModelId?: string;
  lastImageModelId?: string;
  lastImageAspectRatio?: string;
  lastImageQuality?: string;
  modelProviders: ModelProviderConfig[];
};

export type ModelProviderApiFormat =
  | "openai"
  | "openai_oauth"
  | "anthropic"
  | "openrouter"
  | "zhipu"
  | "custom";

export type ModelProviderAuthType = "bearer" | "api-key" | "none";

export type ModelModality =
  | "text"
  | "vision"
  | "image"
  | "embedding"
  | "audio"
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
  };
  models: ModelConfig[];
  contextWindows: Record<string, number>;
  modelModalities: Record<string, ModelModality[]>;
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
    ),
  };
}

function createDefaultModelProviders(): ModelProviderConfig[] {
  const zhipuApiKey = process.env.ZHIPU_API_KEY?.trim();
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  return [
    createChatGptProvider(),
    {
      id: "zhipu-glm",
      name: "Zhipu GLM",
      note: "智谱 GLM 文本模型服务商",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiFormat: "zhipu",
      authType: "bearer",
      apiKey: zhipuApiKey,
      enabled: true,
      isDefault: false,
      modelMapping: {
        main: "glm-4.5",
      },
      models: [
        { id: "glm-4.5", alias: "GLM 4.5", enabled: true, contextWindow: 128_000, modalities: ["text", "tool"] },
        { id: "glm-4.5-air", alias: "GLM 4.5 Air", enabled: true, contextWindow: 128_000, modalities: ["text"] },
        { id: "glm-5-turbo", alias: "GLM 5 Turbo", enabled: true, contextWindow: 200_000, modalities: ["text", "tool"] },
        { id: "glm-5.2", alias: "GLM 5.2", enabled: true, contextWindow: 1_000_000, modalities: ["text", "vision", "tool"] },
      ],
      contextWindows: {
        "glm-4.5": 128_000,
        "glm-4.5-air": 128_000,
        "glm-5-turbo": 200_000,
        "glm-5.2": 1_000_000,
      },
      modelModalities: {
        "glm-4.5": ["text", "tool"],
        "glm-4.5-air": ["text"],
        "glm-5-turbo": ["text", "tool"],
        "glm-5.2": ["text", "vision", "tool"],
      },
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      note: "用于图片编辑和多模态模型",
      baseUrl: "https://openrouter.ai/api/v1",
      apiFormat: "openrouter",
      authType: "bearer",
      apiKey: openRouterApiKey,
      enabled: true,
      isDefault: false,
      modelMapping: {
        image: "google/gemini-3.1-flash-image-preview",
        main: "",
      },
      models: [
        {
          id: "google/gemini-3.1-flash-image-preview",
          alias: "Nano Banana 2",
          enabled: true,
          contextWindow: 128_000,
          modalities: ["image", "vision"],
        },
      ],
      contextWindows: {
        "google/gemini-3.1-flash-image-preview": 128_000,
      },
      modelModalities: {
        "google/gemini-3.1-flash-image-preview": ["image", "vision"],
      },
    },
  ];
}

export const CHATGPT_PROVIDER_ID = "chatgpt-official";
export const CHATGPT_IMAGE_MODEL_IDS = new Set(["gpt-5.6-sol"]);

export function createChatGptProvider(): ModelProviderConfig {
  return {
    id: CHATGPT_PROVIDER_ID,
    name: "ChatGPT",
    note: "通过 ChatGPT 账号使用 Codex 模型",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    apiFormat: "openai_oauth",
    authType: "none",
    enabled: true,
    isDefault: false,
    modelMapping: { main: "" },
    models: [],
    contextWindows: {},
    modelModalities: {},
  };
}

function normalizeModelProviders(
  value: unknown,
  defaults: ModelProviderConfig[],
): ModelProviderConfig[] {
  if (!Array.isArray(value)) {
    return defaults;
  }

  const providers = value
    .map(normalizeModelProvider)
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
  const hasChatGpt = normalizedProviders.some((provider) => provider.id === CHATGPT_PROVIDER_ID);
  return (hasChatGpt ? normalizedProviders : [createChatGptProvider(), ...normalizedProviders])
    .map((provider) => ({ ...provider, isDefault: false }));
}

function withChatGptImageCapability(model: ModelConfig): ModelConfig {
  if (!CHATGPT_IMAGE_MODEL_IDS.has(model.id) || model.modalities.includes("image")) {
    return model;
  }
  return { ...model, modalities: [...model.modalities, "image"] };
}

function normalizeModelProvider(value: unknown): ModelProviderConfig | null {
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
  };
  const contextWindows = normalizeContextWindows(provider.contextWindows);
  const modelModalities = normalizeModelModalities(provider.modelModalities);
  const models = normalizeModelConfigs(
    provider.models,
    normalizedModelMapping,
    contextWindows,
    modelModalities,
  );

  return {
    id,
    name: typeof provider.name === "string" && provider.name.trim()
      ? provider.name
      : "未命名服务商",
    note: typeof provider.note === "string" ? provider.note : "",
    baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : "",
    apiFormat: normalizeApiFormat(provider.apiFormat),
    authType: normalizeAuthType(provider.authType),
    apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
    enabled: provider.enabled !== false,
    isDefault: false,
    modelMapping: {
      ...normalizedModelMapping,
    },
    models,
    contextWindows: normalizeContextWindowsFromModels(contextWindows, models),
    modelModalities: normalizeModelModalitiesFromModels(modelModalities, models),
  };
}

function normalizeApiFormat(value: unknown): ModelProviderApiFormat {
  if (
    value === "openai" ||
    value === "openai_oauth" ||
    value === "anthropic" ||
    value === "openrouter" ||
    value === "zhipu" ||
    value === "custom"
  ) {
    return value;
  }
  return "openai";
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
    value === "rerank" ||
    value === "tool"
  );
}
