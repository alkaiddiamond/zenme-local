import { getZenmeDataDir } from "@/lib/local/data-dir";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { resolveInside } from "@/lib/local/path-safety";

export type ZenmeLocalSettings = {
  version: 1;
  dataDir: string;
  theme: "light" | "dark" | "system";
  language: "zh-CN" | "en-US";
  recentProjectIds: string[];
  autoSaveIntervalMs: number;
  enableSnapshotHistory: boolean;
  enableCloudSyncExperimental: boolean;
  modelProviders: ModelProviderConfig[];
};

export type ModelProviderApiFormat =
  | "openai"
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
  enableToolSearch: boolean;
  disableExperimentalBetas: boolean;
  modelMapping: {
    main: string;
    haiku?: string;
    sonnet?: string;
    opus?: string;
    imageEdit?: string;
  };
  models: ModelConfig[];
  contextWindows: Record<string, number>;
  modelModalities: Record<string, ModelModality[]>;
  settingsJson?: string;
};

export function createDefaultLocalSettings(dataDir = getZenmeDataDir()): ZenmeLocalSettings {
  return {
    version: 1,
    dataDir,
    theme: "system",
    language: "zh-CN",
    recentProjectIds: [],
    autoSaveIntervalMs: 30_000,
    enableSnapshotHistory: false,
    enableCloudSyncExperimental: false,
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
    theme: normalizeTheme(settings.theme, defaults.theme),
    language: settings.language === "en-US" ? "en-US" : "zh-CN",
    recentProjectIds: Array.isArray(settings.recentProjectIds)
      ? settings.recentProjectIds.filter((id): id is string => typeof id === "string")
      : [],
    autoSaveIntervalMs:
      typeof settings.autoSaveIntervalMs === "number" &&
      Number.isFinite(settings.autoSaveIntervalMs)
        ? Math.min(300_000, Math.max(5_000, Math.floor(settings.autoSaveIntervalMs)))
        : defaults.autoSaveIntervalMs,
    enableSnapshotHistory: Boolean(settings.enableSnapshotHistory),
    enableCloudSyncExperimental: Boolean(settings.enableCloudSyncExperimental),
    modelProviders: normalizeModelProviders(
      settings.modelProviders,
      defaults.modelProviders,
    ),
  };
}

function normalizeTheme(
  value: unknown,
  fallback: ZenmeLocalSettings["theme"],
): ZenmeLocalSettings["theme"] {
  if (value === "light" || value === "dark" || value === "system") {
    return value;
  }
  return fallback;
}

function createDefaultModelProviders(): ModelProviderConfig[] {
  const zhipuApiKey = process.env.ZHIPU_API_KEY?.trim();
  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();

  return [
    {
      id: "zhipu-glm",
      name: "Zhipu GLM",
      note: "智谱 GLM，默认文本模型服务商",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiFormat: "zhipu",
      authType: "bearer",
      apiKey: zhipuApiKey,
      enabled: true,
      isDefault: true,
      enableToolSearch: false,
      disableExperimentalBetas: false,
      modelMapping: {
        main: "glm-4.5",
        haiku: "glm-4.5-air",
        sonnet: "glm-5-turbo",
        opus: "glm-5.2",
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
      enableToolSearch: false,
      disableExperimentalBetas: false,
      modelMapping: {
        imageEdit: "google/gemini-3.1-flash-image-preview",
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

  return ensureSingleDefaultProvider(providers);
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
  const contextWindows = normalizeContextWindows(provider.contextWindows);
  const modelModalities = normalizeModelModalities(provider.modelModalities);
  const models = normalizeModelConfigs(
    provider.models,
    modelMapping,
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
    isDefault: Boolean(provider.isDefault),
    enableToolSearch: Boolean(provider.enableToolSearch),
    disableExperimentalBetas: Boolean(provider.disableExperimentalBetas),
    modelMapping: {
      main:
        typeof modelMapping.main === "string" ? modelMapping.main : "",
      haiku:
        typeof modelMapping.haiku === "string" ? modelMapping.haiku : "",
      sonnet:
        typeof modelMapping.sonnet === "string" ? modelMapping.sonnet : "",
      opus:
        typeof modelMapping.opus === "string" ? modelMapping.opus : "",
      imageEdit:
        typeof modelMapping.imageEdit === "string"
          ? modelMapping.imageEdit
          : "",
    },
    models,
    contextWindows: normalizeContextWindowsFromModels(contextWindows, models),
    modelModalities: normalizeModelModalitiesFromModels(modelModalities, models),
    settingsJson:
      typeof provider.settingsJson === "string" ? provider.settingsJson : "",
  };
}

function ensureSingleDefaultProvider(providers: ModelProviderConfig[]) {
  const defaultIndex = providers.findIndex((provider) => provider.isDefault);
  if (defaultIndex === -1) {
    return providers.map((provider, index) => ({
      ...provider,
      isDefault: index === 0,
    }));
  }

  return providers.map((provider, index) => ({
    ...provider,
    isDefault: index === defaultIndex,
  }));
}

function normalizeApiFormat(value: unknown): ModelProviderApiFormat {
  if (
    value === "openai" ||
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
        (mappingKey === "imageEdit" ? ["image", "vision"] : ["text"]),
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
