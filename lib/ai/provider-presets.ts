import type {
  ModelConfig,
  ModelProviderConfig,
} from "@/lib/local/settings";

export const VOLCENGINE_AGENT_PLAN_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/plan";
export const VOLCENGINE_AGENT_PLAN_PROVIDER_ID = "volcengine-agent-plan";
export const CHATGPT_PROVIDER_ID = "chatgpt-official";

export type ModelProviderPresetId =
  | "chatgpt"
  | "zhipu"
  | "volcengine_agent_plan"
  | "volcengine_ark"
  | "openrouter"
  | "ollama"
  | "custom";

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
    networkProxy: createProviderNetworkProxy(),
  };
}

const VOLCENGINE_AGENT_PLAN_MODELS: ModelConfig[] = [
  { id: "ark-code-latest", alias: "Ark Code Latest", enabled: true, modalities: ["text", "tool"] },
  { id: "doubao-seed-2.0-code", alias: "Doubao Seed 2.0 Code", enabled: true, modalities: ["text", "tool"] },
  { id: "doubao-seed-2.0-pro", alias: "Doubao Seed 2.0 Pro", enabled: true, modalities: ["text", "vision", "tool"] },
  { id: "doubao-seed-2.0-lite", alias: "Doubao Seed 2.0 Lite", enabled: true, modalities: ["text", "tool"] },
  { id: "doubao-seed-2.0-mini", alias: "Doubao Seed 2.0 Mini", enabled: true, modalities: ["text"] },
  { id: "glm-5.2", alias: "GLM 5.2（Agent Plan）", enabled: true, modalities: ["text", "tool"] },
  { id: "kimi-k2.7-code", alias: "Kimi K2.7 Code", enabled: true, modalities: ["text", "tool"] },
  { id: "deepseek-v4-pro", alias: "DeepSeek V4 Pro", enabled: true, modalities: ["text", "tool"] },
  { id: "deepseek-v4-flash", alias: "DeepSeek V4 Flash", enabled: true, modalities: ["text", "tool"] },
  { id: "minimax-m3", alias: "MiniMax M3", enabled: true, modalities: ["text", "tool"] },
  { id: "minimax-m2.7", alias: "MiniMax M2.7", enabled: true, modalities: ["text", "tool"] },
  { id: "kimi-k2.6", alias: "Kimi K2.6", enabled: true, modalities: ["text", "tool"] },
  { id: "doubao-seed-evolving", alias: "Doubao Seed Evolving", enabled: true, modalities: ["text", "tool"] },
  { id: "kimi-k3", alias: "Kimi K3", enabled: true, modalities: ["text", "tool"] },
  { id: "doubao-embedding-vision", alias: "Doubao Embedding Vision", enabled: true, modalities: ["embedding", "vision"] },
  { id: "doubao-seedream-5.0-lite", alias: "Doubao Seedream 5.0 Lite", enabled: true, modalities: ["image"] },
];

export function createVolcengineAgentPlanProvider(): ModelProviderConfig {
  const models = VOLCENGINE_AGENT_PLAN_MODELS.map((model) => ({
    ...model,
    modalities: [...model.modalities],
  }));
  return {
    id: VOLCENGINE_AGENT_PLAN_PROVIDER_ID,
    name: "火山方舟 Agent Plan",
    note: "Agent Plan 个人版；语言模型使用 Responses API，图片使用 Seedream",
    baseUrl: VOLCENGINE_AGENT_PLAN_BASE_URL,
    apiFormat: "volcengine_agent_plan",
    authType: "bearer",
    apiKey: "",
    enabled: true,
    isDefault: false,
    modelMapping: {
      main: "doubao-seed-2.0-pro",
      image: "doubao-seedream-5.0-lite",
    },
    models,
    contextWindows: {},
    modelModalities: Object.fromEntries(
      models.map((model) => [model.id, model.modalities]),
    ),
    networkProxy: createProviderNetworkProxy(),
  };
}

export function createVolcengineArkProvider(): ModelProviderConfig {
  const models: ModelConfig[] = [
    { id: "doubao-seedance-2-0-260128", alias: "Doubao Seedance 2.0", enabled: true, modalities: ["video", "vision", "audio"] },
    { id: "doubao-seedance-2-0-fast-260128", alias: "Doubao Seedance 2.0 Fast", enabled: true, modalities: ["video", "vision", "audio"] },
  ];
  return {
    id: "volcengine-ark",
    name: "火山方舟在线推理",
    note: "Seedance 视频生成 API",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiFormat: "custom",
    authType: "bearer",
    apiKey: "",
    enabled: true,
    isDefault: false,
    modelMapping: { main: "", image: "", video: models[0].id },
    models,
    contextWindows: {},
    modelModalities: Object.fromEntries(models.map((model) => [model.id, model.modalities])),
    networkProxy: createProviderNetworkProxy(),
  };
}

export function createZhipuProvider(apiKey = ""): ModelProviderConfig {
  const models: ModelConfig[] = [
    { id: "glm-4.5", alias: "GLM 4.5", enabled: true, contextWindow: 128_000, modalities: ["text", "tool"] },
    { id: "glm-4.5-air", alias: "GLM 4.5 Air", enabled: true, contextWindow: 128_000, modalities: ["text"] },
    { id: "glm-5-turbo", alias: "GLM 5 Turbo", enabled: true, contextWindow: 200_000, modalities: ["text", "tool"] },
    { id: "glm-5.2", alias: "GLM 5.2", enabled: true, contextWindow: 1_000_000, modalities: ["text", "vision", "tool"] },
  ];
  return {
    id: "zhipu-glm",
    name: "Zhipu GLM",
    note: "智谱 GLM 文本模型服务商",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "zhipu",
    authType: "bearer",
    apiKey,
    enabled: true,
    isDefault: false,
    modelMapping: { main: "glm-4.5" },
    models,
    contextWindows: Object.fromEntries(
      models.flatMap((model) =>
        model.contextWindow ? [[model.id, model.contextWindow]] : [],
      ),
    ),
    modelModalities: Object.fromEntries(
      models.map((model) => [model.id, model.modalities]),
    ),
    networkProxy: createProviderNetworkProxy(),
  };
}

export function createOpenRouterProvider(apiKey = ""): ModelProviderConfig {
  const model: ModelConfig = {
    id: "google/gemini-3.1-flash-image-preview",
    alias: "Nano Banana 2",
    enabled: true,
    contextWindow: 128_000,
    modalities: ["image", "vision"],
  };
  return {
    id: "openrouter",
    name: "OpenRouter",
    note: "用于图片编辑和多模态模型",
    baseUrl: "https://openrouter.ai/api/v1",
    apiFormat: "openrouter",
    authType: "bearer",
    apiKey,
    enabled: true,
    isDefault: false,
    modelMapping: {
      image: model.id,
      main: "",
    },
    models: [model],
    contextWindows: { [model.id]: model.contextWindow! },
    modelModalities: { [model.id]: model.modalities },
    networkProxy: createProviderNetworkProxy(),
  };
}

export function createOllamaProvider(): ModelProviderConfig {
  return {
    id: "ollama-local",
    name: "Ollama",
    note: "通过本机 Ollama 的 OpenAI 兼容接口使用本地模型",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiFormat: "ollama",
    authType: "none",
    apiKey: "",
    enabled: true,
    isDefault: false,
    modelMapping: { main: "" },
    models: [],
    contextWindows: {},
    modelModalities: {},
    networkProxy: createProviderNetworkProxy(),
  };
}

export function createCustomProvider(): ModelProviderConfig {
  return {
    id: `custom-${crypto.randomUUID()}`,
    name: "自定义服务商",
    note: "通用 OpenAI 或 Anthropic 兼容接口",
    baseUrl: "",
    apiFormat: "openai",
    authType: "bearer",
    apiKey: "",
    enabled: true,
    isDefault: false,
    modelMapping: {
      main: "",
      image: "",
    },
    models: [],
    contextWindows: {},
    modelModalities: {},
    networkProxy: createProviderNetworkProxy(),
  };
}

function createProviderNetworkProxy() {
  return {
    mode: "environment" as const,
    url: "",
    noProxy: "localhost,127.0.0.1,::1",
  };
}

export function createModelProviderPreset(
  preset: ModelProviderPresetId,
): ModelProviderConfig {
  if (preset === "chatgpt") return createChatGptProvider();
  if (preset === "zhipu") return createZhipuProvider();
  if (preset === "volcengine_agent_plan") {
    return createVolcengineAgentPlanProvider();
  }
  if (preset === "volcengine_ark") return createVolcengineArkProvider();
  if (preset === "openrouter") return createOpenRouterProvider();
  if (preset === "ollama") return createOllamaProvider();
  return createCustomProvider();
}

export function identifyModelProviderPreset(
  provider: ModelProviderConfig,
): ModelProviderPresetId {
  if (
    provider.apiFormat === "openai_oauth" ||
    provider.id === CHATGPT_PROVIDER_ID
  ) {
    return "chatgpt";
  }
  if (provider.apiFormat === "zhipu" || provider.id === "zhipu-glm") {
    return "zhipu";
  }
  if (
    provider.apiFormat === "volcengine_agent_plan" ||
    /ark\.cn-beijing\.volces\.com\/api\/plan/i.test(provider.baseUrl)
  ) {
    return "volcengine_agent_plan";
  }
  if (/ark\.cn-beijing\.volces\.com\/api\/v3\/?$/i.test(provider.baseUrl)) {
    return "volcengine_ark";
  }
  if (provider.apiFormat === "openrouter" || provider.id === "openrouter") {
    return "openrouter";
  }
  if (provider.apiFormat === "ollama" || provider.id === "ollama-local") {
    return "ollama";
  }
  return "custom";
}
