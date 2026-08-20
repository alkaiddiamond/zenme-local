"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChartNoAxesColumn,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  ImageIcon,
  Monitor,
  Moon,
  LogIn,
  LogOut,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Server,
  Settings2,
  SlidersHorizontal,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";
import type {
  ModelModality,
  ModelProviderApiFormat,
  ModelProviderAuthType,
  ModelProviderConfig,
  McpServerConfig,
  NetworkProxyConfig,
  ZenmeLocalSettings,
  ZenmeTheme,
  ZenmeSessionPermissionMode,
  ZenmeModelSpeed,
  ZenmeReasoningEffort,
} from "@/lib/local/settings";
import { announceThemePreference } from "@/components/zenme/theme-controller";
import {
  createModelProviderPreset,
  identifyModelProviderPreset,
  type ModelProviderPresetId,
} from "@/lib/ai/provider-presets";
import { rememberAiModelPreference, useAiModelOptions } from "@/components/zenme/use-ai-model-options";

type SettingsPayload = {
  mode: "local";
  settings: ZenmeLocalSettings;
};

type ZenmeDesktopApi = {
  getDataDir: () => Promise<string>;
  openDataDir: () => Promise<string>;
  openExternal: (url: string) => Promise<boolean>;
  selectDataDir: () => Promise<{
    canceled: boolean;
    dataDir: string;
    restarted: boolean;
  }>;
};

type SettingsTab = "general" | "models" | "mcp" | "plugins" | "usage" | "local" | "save";

type AgentPluginField = {
  description?: string;
  default?: unknown;
  max?: number;
  min?: number;
  multiple?: boolean;
  required?: boolean;
  sensitive?: boolean;
  title?: string;
  type: "string" | "number" | "boolean" | "directory" | "file";
};

type AgentPluginConfiguration = {
  configuredKeys: string[];
  id: string;
  kind: "plugin" | "mcpServer";
  label: string;
  missing: string[];
  schema: Record<string, AgentPluginField>;
  values: Record<string, string | number | boolean | string[]>;
};

type AgentPlugin = {
  configurations: AgentPluginConfiguration[];
  errors: Array<{ source: string; error: string }>;
  id: string;
  name: string;
};

type TokenUsagePayload = {
  summary: {
    totalTokens: number;
    trackedDays: number;
    peakDailyTokens: number;
    peakDate: string | null;
    longestRequestMs: number;
    longestRequestMessages: number;
    currentStreak: number;
    longestStreak: number;
    currentDayTokens: number;
    totalRequests: number;
    activityRate: number;
    textRequests: number;
    imageRequests: number;
  };
  daily: Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number; requests: number }>;
  models: Array<{ modelId: string; providerName: string; totalTokens: number; requests: number }>;
  providers: Array<{ providerName: string; totalTokens: number; requests: number }>;
};

type ChatGptAuthStatus = {
  loggedIn: boolean;
  email: string | null;
  accountId: string | null;
  modelCount: number;
  error: string | null;
  modelSyncError: string | null;
  modelSyncing: boolean;
};

const API_FORMAT_OPTIONS: Array<{
  label: string;
  value: ModelProviderApiFormat;
}> = [
  { label: "OpenAI Chat Completions", value: "openai" },
  { label: "Anthropic Messages", value: "anthropic" },
  { label: "OpenRouter Images / Chat", value: "openrouter" },
  { label: "火山方舟 Agent Plan", value: "volcengine_agent_plan" },
  { label: "Zhipu GLM", value: "zhipu" },
  { label: "Ollama（本机）", value: "ollama" },
  { label: "自定义", value: "custom" },
];

const CUSTOM_PROVIDER_API_FORMAT_OPTIONS = API_FORMAT_OPTIONS.filter((option) =>
  ["openai", "anthropic"].includes(option.value),
);

const CUSTOM_PROVIDER_PRESET_OPTIONS: Array<{
  label: string;
  value: Extract<
    ModelProviderPresetId,
    "zhipu" | "volcengine_agent_plan" | "volcengine_ark" | "openrouter" | "custom"
  >;
}> = [
  { label: "智谱 GLM", value: "zhipu" },
  { label: "火山方舟 Agent Plan", value: "volcengine_agent_plan" },
  { label: "火山方舟在线推理", value: "volcengine_ark" },
  { label: "OpenRouter", value: "openrouter" },
  { label: "自定义", value: "custom" },
];

const MODEL_PROVIDER_PRESET_OPTIONS: Array<{
  description: string;
  label: string;
  value: ModelProviderPresetId;
}> = [
  {
    description: "通过 ChatGPT 账号使用 Codex 模型",
    label: "ChatGPT",
    value: "chatgpt",
  },
  {
    description: "连接本机运行的开源模型",
    label: "Ollama",
    value: "ollama",
  },
  {
    description: "兼容 OpenAI 或 Anthropic 协议接口",
    label: "自定义",
    value: "custom",
  },
];

const AUTH_TYPE_OPTIONS: Array<{
  label: string;
  value: ModelProviderAuthType;
}> = [
  { label: "Bearer Token", value: "bearer" },
  { label: "API Key Header", value: "api-key" },
  { label: "无需认证", value: "none" },
];

const NETWORK_PROXY_MODE_OPTIONS: Array<{
  label: string;
  value: NetworkProxyConfig["mode"];
}> = [
  { label: "跟随环境变量", value: "environment" },
  { label: "自定义代理", value: "custom" },
  { label: "始终直连", value: "direct" },
];

const MODALITY_OPTIONS: Array<{
  description: string;
  label: string;
  value: ModelModality;
}> = [
  { description: "普通对话、写作、总结、代码", label: "文本", value: "text" },
  { description: "可理解图片输入", label: "视觉", value: "vision" },
  { description: "可生成或编辑图片", label: "图片", value: "image" },
  { description: "向量检索", label: "向量", value: "embedding" },
  { description: "语音输入输出", label: "音频", value: "audio" },
  { description: "可生成视频", label: "视频", value: "video" },
  { description: "排序模型", label: "排序", value: "rerank" },
  { description: "支持工具调用", label: "工具", value: "tool" },
];

declare global {
  interface Window {
    zenmeDesktop?: ZenmeDesktopApi;
  }
}

export function SettingsClient() {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [desktopDataDir, setDesktopDataDir] = useState("");
  const [isDesktop, setIsDesktop] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [autoSaveIntervalMs, setAutoSaveIntervalMs] = useState(5_000);
  const [theme, setTheme] = useState<ZenmeTheme>("light");
  const [defaultSessionPermissionMode, setDefaultSessionPermissionMode] =
    useState<ZenmeSessionPermissionMode>("onRequest");
  const [, setThinkingEnabled] = useState(true);
  const [defaultReasoningEffort, setDefaultReasoningEffort] = useState<ZenmeReasoningEffort>("low");
  const [defaultModelSpeed, setDefaultModelSpeed] = useState<ZenmeModelSpeed>("standard");
  const [lastTextModelId, setLastTextModelId] = useState("");
  const [autoDreamEnabled, setAutoDreamEnabled] = useState(false);
  const [showAutoDreamConfirmation, setShowAutoDreamConfirmation] = useState(false);
  const [modelProviders, setModelProviders] = useState<ModelProviderConfig[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [editingProvider, setEditingProvider] = useState<ModelProviderConfig | null>(null);
  const [isCreatingProvider, setIsCreatingProvider] = useState(false);
  const [editingProxyProvider, setEditingProxyProvider] =
    useState<ModelProviderConfig | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [restoreState, setRestoreState] = useState<"idle" | "restoring" | "done" | "failed">("idle");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [directoryState, setDirectoryState] = useState<"idle" | "choosing" | "opening" | "failed">("idle");
  const [chatGptStatus, setChatGptStatus] = useState<ChatGptAuthStatus | null>(null);
  const [chatGptAction, setChatGptAction] = useState<"idle" | "login" | "sync" | "logout" | "failed">("idle");
  const [chatGptMessage, setChatGptMessage] = useState("");
  const syncChatGptModelsRef = useRef<() => Promise<void>>(async () => undefined);
  const textModelOptions = useAiModelOptions();

  async function loadChatGptStatus() {
    const response = await fetch("/api/ai/openai-oauth/status", { cache: "no-store" });
    if (!response.ok) return null;
    const status = await response.json() as ChatGptAuthStatus;
    setChatGptStatus(status);
    return status;
  }

  async function reloadSettings() {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) return;
    const nextPayload = await response.json() as SettingsPayload;
    setPayload(nextPayload);
    setModelProviders(nextPayload.settings.modelProviders);
    setMcpServers(nextPayload.settings.mcpServers);
  }

  useEffect(() => {
    async function loadSettings() {
      setIsDesktop(Boolean(window.zenmeDesktop));
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return;
      const nextPayload = await response.json() as SettingsPayload;
      setPayload(nextPayload);
      setAutoSaveIntervalMs(nextPayload.settings.autoSaveIntervalMs);
      setTheme(nextPayload.settings.theme);
      setDefaultSessionPermissionMode(nextPayload.settings.defaultSessionPermissionMode);
      setThinkingEnabled(nextPayload.settings.thinkingEnabled);
      setDefaultReasoningEffort(nextPayload.settings.defaultReasoningEffort);
      setDefaultModelSpeed(nextPayload.settings.defaultModelSpeed);
      setLastTextModelId(nextPayload.settings.lastTextModelId ?? "");
      setAutoDreamEnabled(nextPayload.settings.autoDreamEnabled);
      setModelProviders(nextPayload.settings.modelProviders);
      setMcpServers(nextPayload.settings.mcpServers);
      const status = await loadChatGptStatus();
      if (status?.loggedIn && !status.modelSyncing && status.modelCount === 0) {
        void syncChatGptModelsRef.current();
      }
      const dataDir = await window.zenmeDesktop?.getDataDir();
      setDesktopDataDir(dataDir ?? "");
    }

    void loadSettings();
  }, []);

  async function loginChatGpt() {
    setChatGptAction("login");
    setChatGptMessage("");
    try {
      const response = await fetch("/api/ai/openai-oauth/start", { method: "POST" });
      const result = await response.json() as { authorizeUrl?: string; error?: string };
      if (!response.ok || !result.authorizeUrl) throw new Error(result.error ?? "无法启动 ChatGPT 登录。");
      if (window.zenmeDesktop?.openExternal) {
        await window.zenmeDesktop.openExternal(result.authorizeUrl);
      } else {
        window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
      }
      const startedAt = Date.now();
      const timer = window.setInterval(async () => {
        const status = await loadChatGptStatus();
        if (status?.loggedIn && status.modelSyncing) return;
        if (status?.loggedIn || status?.error || Date.now() - startedAt > 5 * 60_000) {
          window.clearInterval(timer);
          if (status?.loggedIn) {
            if (status.modelCount === 0) {
              await syncChatGptModels();
            } else {
              await reloadSettings();
              setChatGptAction("idle");
            }
          } else {
            setChatGptAction("failed");
          }
          if (!status?.loggedIn) {
            setChatGptMessage(status?.error || "登录等待已超时，请重新发起登录。");
          }
        }
      }, 1800);
    } catch (error) {
      setChatGptMessage(error instanceof Error ? error.message : "无法启动 ChatGPT 登录。");
      setChatGptAction("failed");
    }
  }

  async function syncChatGptModels() {
    setChatGptAction("sync");
    setChatGptMessage("");
    try {
      const response = await fetch("/api/ai/openai-oauth/models", { method: "POST" });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(result?.error ?? "ChatGPT 模型同步失败。");
      }
      await Promise.all([reloadSettings(), loadChatGptStatus()]);
      setChatGptAction("idle");
    } catch (error) {
      setChatGptMessage(error instanceof Error ? error.message : "ChatGPT 模型同步失败。");
      setChatGptAction("failed");
    }
  }
  syncChatGptModelsRef.current = syncChatGptModels;

  async function logoutChatGpt() {
    setChatGptAction("logout");
    const response = await fetch("/api/ai/openai-oauth", { method: "DELETE" });
    if (response.ok) {
      await Promise.all([reloadSettings(), loadChatGptStatus()]);
      setChatGptAction("idle");
    } else {
      setChatGptAction("failed");
    }
  }

  async function saveSettings() {
    await persistSettings({
      autoSaveIntervalMs,
      modelProviders,
    });
  }

  async function persistSettings(updates: {
    autoSaveIntervalMs?: number;
    modelProviders?: ModelProviderConfig[];
    mcpServers?: McpServerConfig[];
    theme?: ZenmeTheme;
    defaultSessionPermissionMode?: ZenmeSessionPermissionMode;
    thinkingEnabled?: boolean;
    defaultReasoningEffort?: ZenmeReasoningEffort;
    defaultModelSpeed?: ZenmeModelSpeed;
    lastTextModelId?: string;
    autoDreamEnabled?: boolean;
  }) {
    setSaveState("saving");
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          autoSaveIntervalMs,
          modelProviders,
          ...updates,
        }),
      });
      if (!response.ok) throw new Error("settings save failed");
      const nextPayload = await response.json() as SettingsPayload;
      setPayload(nextPayload);
      setModelProviders(nextPayload.settings.modelProviders);
      setMcpServers(nextPayload.settings.mcpServers);
      setTheme(nextPayload.settings.theme);
      setDefaultSessionPermissionMode(nextPayload.settings.defaultSessionPermissionMode);
      setThinkingEnabled(nextPayload.settings.thinkingEnabled);
      setDefaultReasoningEffort(nextPayload.settings.defaultReasoningEffort);
      setDefaultModelSpeed(nextPayload.settings.defaultModelSpeed);
      setLastTextModelId(nextPayload.settings.lastTextModelId ?? "");
      setAutoDreamEnabled(nextPayload.settings.autoDreamEnabled);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
      return nextPayload;
    } catch {
      setSaveState("failed");
      return null;
    }
  }

  async function restoreBackup(file: File | undefined) {
    if (!file) return;
    setRestoreState("restoring");
    setRestoreMessage("");

    try {
      const formData = new FormData();
      formData.set("file", file, file.name);
      const response = await fetch("/api/settings/backup", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        restoredFiles?: number;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "恢复失败");
      }
      setRestoreState("done");
      setRestoreMessage(`已恢复 ${payload?.restoredFiles ?? 0} 个文件`);
      window.setTimeout(() => window.location.reload(), 800);
    } catch (error) {
      setRestoreState("failed");
      setRestoreMessage(error instanceof Error ? error.message : "恢复失败");
    }
  }

  async function selectDataDir() {
    if (!window.zenmeDesktop) return;
    setDirectoryState("choosing");
    try {
      const result = await window.zenmeDesktop.selectDataDir();
      if (!result.canceled) {
        setDesktopDataDir(result.dataDir);
        window.location.reload();
      }
      setDirectoryState("idle");
    } catch {
      setDirectoryState("failed");
    }
  }

  async function openDataDir() {
    if (!window.zenmeDesktop) return;
    setDirectoryState("opening");
    try {
      const dataDir = await window.zenmeDesktop.openDataDir();
      setDesktopDataDir(dataDir);
      setDirectoryState("idle");
    } catch {
      setDirectoryState("failed");
    }
  }

  async function upsertProvider(provider: ModelProviderConfig) {
    const exists = modelProviders.some((item) => item.id === provider.id);
    const nextProviders = exists
      ? modelProviders.map((item) => item.id === provider.id ? provider : item)
      : [...modelProviders, provider];

    setModelProviders(nextProviders);
    const nextPayload = await persistSettings({ modelProviders: nextProviders });
    const savedProvider = nextPayload?.settings.modelProviders.find(
      (item) => item.id === provider.id,
    );
    return savedProvider ?? provider;
  }

  function deleteProvider(providerId: string) {
    const nextProviders = modelProviders.filter((provider) => provider.id !== providerId);
    setModelProviders(nextProviders);
    void persistSettings({ modelProviders: nextProviders });
  }

  const settings = payload?.settings;
  const effectiveDataDir = desktopDataDir || settings?.dataDir || "";

  return (
    <div className="min-h-full bg-[var(--color-surface)]">
      <div className="grid min-h-full grid-cols-[240px_1fr]">
        <aside className="border-r border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-6">
          <div className="mb-6 flex items-center gap-3 px-2">
            <Settings2 className="size-6 text-[var(--color-text-secondary)]" />
            <h1 className="text-base font-medium tracking-normal text-[var(--color-text-primary)]">
              设置
            </h1>
          </div>
          <nav className="space-y-1">
            <SettingsNavButton
              active={activeTab === "general"}
              icon={<SlidersHorizontal className="size-5" />}
              label="通用"
              onClick={() => setActiveTab("general")}
            />
            <SettingsNavButton
              active={activeTab === "usage"}
              icon={<ChartNoAxesColumn className="size-5" />}
              label="Token 用量"
              onClick={() => setActiveTab("usage")}
            />
            <SettingsNavButton
              active={activeTab === "models"}
              icon={<Server className="size-5" />}
              label="模型配置"
              onClick={() => setActiveTab("models")}
            />
            <SettingsNavButton
              active={activeTab === "mcp"}
              icon={<Server className="size-5" />}
              label="MCP 工具"
              onClick={() => setActiveTab("mcp")}
            />
            <SettingsNavButton
              active={activeTab === "plugins"}
              icon={<Puzzle className="size-5" />}
              label="Agent 插件"
              onClick={() => setActiveTab("plugins")}
            />
            <SettingsNavButton
              active={activeTab === "local"}
              icon={<HardDrive className="size-5" />}
              label="本地数据"
              onClick={() => setActiveTab("local")}
            />
            <SettingsNavButton
              active={activeTab === "save"}
              icon={<Save className="size-5" />}
              label="保存策略"
              onClick={() => setActiveTab("save")}
            />
          </nav>
          {payload ? (
            <div className="absolute bottom-5 rounded-md px-2 py-1 text-xs text-[var(--color-text-tertiary)]">
              本地模式
            </div>
          ) : null}
        </aside>

        <main className="px-10 py-8">
          {activeTab === "general" ? (
            <GeneralSettings
              autoDreamEnabled={autoDreamEnabled}
              defaultSessionPermissionMode={defaultSessionPermissionMode}
              defaultReasoningEffort={defaultReasoningEffort}
              defaultModelSpeed={defaultModelSpeed}
              lastTextModelId={lastTextModelId || textModelOptions[0]?.id || ""}
              textModelOptions={textModelOptions}
              onChange={(nextTheme) => {
                const previousTheme = theme;
                setTheme(nextTheme);
                announceThemePreference(nextTheme);
                void persistSettings({ theme: nextTheme }).then((saved) => {
                  if (saved) return;
                  setTheme(previousTheme);
                  announceThemePreference(previousTheme);
                });
              }}
              onAutoDreamChange={(enabled) => {
                if (enabled) {
                  setShowAutoDreamConfirmation(true);
                  return;
                }
                setAutoDreamEnabled(false);
                void persistSettings({ autoDreamEnabled: false });
              }}
              onPermissionModeChange={(mode) => {
                setDefaultSessionPermissionMode(mode);
                void persistSettings({ defaultSessionPermissionMode: mode });
              }}
              onReasoningEffortChange={(effort) => {
                setDefaultReasoningEffort(effort);
                setThinkingEnabled(true);
                void persistSettings({ defaultReasoningEffort: effort, thinkingEnabled: true });
              }}
              onModelSpeedChange={(speed) => {
                setDefaultModelSpeed(speed);
                void persistSettings({ defaultModelSpeed: speed });
              }}
              onTextModelChange={(modelId) => {
                setLastTextModelId(modelId);
                void rememberAiModelPreference("text", modelId);
                void persistSettings({ lastTextModelId: modelId });
              }}
              saveState={saveState}
              theme={theme}
            />
          ) : null}
          {activeTab === "models" ? (
            <ModelProviderSettings
              onAddProvider={(preset) => {
                if (preset === "chatgpt") {
                  const existingProvider = modelProviders.find(
                    (provider) => identifyModelProviderPreset(provider) === preset,
                  );
                  if (!existingProvider) {
                    void upsertProvider(createModelProviderPreset(preset));
                  }
                  return;
                }
                const existingProvider =
                  preset === "custom"
                    ? undefined
                    : modelProviders.find(
                        (provider) =>
                          identifyModelProviderPreset(provider) === preset,
                      );
                setIsCreatingProvider(!existingProvider);
                setEditingProvider(existingProvider ?? createModelProviderPreset(preset));
              }}
              onDeleteProvider={deleteProvider}
              onEditProvider={(provider) => {
                setIsCreatingProvider(false);
                setEditingProvider(provider);
              }}
              onEditProxyProvider={setEditingProxyProvider}
              chatGptAction={chatGptAction}
              chatGptMessage={chatGptMessage}
              chatGptStatus={chatGptStatus}
              onLoginChatGpt={loginChatGpt}
              onLogoutChatGpt={logoutChatGpt}
              onSyncChatGptModels={syncChatGptModels}
              providers={modelProviders}
            />
          ) : null}

          {activeTab === "mcp" ? (
            <McpServerSettings
              servers={mcpServers}
              saveState={saveState}
              onChange={(servers) => {
                setMcpServers(servers);
                void persistSettings({ mcpServers: servers });
              }}
            />
          ) : null}

          {activeTab === "plugins" ? <AgentPluginSettings /> : null}

          {activeTab === "local" ? (
            <LocalDataSettings
              directoryState={directoryState}
              effectiveDataDir={effectiveDataDir}
              isDesktop={isDesktop}
              openDataDir={openDataDir}
              restoreBackup={restoreBackup}
              restoreMessage={restoreMessage}
              restoreState={restoreState}
              selectDataDir={selectDataDir}
            />
          ) : null}

          {activeTab === "usage" ? <TokenUsageSettings /> : null}

          {activeTab === "save" ? (
            <SavePolicySettings
              autoSaveIntervalMs={autoSaveIntervalMs}
              saveSettings={saveSettings}
              saveState={saveState}
              setAutoSaveIntervalMs={setAutoSaveIntervalMs}
            />
          ) : null}
        </main>
      </div>

      {editingProvider ? (
        <ProviderEditorModal
          isCreating={isCreatingProvider}
          onClose={() => {
            setEditingProvider(null);
            setIsCreatingProvider(false);
          }}
          onSave={upsertProvider}
          provider={editingProvider}
        />
      ) : null}
      {editingProxyProvider ? (
        <ProviderProxyModal
          onClose={() => setEditingProxyProvider(null)}
          onSave={upsertProvider}
          provider={editingProxyProvider}
        />
      ) : null}
      {showAutoDreamConfirmation ? (
        <AutoDreamConfirmation
          onCancel={() => setShowAutoDreamConfirmation(false)}
          onConfirm={() => {
            setShowAutoDreamConfirmation(false);
            setAutoDreamEnabled(true);
            void persistSettings({ autoDreamEnabled: true });
          }}
        />
      ) : null}
    </div>
  );
}

const THEME_OPTIONS: Array<{
  description: string;
  icon: React.ReactNode;
  label: string;
  value: ZenmeTheme;
}> = [
  {
    description: "明亮、清爽的默认工作界面",
    icon: <Sun className="size-5" />,
    label: "浅色",
    value: "light",
  },
  {
    description: "纯黑工作区与低眩光控件",
    icon: <Moon className="size-5" />,
    label: "黑色",
    value: "dark",
  },
  {
    description: "柔和暖米色，降低长时间阅读的眩光",
    icon: <Eye className="size-5" />,
    label: "护眼",
    value: "warm",
  },
  {
    description: "自动匹配系统外观设置",
    icon: <Monitor className="size-5" />,
    label: "跟随系统",
    value: "system",
  },
];

const PERMISSION_MODE_OPTIONS: Array<{ label: string; description: string; value: ZenmeSessionPermissionMode }> = [
  { value: "untrusted", label: "不可信", description: "采取操作前始终询问。" },
  { value: "onRequest", label: "按请求", description: "Agent 请求提升权限时询问。" },
  { value: "neverAsk", label: "从不请求审批", description: "受阻操作直接失败，不请求批准。" },
];

const REASONING_EFFORT_OPTIONS: Array<{ label: string; value: ZenmeReasoningEffort }> = [
  { value: "low", label: "轻" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
];

const MODEL_SPEED_OPTIONS: Array<{ description: string; label: string; value: ZenmeModelSpeed }> = [
  { value: "standard", label: "标准", description: "使用服务商的标准处理队列。" },
  { value: "fast", label: "快速", description: "支持时使用 Priority / Fast 通道，可能消耗更多额度或产生更高费用。" },
];

function GeneralSettings({
  autoDreamEnabled,
  defaultSessionPermissionMode,
  defaultModelSpeed,
  defaultReasoningEffort,
  lastTextModelId,
  onChange,
  onAutoDreamChange,
  onModelSpeedChange,
  onPermissionModeChange,
  onReasoningEffortChange,
  onTextModelChange,
  saveState,
  textModelOptions,
  theme,
}: {
  autoDreamEnabled: boolean;
  defaultSessionPermissionMode: ZenmeSessionPermissionMode;
  defaultModelSpeed: ZenmeModelSpeed;
  defaultReasoningEffort: ZenmeReasoningEffort;
  lastTextModelId: string;
  onChange: (theme: ZenmeTheme) => void;
  onAutoDreamChange: (enabled: boolean) => void;
  onModelSpeedChange: (speed: ZenmeModelSpeed) => void;
  onPermissionModeChange: (mode: ZenmeSessionPermissionMode) => void;
  onReasoningEffortChange: (effort: ZenmeReasoningEffort) => void;
  onTextModelChange: (modelId: string) => void;
  saveState: "idle" | "saving" | "saved" | "failed";
  textModelOptions: ReturnType<typeof useAiModelOptions>;
  theme: ZenmeTheme;
}) {
  return (
    <section className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-text-primary)]">通用</h2>
        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
          配置界面外观以及新 Project Agent 会话的默认行为。
        </p>
      </div>
      <SettingsSectionBlock title="外观" description="主题会应用到工作台、画布、节点、阅读器和所有弹层。">
        <div className="grid grid-cols-2 gap-4" role="radiogroup" aria-label="界面主题">
          {THEME_OPTIONS.map((option) => {
            const selected = theme === option.value;
            return (
              <button aria-checked={selected} className={`group overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${selected ? "border-[var(--color-border-focus)] ring-1 ring-[var(--color-border-focus)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"}`} key={option.value} onClick={() => onChange(option.value)} role="radio" type="button">
                <ThemePreview theme={option.value} />
                <span className="flex items-start gap-3 bg-[var(--color-surface-container-lowest)] px-4 py-3.5">
                  <span className="mt-0.5 text-[var(--color-text-secondary)]">{option.icon}</span>
                  <span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">{option.label}{selected ? <Check className="size-4" /> : null}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="默认会话权限" description="应用于新建的 Project Agent Turn；现有会话不被改写。">
        <select aria-label="默认会话权限" className="h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-sm" onChange={(event) => onPermissionModeChange(event.target.value as ZenmeSessionPermissionMode)} value={defaultSessionPermissionMode}>
          {PERMISSION_MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}
        </select>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="默认模型" description="作为新建 Project Agent Turn 和节点对话的首选文本模型。">
        <select aria-label="默认模型" className="h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-sm" disabled={!textModelOptions.length} onChange={(event) => onTextModelChange(event.target.value)} value={lastTextModelId}>
          {textModelOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="推理强度" description="控制支持该能力的模型在每个 Project Agent Turn 中投入的推理量。">
        <select aria-label="推理强度" className="h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-sm" onChange={(event) => onReasoningEffortChange(event.target.value as ZenmeReasoningEffort)} value={defaultReasoningEffort}>
          {REASONING_EFFORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="模型速度" description="控制支持该能力的服务商处理通道；不支持的服务商保持默认行为。">
        <select aria-label="模型速度" className="h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 text-sm" onChange={(event) => onModelSpeedChange(event.target.value as ZenmeModelSpeed)} value={defaultModelSpeed}>
          {MODEL_SPEED_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}
        </select>
      </SettingsSectionBlock>
      <SettingsSectionBlock title="自动做梦" description="在会话积累到阈值后，后台整理 Project Memory 候选。">
        <SettingsToggle checked={autoDreamEnabled} label="启用自动做梦" description={autoDreamEnabled ? "已启用；整理结果仍需用户确认后才进入长期上下文。" : "默认关闭，因为后台整理会额外调用模型并消耗 Token。"} onChange={onAutoDreamChange} />
      </SettingsSectionBlock>
      <p aria-live="polite" className="text-sm text-[var(--color-text-tertiary)]">{saveState === "saving" ? "正在保存…" : saveState === "failed" ? "设置保存失败，请重试" : "设置会自动保存。"}</p>
    </section>
  );
}

function SettingsSectionBlock({ children, description, title }: { children: React.ReactNode; description: string; title: string }) {
  return <div><h3 className="text-base font-medium text-[var(--color-text-primary)]">{title}</h3><p className="mb-3 mt-1 text-sm text-[var(--color-text-tertiary)]">{description}</p>{children}</div>;
}

function SettingsToggle({ checked, description, label, onChange }: { checked: boolean; description: string; label: string; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-4 py-3"><input aria-label={label} checked={checked} className="mt-1 size-4" onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span><span className="block text-sm font-medium text-[var(--color-text-primary)]">{label}</span><span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">{description}</span></span></label>;
}

function AutoDreamConfirmation({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-6"><div aria-labelledby="auto-dream-title" className="w-full max-w-md rounded-2xl bg-[var(--color-surface-container-lowest)] p-6 shadow-2xl" role="dialog"><h2 className="text-lg font-medium" id="auto-dream-title">启用自动做梦？</h2><p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">符合条件的会话结束后，Zenme 会在后台调用当前文本模型整理记忆，因此会额外消耗 Token。生成内容只作为候选 Memory，不会自动成为可信事实。</p><div className="mt-6 flex justify-end gap-2"><Button onClick={onCancel} type="button" variant="ghost">取消</Button><Button onClick={onConfirm} type="button">启用自动做梦</Button></div></div></div>;
}

function ThemePreview({ theme }: { theme: ZenmeTheme }) {
  return (
    <span
      aria-hidden="true"
      className="zenme-theme-preview relative block h-28 overflow-hidden border-b"
      data-preview-theme={theme}
    >
      <span className="zenme-theme-preview-sidebar absolute inset-y-0 left-0 w-9" />
      <span className="zenme-theme-preview-line absolute left-12 right-3 top-4 h-3 rounded" />
      <span className="zenme-theme-preview-card absolute left-12 top-10 h-12 w-20 rounded-md border" />
      <span className="zenme-theme-preview-card absolute left-[8.75rem] right-3 top-10 h-12 rounded-md border" />
    </span>
  );
}

function SettingsNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium transition ${
        active
          ? "text-[var(--color-text-primary)]"
          : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
      }`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

function TokenUsageSettings() {
  const [payload, setPayload] = useState<TokenUsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"daily" | "weekly" | "cumulative">("daily");

  async function loadUsage() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/token-usage", { cache: "no-store" });
      if (!response.ok) throw new Error("usage load failed");
      setPayload(await response.json() as TokenUsagePayload);
    } catch {
      setError("Token 用量读取失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUsage();
  }, []);

  const chart = useMemo(() => buildUsageChart(payload?.daily ?? []), [payload]);
  const summary = payload?.summary;
  const mostUsedModel = payload?.models[0];

  return (
    <section className="mx-auto max-w-[1240px] space-y-10">
      <header className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xl font-medium tracking-normal text-[var(--color-text-primary)]">Token 用量</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            查看本机模型调用的 Token 消耗和使用趋势。
          </p>
        </div>
        <Button disabled={loading} onClick={() => void loadUsage()} variant="outline">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </header>

      {error ? (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      ) : null}

      <div className="grid overflow-hidden rounded-md border border-[var(--color-border)] bg-white shadow-sm md:grid-cols-5">
        <UsageMetric
          detail={`${summary?.trackedDays ?? 0} 个活跃日`}
          label="累计 Token 数"
          value={formatTokenCount(summary?.totalTokens ?? 0)}
        />
        <UsageMetric
          detail={formatUsageDate(summary?.peakDate)}
          label="峰值 Token 数"
          value={formatTokenCount(summary?.peakDailyTokens ?? 0)}
        />
        <UsageMetric
          detail={`${summary?.longestRequestMessages ?? 0} 条消息`}
          label="最长生成耗时"
          value={formatUsageDuration(summary?.longestRequestMs ?? 0)}
        />
        <UsageMetric
          detail={`${formatTokenCount(summary?.currentDayTokens ?? 0)} Token`}
          label="当前连续天数"
          value={`${summary?.currentStreak ?? 0} 天`}
        />
        <UsageMetric
          detail={`${summary?.totalRequests ?? 0} 次调用`}
          label="最长连续天数"
          value={`${summary?.longestStreak ?? 0} 天`}
        />
      </div>

      <section>
        <div className="mb-5 flex items-center justify-between gap-5">
          <div>
            <h3 className="text-base font-medium text-[var(--color-text-primary)]">Token 活动</h3>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">仅统计服务商实际返回的用量，不估算缺失数据。</p>
          </div>
          <div className="flex items-center gap-1" aria-label="统计周期">
            {(["daily", "weekly", "cumulative"] as const).map((item) => (
              <button
                className={`px-3 py-1.5 text-sm font-medium transition ${mode === item ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"}`}
                key={item}
                onClick={() => setMode(item)}
                type="button"
              >
                {{ daily: "每日", weekly: "每周", cumulative: "累计" }[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-52 rounded-md border border-[var(--color-border)] bg-white px-5 py-5">
          {mode === "daily" ? <DailyUsageHeatmap days={chart.days} /> : null}
          {mode === "weekly" ? <UsageBars items={chart.weeks} valueKey="totalTokens" /> : null}
          {mode === "cumulative" ? <UsageBars items={chart.cumulative} valueKey="totalTokens" /> : null}
          {!loading && (summary?.totalRequests ?? 0) === 0 ? (
            <p className="mt-5 text-center text-sm text-[var(--color-text-tertiary)]">
              统计将从下一次模型调用开始记录。
            </p>
          ) : null}
        </div>
      </section>

      <div className="grid gap-12 lg:grid-cols-2">
        <section>
          <h3 className="mb-5 text-base font-medium text-[var(--color-text-primary)]">活动洞察</h3>
          <div className="space-y-4">
            <UsageInsight label="活跃率" value={`${summary?.activityRate ?? 0}%`} />
            <UsageInsight
              label="最常用模型"
              value={mostUsedModel ? `${mostUsedModel.modelId} · ${formatTokenCount(mostUsedModel.totalTokens)} Token` : "暂无数据"}
            />
            <UsageInsight label="已使用模型" value={`${payload?.models.length ?? 0}`} />
            <UsageInsight label="文本生成" value={`${summary?.textRequests ?? 0} 次`} />
            <UsageInsight label="图片生成/编辑" value={`${summary?.imageRequests ?? 0} 次`} />
            <UsageInsight label="调用总数" value={`${summary?.totalRequests ?? 0}`} />
          </div>
        </section>

        <section>
          <h3 className="mb-5 text-base font-medium text-[var(--color-text-primary)]">最常用的模型和服务商</h3>
          <div className="space-y-2">
            {(payload?.models ?? []).slice(0, 5).map((model) => (
              <div className="flex items-center justify-between gap-4 py-2" key={`${model.providerName}:${model.modelId}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-text-primary)]">{model.modelId}</p>
                  <p className="truncate text-xs text-[var(--color-text-tertiary)]">{model.providerName}</p>
                </div>
                <p className="shrink-0 text-sm text-[var(--color-text-secondary)]">
                  {formatTokenCount(model.totalTokens)} Token · {model.requests} 次
                </p>
              </div>
            ))}
            {(payload?.models.length ?? 0) === 0 ? (
              <p className="py-2 text-sm text-[var(--color-text-tertiary)]">暂无模型调用记录。</p>
            ) : null}
          </div>
          {(payload?.providers.length ?? 0) > 0 ? (
            <div className="mt-5 border-t border-[var(--color-border)] pt-4">
              {(payload?.providers ?? []).slice(0, 3).map((provider) => (
                <div className="flex items-center justify-between gap-4 py-1.5 text-sm" key={provider.providerName}>
                  <span className="text-[var(--color-text-secondary)]">{provider.providerName}</span>
                  <span className="text-[var(--color-text-tertiary)]">{provider.requests} 次 · {formatTokenCount(provider.totalTokens)} Token</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function UsageMetric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="border-b border-[var(--color-border)] px-4 py-5 text-center last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <p className="truncate text-2xl font-semibold text-[var(--color-text-primary)]" title={value}>{value}</p>
      <p className="mt-1 text-sm font-medium text-[var(--color-text-secondary)]">{label}</p>
      <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]" title={detail}>{detail}</p>
    </div>
  );
}

function UsageInsight({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-sm">
      <span className="text-[var(--color-text-tertiary)]">{label}</span>
      <span className="text-right font-medium text-[var(--color-text-primary)]">{value}</span>
    </div>
  );
}

type UsageChartItem = { date: string; totalTokens: number; requests: number };

function DailyUsageHeatmap({ days }: { days: UsageChartItem[] }) {
  const max = Math.max(1, ...days.map((day) => day.totalTokens));
  return (
    <OverlayScrollArea
      contentKey={days.map((day) => `${day.date}:${day.totalTokens}`).join("|")}
      viewportClassName="overflow-x-auto pb-2"
    >
      <div className="mb-3 flex min-w-[900px] items-center justify-between text-xs text-[var(--color-text-tertiary)]">
        <span>{formatUsageDate(days[0]?.date ?? null)}</span>
        <span>{formatUsageDate(days.at(-1)?.date ?? null)}</span>
      </div>
      <div className="grid min-w-[900px] grid-flow-col grid-rows-7 gap-1">
        {days.map((day) => (
          <span
            className="aspect-square min-w-3 rounded-[3px] border border-black/5"
            key={day.date}
            style={{ backgroundColor: usageHeatColor(day.totalTokens, max) }}
            title={`${day.date} · ${formatTokenCount(day.totalTokens)} Token · ${day.requests} 次`}
          />
        ))}
      </div>
      <div className="mt-4 flex min-w-[900px] items-center justify-end gap-2 text-xs text-[var(--color-text-tertiary)]">
        <span>少</span>
        {[0, 0.2, 0.4, 0.7, 1].map((value) => (
          <span className="size-3 rounded-[3px] border border-black/5" key={value} style={{ backgroundColor: usageHeatColor(value * max, max) }} />
        ))}
        <span>多</span>
      </div>
    </OverlayScrollArea>
  );
}

function UsageBars({ items, valueKey }: { items: UsageChartItem[]; valueKey: "totalTokens" }) {
  const max = Math.max(1, ...items.map((item) => item[valueKey]));
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5 border-b border-[var(--color-border)]">
        {items.map((item) => (
          <div className="group relative flex min-w-0 flex-1 items-end" key={item.date} title={`${item.date} · ${formatTokenCount(item[valueKey])} Token`}>
            <span
              className="w-full rounded-t-sm bg-[var(--color-brand-container)] transition group-hover:bg-[var(--color-brand)]"
              style={{ height: `${Math.max(item[valueKey] ? 4 : 1, item[valueKey] / max * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between text-xs text-[var(--color-text-tertiary)]">
        <span>{formatUsageDate(items[0]?.date ?? null)}</span>
        <span>{formatUsageDate(items.at(-1)?.date ?? null)}</span>
      </div>
    </div>
  );
}

function buildUsageChart(daily: TokenUsagePayload["daily"]) {
  const lookup = new Map(daily.map((item) => [item.date, item]));
  const end = startOfLocalDay(new Date());
  const start = new Date(end);
  start.setDate(start.getDate() - 370);
  start.setDate(start.getDate() - start.getDay());
  const days: UsageChartItem[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const date = formatLocalDateKey(cursor);
    const item = lookup.get(date);
    days.push({ date, totalTokens: item?.totalTokens ?? 0, requests: item?.requests ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  const weeks: UsageChartItem[] = [];
  for (let index = 0; index < days.length; index += 7) {
    const group = days.slice(index, index + 7);
    weeks.push({
      date: group[0]?.date ?? "",
      totalTokens: group.reduce((sum, item) => sum + item.totalTokens, 0),
      requests: group.reduce((sum, item) => sum + item.requests, 0),
    });
  }
  let running = 0;
  const cumulative = weeks.map((week) => {
    running += week.totalTokens;
    return { ...week, totalTokens: running };
  });
  return { days, weeks, cumulative };
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatUsageDuration(value: number) {
  if (value < 1_000) return `${value} 毫秒`;
  if (value < 60_000) return `${Math.round(value / 100) / 10} 秒`;
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  return hours ? `${hours} 小时 ${minutes} 分` : `${minutes} 分钟`;
}

function formatUsageDate(value: string | null | undefined) {
  if (!value) return "暂无记录";
  const date = new Date(`${value}T00:00:00`);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function usageHeatColor(value: number, max: number) {
  if (!value) return "#f1f4f7";
  const ratio = value / max;
  if (ratio < 0.2) return "#f7e8e1";
  if (ratio < 0.4) return "#efd0c2";
  if (ratio < 0.7) return "#dca98f";
  return "#96573f";
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function McpServerSettings({
  onChange,
  saveState,
  servers,
}: {
  onChange: (servers: McpServerConfig[]) => void;
  saveState: "idle" | "saving" | "saved" | "failed";
  servers: McpServerConfig[];
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");

  function addServer(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !command.trim()) return;
    onChange([...servers, {
      id: crypto.randomUUID(),
      name: name.trim(),
      enabled: true,
      command: command.trim(),
      args: argsText.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean),
      connectTimeoutMs: 10_000,
      callTimeoutMs: 120_000,
      access: "readOnly",
    }]);
    setName("");
    setCommand("");
    setArgsText("");
  }

  return (
    <section className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">MCP 工具</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          连接本机 stdio MCP Server。服务进程在当前项目 Workspace 中启动；工具会在连接后动态加入 Project Agent。
        </p>
      </div>

      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] p-5 text-sm text-[var(--color-text-secondary)]">
            尚未配置 MCP Server。
          </div>
        ) : servers.map((server) => (
          <div className="rounded-md border border-[var(--color-border)] p-4" key={server.id}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium text-[var(--color-text-primary)]">{server.name}</div>
                <code className="mt-1 block truncate text-xs text-[var(--color-text-secondary)]">
                  {[server.command, ...server.args].join(" ")}
                </code>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onChange(servers.map((item) => item.id === server.id
                    ? { ...item, access: item.access === "full" ? "readOnly" : "full" }
                    : item))}
                >
                  {server.access === "full" ? "完全访问" : "只读"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onChange(servers.map((item) => item.id === server.id ? { ...item, enabled: !item.enabled } : item))}
                >
                  {server.enabled ? "已启用" : "已停用"}
                </Button>
                <Button aria-label={`删除 ${server.name}`} size="icon" variant="ghost" onClick={() => onChange(servers.filter((item) => item.id !== server.id))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <form className="space-y-4 rounded-md border border-[var(--color-border)] p-5" onSubmit={addServer}>
        <div>
          <h3 className="font-medium text-[var(--color-text-primary)]">添加 stdio Server</h3>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">默认只注入声明了 readOnlyHint 的工具；确认信任该服务后可切换为完全访问。</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input aria-label="MCP 服务名称" placeholder="服务名称，例如 Filesystem" value={name} onChange={(event) => setName(event.target.value)} />
          <Input aria-label="MCP 启动命令" placeholder="命令，例如 npx" value={command} onChange={(event) => setCommand(event.target.value)} />
        </div>
        <textarea
          aria-label="MCP 命令参数"
          className="min-h-28 w-full resize-y rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          placeholder={"参数，每行一个\n-y\n@modelcontextprotocol/server-filesystem\n."}
          value={argsText}
          onChange={(event) => setArgsText(event.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!name.trim() || !command.trim()}>添加 Server</Button>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {saveState === "saving" ? "正在保存…" : saveState === "saved" ? "已保存" : saveState === "failed" ? "保存失败" : ""}
          </span>
        </div>
      </form>
    </section>
  );
}

function AgentPluginSettings() {
  const [plugins, setPlugins] = useState<AgentPlugin[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ plugin: AgentPlugin; configuration: AgentPluginConfiguration } | null>(null);

  async function loadPlugins() {
    setState("loading");
    try {
      const response = await fetch("/api/settings/agent-plugins", { cache: "no-store" });
      const body = await response.json() as { plugins?: AgentPlugin[]; error?: string };
      if (!response.ok || !body.plugins) throw new Error(body.error || "插件加载失败");
      setPlugins(body.plugins);
      setState("ready");
      setMessage("");
    } catch (error) {
      setState("failed");
      setMessage(error instanceof Error ? error.message : "插件加载失败");
    }
  }

  useEffect(() => { void loadPlugins(); }, []);

  return (
    <section className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">Agent 插件</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            配置已通过 cc-haha 兼容设置启用的插件。敏感字段独立保存在本地凭据文件中，不会返回给界面或模型。
          </p>
        </div>
        <Button disabled={state === "loading"} onClick={() => void loadPlugins()} size="sm" type="button" variant="outline">
          <RefreshCw className={`mr-2 size-4 ${state === "loading" ? "animate-spin" : ""}`} />刷新
        </Button>
      </div>

      {state === "failed" ? <p className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p> : null}
      {state === "loading" && plugins.length === 0 ? <p className="text-sm text-[var(--color-text-tertiary)]">正在读取插件配置…</p> : null}
      {state === "ready" && plugins.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--color-border)] p-5 text-sm text-[var(--color-text-secondary)]">
          尚无已启用插件。Zenme 会读取 `~/.claude/settings.json` 与 `~/.zenme/settings.json` 中的 enabledPlugins。
        </div>
      ) : null}

      <div className="space-y-4">
        {plugins.map((plugin) => (
          <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-5" key={plugin.id}>
            <div>
              <h3 className="font-medium text-[var(--color-text-primary)]">{plugin.name}</h3>
              <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">{plugin.id}</p>
            </div>
            {plugin.configurations.length ? (
              <div className="mt-4 divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
                {plugin.configurations.map((configuration) => (
                  <div className="flex items-center justify-between gap-4 py-3" key={configuration.id}>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-[var(--color-text-primary)]">{configuration.label}</div>
                      <div className={`mt-0.5 text-xs ${configuration.missing.length ? "text-red-600" : "text-[var(--color-text-tertiary)]"}`}>
                        {configuration.missing.length
                          ? `缺少必需配置：${configuration.missing.join("、")}`
                          : `${configuration.configuredKeys.length} 项配置已就绪`}
                      </div>
                    </div>
                    <Button onClick={() => setEditing({ plugin, configuration })} size="sm" type="button" variant="outline">
                      配置
                    </Button>
                  </div>
                ))}
              </div>
            ) : <p className="mt-4 text-sm text-[var(--color-text-tertiary)]">该插件没有需要填写的选项。</p>}
            {plugin.errors.map((error) => (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" key={`${error.source}:${error.error}`}>
                {error.source}：{error.error}
              </p>
            ))}
          </div>
        ))}
      </div>

      {editing ? (
        <AgentPluginConfigurationModal
          configuration={editing.configuration}
          onClose={() => setEditing(null)}
          onSaved={(nextPlugins) => {
            setPlugins(nextPlugins);
            setEditing(null);
          }}
          plugin={editing.plugin}
        />
      ) : null}
    </section>
  );
}

function AgentPluginConfigurationModal({
  configuration,
  onClose,
  onSaved,
  plugin,
}: {
  configuration: AgentPluginConfiguration;
  onClose: () => void;
  onSaved: (plugins: AgentPlugin[]) => void;
  plugin: AgentPlugin;
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(() => Object.fromEntries(
    Object.entries(configuration.schema).map(([key, field]) => [
      key,
      field.sensitive ? "" : configuration.values[key] ?? field.default ?? (field.type === "boolean" ? false : ""),
    ]),
  ));
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed">("idle");
  const [error, setError] = useState("");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaveState("saving");
    setError("");
    try {
      const response = await fetch("/api/settings/agent-plugins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId: plugin.id, configurationId: configuration.id, values: draft }),
      });
      const body = await response.json() as { plugins?: AgentPlugin[]; error?: string };
      if (!response.ok || !body.plugins) throw new Error(body.error || "插件配置保存失败");
      onSaved(body.plugins);
    } catch (caught) {
      setSaveState("failed");
      setError(caught instanceof Error ? caught.message : "插件配置保存失败");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-6" role="presentation">
      <form aria-labelledby="agent-plugin-config-title" className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl bg-[var(--color-surface-container-lowest)] p-6 shadow-2xl" onSubmit={save} role="dialog">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium" id="agent-plugin-config-title">配置 {configuration.label}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">{plugin.name} · {plugin.id}</p>
          </div>
          <Button aria-label="关闭插件配置" onClick={onClose} size="icon" type="button" variant="ghost"><X className="size-5" /></Button>
        </div>
        <OverlayScrollArea className="mt-6 min-h-0 flex-1" viewportClassName="max-h-[calc(80vh-11rem)] overflow-y-auto pr-2">
          <div className="space-y-5">
            {Object.entries(configuration.schema).map(([key, field]) => {
            const label = field.title || key;
            const configured = configuration.configuredKeys.includes(key);
            if (field.type === "boolean") return (
              <SettingsToggle
                checked={draft[key] === true}
                description={field.description || key}
                key={key}
                label={`${label}${field.required ? " *" : ""}`}
                onChange={(checked) => setDraft((current) => ({ ...current, [key]: checked }))}
              />
            );
            if (field.multiple) return (
              <label className="block" key={key}>
                <span className="text-sm font-medium">{label}{field.required ? " *" : ""}</span>
                {field.description ? <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">{field.description}</span> : null}
                <textarea className="mt-2 min-h-24 w-full rounded-md border border-[var(--color-border)] bg-transparent px-3 py-2 text-sm" onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value.split(/\r?\n/).filter(Boolean) }))} value={Array.isArray(draft[key]) ? (draft[key] as string[]).join("\n") : ""} />
              </label>
            );
            return (
              <label className="block" key={key}>
                <span className="text-sm font-medium">{label}{field.required ? " *" : ""}</span>
                {field.description ? <span className="mt-1 block text-xs text-[var(--color-text-tertiary)]">{field.description}</span> : null}
                <span className="relative mt-2 block">
                  <Input
                    aria-label={label}
                    max={field.max}
                    min={field.min}
                    onChange={(event) => setDraft((current) => ({ ...current, [key]: field.type === "number" ? (event.target.value === "" ? "" : Number(event.target.value)) : event.target.value }))}
                    placeholder={field.sensitive && configured ? "已配置；留空保持原值" : undefined}
                    type={field.type === "number" ? "number" : field.sensitive && !showSecrets[key] ? "password" : "text"}
                    value={typeof draft[key] === "string" || typeof draft[key] === "number" ? draft[key] as string | number : ""}
                  />
                  {field.sensitive ? <button aria-label={`${showSecrets[key] ? "隐藏" : "显示"}${label}`} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--color-text-tertiary)]" onClick={() => setShowSecrets((current) => ({ ...current, [key]: !current[key] }))} type="button">{showSecrets[key] ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button> : null}
                </span>
              </label>
            );
            })}
          </div>
          {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        </OverlayScrollArea>
        <div className="mt-6 flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="ghost">取消</Button>
          <Button disabled={saveState === "saving"} type="submit">{saveState === "saving" ? "保存中…" : "保存"}</Button>
        </div>
      </form>
    </div>
  );
}

function ModelProviderSettings({
  onAddProvider,
  onDeleteProvider,
  onEditProvider,
  onEditProxyProvider,
  chatGptAction,
  chatGptMessage,
  chatGptStatus,
  onLoginChatGpt,
  onLogoutChatGpt,
  onSyncChatGptModels,
  providers,
}: {
  onAddProvider: (preset: ModelProviderPresetId) => void;
  onDeleteProvider: (providerId: string) => void;
  onEditProvider: (provider: ModelProviderConfig) => void;
  onEditProxyProvider: (provider: ModelProviderConfig) => void;
  chatGptAction: "idle" | "login" | "sync" | "logout" | "failed";
  chatGptMessage: string;
  chatGptStatus: ChatGptAuthStatus | null;
  onLoginChatGpt: () => void;
  onLogoutChatGpt: () => void;
  onSyncChatGptModels: () => void;
  providers: ModelProviderConfig[];
}) {
  return (
    <section className="max-w-5xl">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium text-[var(--color-text-primary)]">
            模型配置
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            管理模型服务商、模型映射和模型模态能力。
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="bg-[#96573f] text-white hover:bg-[#854b36]" type="button">
              <Plus className="size-4" />
              添加服务商
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {MODEL_PROVIDER_PRESET_OPTIONS.map((option) => (
              <DropdownMenuItem
                className="flex cursor-pointer flex-col items-start gap-0.5 py-2.5"
                key={option.value}
                onSelect={() => onAddProvider(option.value)}
              >
                <span className="font-medium text-[var(--color-text-primary)]">
                  {option.label}
                </span>
                <span className="text-xs text-[var(--color-text-tertiary)]">
                  {option.description}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-3">
        {providers.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">
              尚未配置模型服务商
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
              使用右上角“添加服务商”按需配置。
            </p>
          </div>
        ) : null}
        {providers.map((provider) => provider.apiFormat === "openai_oauth" ? (
          <ChatGptProviderCard
            action={chatGptAction}
            key={provider.id}
            message={chatGptMessage}
            onLogin={onLoginChatGpt}
            onLogout={onLogoutChatGpt}
            onProxy={() => onEditProxyProvider(provider)}
            onSync={onSyncChatGptModels}
            status={chatGptStatus}
          />
        ) : (
          <article
            className="rounded-md border border-[var(--color-border)] bg-white p-4 shadow-sm transition"
            key={provider.id}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`size-2.5 rounded-full ${
                      provider.enabled ? "bg-emerald-500" : "bg-zinc-300"
                    }`}
                  />
                  <h3 className="truncate text-base font-medium text-[var(--color-text-primary)]">
                    {provider.name}
                  </h3>
                  <span className="rounded-md bg-[var(--color-surface-container-high)] px-2 py-0.5 text-xs text-[var(--color-text-tertiary)]">
                    {getApiFormatLabel(provider.apiFormat)}
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-[var(--color-text-secondary)]">
                  {provider.baseUrl || "未配置接口地址"} · {getProviderModelSummary(provider)}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {collectProviderModalities(provider).map((modality) => (
                    <span
                      className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]"
                      key={modality}
                    >
                      {getModalityLabel(modality)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button onClick={() => onEditProvider(provider)} type="button" variant="outline">
                  编辑
                </Button>
                <Button
                  onClick={() => onDeleteProvider(provider.id)}
                  title="删除服务商"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ChatGptProviderCard({
  action,
  message,
  onLogin,
  onLogout,
  onProxy,
  onSync,
  status,
}: {
  action: "idle" | "login" | "sync" | "logout" | "failed";
  message: string;
  onLogin: () => void;
  onLogout: () => void;
  onProxy: () => void;
  onSync: () => void;
  status: ChatGptAuthStatus | null;
}) {
  const busy = action === "login" || action === "sync" || action === "logout";
  return (
    <article className="rounded-md border border-[var(--color-border)] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`size-2.5 rounded-full ${status?.loggedIn ? "bg-emerald-500" : "bg-zinc-300"}`} />
            <h3 className="text-base font-medium text-[var(--color-text-primary)]">ChatGPT</h3>
            <span className="rounded-md bg-[var(--color-brand-soft)] px-2 py-0.5 text-xs font-medium text-[var(--color-brand)]">官方</span>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">通过 ChatGPT 账号完成 OpenAI OAuth，无需 API 密钥</p>
        </div>
        <Button onClick={onProxy} type="button" variant="outline">
          代理设置
        </Button>
      </div>
      <div className="mt-4 border-t border-[var(--color-border)] pt-4">
        {status?.loggedIn ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-emerald-700">已登录 {status.email || "ChatGPT 账号"}</p>
              <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                {status.modelSyncing ? "正在自动同步模型…" : `已同步 ${status.modelCount} 个可用模型`}
              </p>
              {action === "failed" || status.modelSyncError ? (
                <p className="mt-2 text-xs text-red-600">
                  {message || status.modelSyncError || "模型同步失败，请稍后重试。"}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button disabled={busy} onClick={onSync} type="button" variant="outline"><RefreshCw className={`size-4 ${action === "sync" ? "animate-spin" : ""}`} />同步模型</Button>
              <Button disabled={busy} onClick={onLogout} type="button" variant="outline"><LogOut className="size-4" />退出登录</Button>
            </div>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">登录后即可在 Zenme 的文本节点中使用账号可用的 Codex 模型。</p>
            <Button className="bg-[#96573f] text-white hover:bg-[#854b36]" disabled={busy} onClick={onLogin} type="button">
              {action === "login" ? <RefreshCw className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {action === "login" ? "等待浏览器登录" : "登录 ChatGPT"}
            </Button>
            {action === "failed" ? <p className="mt-2 text-xs text-red-600">{message || "操作失败，请检查网络后重试。"}</p> : null}
          </div>
        )}
      </div>
    </article>
  );
}

function ProviderEditorModal({
  isCreating,
  onClose,
  onSave,
  provider,
}: {
  isCreating: boolean;
  onClose: () => void;
  onSave: (provider: ModelProviderConfig) => Promise<ModelProviderConfig>;
  provider: ModelProviderConfig;
}) {
  const [draft, setDraft] = useState<ModelProviderConfig>(provider);
  const [isNewProvider, setIsNewProvider] = useState(isCreating);
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerSaveState, setProviderSaveState] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [modelFetchState, setModelFetchState] = useState<
    "idle" | "loading" | "done" | "failed" | "unsupported"
  >("idle");
  const [modelFetchMessage, setModelFetchMessage] = useState("");
  const [fetchedModelIds, setFetchedModelIds] = useState<string[]>([]);
  const providerPreset = identifyModelProviderPreset(draft);
  const isCustomProvider = providerPreset === "custom";
  const proxyUrlError =
    draft.networkProxy.mode === "custom"
      ? validateProxyUrl(draft.networkProxy.url)
      : "";
  async function saveProvider() {
    setProviderSaveState("saving");
    try {
      const savedProvider = await onSave(
        prepareProviderForSave(draft),
      );
      setDraft(savedProvider);
      setIsNewProvider(false);
      setProviderSaveState("saved");
      window.setTimeout(() => setProviderSaveState("idle"), 1400);
    } catch {
      setProviderSaveState("failed");
    }
  }

  function applyProviderPreset(preset: ModelProviderPresetId) {
    const nextPreset = createModelProviderPreset(preset);
    setDraft((current) => ({
      ...nextPreset,
      apiKey: current.apiKey,
      id: current.id,
      networkProxy: current.networkProxy,
    }));
    setFetchedModelIds([]);
    setModelFetchMessage("");
    setModelFetchState("idle");
  }

  function updateContextWindow(modelId: string, value: string) {
    const nextValue = Number(value);
    const normalizedValue = Number.isFinite(nextValue) ? nextValue : 0;
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId
          ? { ...model, contextWindow: normalizedValue }
          : model,
      ),
      contextWindows: {
        ...current.contextWindows,
        [modelId]: normalizedValue,
      },
    }));
  }

  function toggleModality(modelId: string, modality: ModelModality) {
    setDraft((current) => {
      const currentModel = current.models.find((model) => model.id === modelId);
      const currentModalities =
        currentModel?.modalities ?? current.modelModalities[modelId] ?? [];
      const nextModalities = currentModalities.includes(modality)
        ? currentModalities.filter((item) => item !== modality)
        : [...currentModalities, modality];

      return {
        ...current,
        models: current.models.map((model) =>
          model.id === modelId
            ? { ...model, modalities: nextModalities }
            : model,
        ),
        modelModalities: {
          ...current.modelModalities,
          [modelId]: nextModalities,
        },
      };
    });
  }

  function addModel(modelId = "") {
    const id = modelId.trim() || "new-model";
    setDraft((current) => {
      if (current.models.some((model) => model.id === id)) {
        return current;
      }
      return {
        ...current,
        models: [
          ...current.models,
          {
            id,
            alias: "",
            enabled: true,
            modalities: ["text"],
          },
        ],
      };
    });
  }

  function updateModelId(previousId: string, nextId: string) {
    const id = nextId.trim();
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === previousId ? { ...model, id: nextId } : model,
      ),
      modelMapping: {
        ...current.modelMapping,
        main: current.modelMapping.main === previousId ? id : current.modelMapping.main,
        image:
          current.modelMapping.image === previousId
            ? id
            : current.modelMapping.image,
        video:
          current.modelMapping.video === previousId
            ? id
            : current.modelMapping.video,
      },
    }));
  }

  function updateModelAlias(modelId: string, alias: string) {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId ? { ...model, alias } : model,
      ),
    }));
  }

  function toggleModelEnabled(modelId: string) {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model) =>
        model.id === modelId ? { ...model, enabled: !model.enabled } : model,
      ),
    }));
  }

  function removeModel(modelId: string) {
    setDraft((current) => ({
      ...current,
      models: current.models.filter((model) => model.id !== modelId),
      modelMapping: {
        ...current.modelMapping,
        main: current.modelMapping.main === modelId ? "" : current.modelMapping.main,
        image:
          current.modelMapping.image === modelId
            ? ""
            : current.modelMapping.image,
        video:
          current.modelMapping.video === modelId
            ? ""
            : current.modelMapping.video,
      },
    }));
  }

  async function fetchProviderModels() {
    if (draft.apiFormat === "volcengine_agent_plan") {
      setModelFetchState("unsupported");
      setModelFetchMessage(
        "火山方舟 Agent Plan 的个人版 Bearer API Key 当前不支持在线枚举模型；请使用 Zenme 内置模型目录或手动添加模型。",
      );
      return;
    }
    if (draft.apiFormat === "openrouter") {
      setModelFetchState("unsupported");
      setModelFetchMessage("OpenRouter 模型池过大，当前请手动添加需要启用的模型。");
      return;
    }

    setModelFetchState("loading");
    setModelFetchMessage("");
    try {
      const response = await fetch("/api/ai/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: draft }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: Array<{ id: string }> ; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "模型拉取失败");
      }

      const fetchedModels = Array.from(
        new Set(
          (payload?.data ?? [])
            .map((item) => item.id?.trim())
            .filter((id): id is string => Boolean(id)),
        ),
      );
      setFetchedModelIds(fetchedModels);
      setModelFetchState("done");
      setModelFetchMessage(`已拉取 ${fetchedModels.length} 个模型，请选择需要的模型添加到配置。`);
    } catch (error) {
      setModelFetchState("failed");
      setModelFetchMessage(error instanceof Error ? error.message : "模型拉取失败");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-6 py-[80px]">
      <div className="zenme-shadow-overlay flex max-h-[calc(100vh-160px)] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-lg font-medium text-[var(--color-text-primary)]">
            {isNewProvider ? "添加服务商" : "编辑服务商"}
          </h2>
          <button
            className="flex size-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </header>

        <OverlayScrollArea
          className="min-h-0 flex-1"
          viewportClassName="h-full overflow-auto px-5 py-4"
        >
          <div className="grid gap-4">
            {isNewProvider && identifyModelProviderPreset(provider) === "custom" ? (
              <section>
                <p className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                  预设
                </p>
                <div className="flex flex-wrap gap-2">
                  {CUSTOM_PROVIDER_PRESET_OPTIONS.map((option) => {
                    const active = providerPreset === option.value;
                    return (
                      <button
                        className={`rounded-full border px-3.5 py-2 text-sm transition ${
                          active
                            ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)] shadow-sm"
                            : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-focus)] hover:bg-[var(--color-surface-container-low)]"
                        }`}
                        key={option.value}
                        onClick={() => applyProviderPreset(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <Field label="名称" required>
              <Input
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                value={draft.name}
              />
            </Field>
            <Field label="备注">
              <Input
                onChange={(event) =>
                  setDraft((current) => ({ ...current, note: event.target.value }))
                }
                placeholder="可选备注..."
                value={draft.note ?? ""}
              />
            </Field>
            <Field label="接口地址" required>
              <Input
                onChange={(event) =>
                  setDraft((current) => ({ ...current, baseUrl: event.target.value }))
                }
                value={draft.baseUrl}
              />
            </Field>

            {isCustomProvider ? (
              <div className="grid gap-4">
                <Field label="API 格式">
                  <Select
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        apiFormat: value as ModelProviderApiFormat,
                      }))
                    }
                    options={CUSTOM_PROVIDER_API_FORMAT_OPTIONS}
                    value={draft.apiFormat === "custom" ? "openai" : draft.apiFormat}
                  />
                </Field>
                <Field label="认证方式">
                  <Select
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        authType: value as ModelProviderAuthType,
                      }))
                    }
                    options={AUTH_TYPE_OPTIONS}
                    value={draft.authType}
                  />
                </Field>
              </div>
            ) : (
              <Field label="接入协议">
                <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
                  {getProviderProtocolSummary(providerPreset)}
                </div>
              </Field>
            )}

            {draft.authType === "none" ? (
              <p className="rounded-md bg-[var(--color-surface-container-low)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
                本机 Ollama 默认无需 API 密钥。
              </p>
            ) : (
              <Field label="API 密钥">
                <div className="relative">
                  <Input
                    className="pr-11"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, apiKey: event.target.value }))
                    }
                    placeholder="请输入服务商 API 密钥"
                    type={showApiKey ? "text" : "password"}
                    value={draft.apiKey ?? ""}
                  />
                  <button
                    className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)]"
                    onClick={() => setShowApiKey((current) => !current)}
                    type="button"
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            )}

            <ProviderProxyFields
              networkProxy={draft.networkProxy}
              onChange={(networkProxy) =>
                setDraft((current) => ({ ...current, networkProxy }))
              }
            />

            <section className="rounded-md border border-[var(--color-border)] p-3.5">
              <div className="mb-4 flex items-start gap-3">
                <ImageIcon className="mt-0.5 size-5 text-[#96573f]" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-medium text-[var(--color-text-primary)]">
                    模型列表
                  </h3>
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    文本、图片和视频节点只显示已启用且包含对应模态的模型。
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button onClick={() => addModel()} type="button" variant="outline">
                    <Plus className="size-4" />
                    添加模型
                  </Button>
                  {draft.apiFormat !== "volcengine_agent_plan" ? (
                    <Button
                      disabled={modelFetchState === "loading"}
                      onClick={fetchProviderModels}
                      type="button"
                      variant="outline"
                    >
                      {modelFetchState === "loading" ? (
                        <RefreshCw className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      拉取模型
                    </Button>
                  ) : null}
                </div>
              </div>
              {draft.apiFormat === "volcengine_agent_plan" ? (
                <p className="mb-3 rounded-md bg-[var(--color-surface-container-lowest)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                  Agent Plan 模型列表来自 Zenme 内置目录；当前 Bearer API Key 无模型发现接口，不显示“拉取模型”。如官方新增模型，可手动添加 Model ID。
                </p>
              ) : null}
              {modelFetchMessage ? (
                <p
                  className={`mb-3 rounded-md px-3 py-2 text-xs ${
                    modelFetchState === "failed"
                      ? "bg-red-50 text-red-600"
                      : "bg-[var(--color-surface-container-lowest)] text-[var(--color-text-secondary)]"
                  }`}
                >
                  {modelFetchMessage}
                </p>
              ) : null}
              {fetchedModelIds.length > 0 ? (
                <div className="mb-4 rounded-md border border-[var(--color-border)] bg-white p-3">
                  <div className="mb-2 text-sm font-medium text-[var(--color-text-primary)]">
                    可添加模型
                  </div>
                  <OverlayScrollArea
                    contentKey={fetchedModelIds.join("|")}
                    viewportClassName="max-h-52 space-y-2 overflow-auto pr-1"
                  >
                    {fetchedModelIds.map((modelId) => {
                      const isAdded = draft.models.some((model) => model.id === modelId);

                      return (
                        <div
                          className="flex items-center justify-between gap-3 rounded-md bg-[var(--color-surface-container-lowest)] px-3 py-2"
                          key={modelId}
                        >
                          <code className="min-w-0 break-all text-xs text-[var(--color-text-primary)]">
                            {modelId}
                          </code>
                          <Button
                            disabled={isAdded}
                            onClick={() => addModel(modelId)}
                            type="button"
                            variant="outline"
                          >
                            {isAdded ? "已添加" : "添加"}
                          </Button>
                        </div>
                      );
                    })}
                  </OverlayScrollArea>
                </div>
              ) : null}
              <div className="space-y-3">
                {draft.models.map((model) => (
                  <div className="rounded-md bg-[var(--color-surface-container-lowest)] p-3" key={model.id}>
                    <div className="mb-3 grid grid-cols-[1fr_160px_140px_auto_auto] items-center gap-2">
                      <Input
                        className="h-9 font-mono text-xs"
                        onChange={(event) => updateModelId(model.id, event.target.value)}
                        placeholder="模型 ID"
                        value={model.id}
                      />
                      <Input
                        className="h-9 text-xs"
                        onChange={(event) => updateModelAlias(model.id, event.target.value)}
                        placeholder="显示别名"
                        value={model.alias ?? ""}
                      />
                      <Input
                        className="h-9 w-full"
                        onChange={(event) => updateContextWindow(model.id, event.target.value)}
                        placeholder="上下文窗口，例如 128000"
                        type="number"
                        value={model.contextWindow ?? draft.contextWindows[model.id] ?? ""}
                      />
                      <button
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          model.enabled
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-[var(--color-border)] text-[var(--color-text-tertiary)]"
                        }`}
                        onClick={() => toggleModelEnabled(model.id)}
                        type="button"
                      >
                        {model.enabled ? "已启用" : "已屏蔽"}
                      </button>
                      <button
                        className="flex size-8 items-center justify-center rounded-full text-[var(--color-text-tertiary)] hover:bg-white"
                        onClick={() => removeModel(model.id)}
                        title="移除模型"
                        type="button"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {MODALITY_OPTIONS.map((option) => {
                        const checked = model.modalities.includes(option.value);

                        return (
                          <button
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                              checked
                                ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand)]"
                                : "border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
                            }`}
                            key={option.value}
                            onClick={() => toggleModality(model.id, option.value)}
                            title={option.description}
                            type="button"
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>

          </div>
        </OverlayScrollArea>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-4">
          <div className="text-sm">
            {providerSaveState === "saved" ? (
              <span className="text-emerald-600">已保存，窗口保持打开</span>
            ) : null}
            {providerSaveState === "failed" ? (
              <span className="text-red-600">保存失败，请稍后重试</span>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
          <Button onClick={onClose} type="button" variant="outline">
            取消
          </Button>
          <Button
            className="min-w-28 bg-zinc-950 text-white hover:bg-zinc-800 disabled:bg-zinc-400"
            disabled={providerSaveState === "saving" || Boolean(proxyUrlError)}
            onClick={() => void saveProvider()}
            type="button"
          >
            {providerSaveState === "saving" ? "保存中..." : "保存"}
          </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function Field({
  children,
  label,
  required,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-[var(--color-text-primary)]">
      <span>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function Select({
  onChange,
  options,
  value,
}: {
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="relative">
      <select
        className="h-11 w-full appearance-none rounded-md border border-[var(--color-border)] bg-white px-3 pr-9 text-sm text-[var(--color-text-primary)] outline-none transition focus:border-[#96573f] focus:ring-2 focus:ring-[#96573f]/15"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
    </div>
  );
}

function ProviderProxyFields({
  networkProxy,
  onChange,
}: {
  networkProxy: NetworkProxyConfig;
  onChange: (value: NetworkProxyConfig) => void;
}) {
  const proxyUrlError =
    networkProxy.mode === "custom"
      ? validateProxyUrl(networkProxy.url)
      : "";

  return (
    <section className="space-y-4 rounded-md border border-[var(--color-border)] p-3.5">
      <div>
        <h3 className="text-base font-medium text-[var(--color-text-primary)]">
          网络代理
        </h3>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          仅应用于当前服务商的模型、图片及模型列表请求。
        </p>
      </div>
      <div className="space-y-4">
        <Field label="连接方式">
          <Select
            onChange={(value) =>
              onChange({
                ...networkProxy,
                mode: value as NetworkProxyConfig["mode"],
              })
            }
            options={NETWORK_PROXY_MODE_OPTIONS}
            value={networkProxy.mode}
          />
        </Field>

        {networkProxy.mode === "environment" ? (
          <p className="rounded-md bg-[var(--color-surface-container-low)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
            按顺序读取 HTTPS_PROXY、HTTP_PROXY、ALL_PROXY 及 NO_PROXY 环境变量。
          </p>
        ) : null}

        {networkProxy.mode === "direct" ? (
          <p className="rounded-md bg-[var(--color-surface-container-low)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
            当前服务商始终直连，不使用代理。
          </p>
        ) : null}

        {networkProxy.mode === "custom" ? (
          <>
            <Field label="代理地址" required>
              <Input
                onChange={(event) =>
                  onChange({ ...networkProxy, url: event.target.value })
                }
                placeholder="例如：http://127.0.0.1:7890"
                spellCheck={false}
                value={networkProxy.url}
              />
              {proxyUrlError ? (
                <p className="mt-1.5 text-xs text-red-600">{proxyUrlError}</p>
              ) : null}
            </Field>
            <Field label="直连地址">
              <Input
                onChange={(event) =>
                  onChange({ ...networkProxy, noProxy: event.target.value })
                }
                placeholder="localhost,127.0.0.1,::1"
                spellCheck={false}
                value={networkProxy.noProxy}
              />
              <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">
                使用英文逗号分隔；localhost、127.0.0.1 和 ::1 始终直连。
              </p>
            </Field>
          </>
        ) : null}
      </div>
    </section>
  );
}

function ProviderProxyModal({
  onClose,
  onSave,
  provider,
}: {
  onClose: () => void;
  onSave: (provider: ModelProviderConfig) => Promise<ModelProviderConfig>;
  provider: ModelProviderConfig;
}) {
  const [draft, setDraft] = useState(provider);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const proxyUrlError =
    draft.networkProxy.mode === "custom"
      ? validateProxyUrl(draft.networkProxy.url)
      : "";

  async function save() {
    setSaveState("saving");
    try {
      const saved = await onSave(draft);
      setDraft(saved);
      setSaveState("saved");
      window.setTimeout(onClose, 500);
    } catch {
      setSaveState("failed");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-6">
      <div className="zenme-shadow-overlay w-full max-w-lg overflow-hidden rounded-xl bg-white">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-medium text-[var(--color-text-primary)]">
              {provider.name} 代理设置
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-tertiary)]">
              浏览器中的授权页面仍遵循浏览器自身网络设置。
            </p>
          </div>
          <button
            className="flex size-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </header>
        <div className="p-5">
          <ProviderProxyFields
            networkProxy={draft.networkProxy}
            onChange={(networkProxy) =>
              setDraft((current) => ({ ...current, networkProxy }))
            }
          />
        </div>
        <footer className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] px-5 py-4">
          {saveState === "failed" ? (
            <span className="mr-auto text-sm text-red-600">保存失败</span>
          ) : null}
          <Button onClick={onClose} type="button" variant="outline">
            取消
          </Button>
          <Button
            className="bg-[#96573f] text-white hover:bg-[#854b36]"
            disabled={saveState === "saving" || Boolean(proxyUrlError)}
            onClick={() => void save()}
            type="button"
          >
            {saveState === "saving" ? "保存中..." : "保存"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function LocalDataSettings({
  directoryState,
  effectiveDataDir,
  isDesktop,
  openDataDir,
  restoreBackup,
  restoreMessage,
  restoreState,
  selectDataDir,
}: {
  directoryState: "idle" | "choosing" | "opening" | "failed";
  effectiveDataDir: string;
  isDesktop: boolean;
  openDataDir: () => void;
  restoreBackup: (file: File | undefined) => void;
  restoreMessage: string;
  restoreState: "idle" | "restoring" | "done" | "failed";
  selectDataDir: () => void;
}) {
  return (
    <section className="max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <HardDrive className="size-5 text-[var(--color-text-secondary)]" />
        <h2 className="text-xl font-medium text-[var(--color-text-primary)]">
          本地数据
        </h2>
      </div>
      <div className="space-y-3 rounded-md border border-[var(--color-border)] bg-white p-4">
        <label className="block text-sm font-medium text-[var(--color-text-secondary)]">
          数据目录
        </label>
        <div className="flex gap-3">
          <Input className="font-mono text-sm" readOnly value={effectiveDataDir} />
          <Button
            disabled={!isDesktop || directoryState === "choosing"}
            onClick={selectDataDir}
            title={isDesktop ? "选择数据目录" : "仅桌面应用可选择数据目录"}
            type="button"
            variant="outline"
          >
            {directoryState === "choosing" ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : (
              <FolderOpen className="size-4" />
            )}
            选择
          </Button>
          <Button
            disabled={!isDesktop || directoryState === "opening"}
            onClick={openDataDir}
            title={isDesktop ? "打开数据目录" : "仅桌面应用可打开数据目录"}
            type="button"
            variant="outline"
          >
            打开
          </Button>
        </div>
        <p className="text-sm text-[var(--color-text-tertiary)]">
          {isDesktop
            ? "切换数据目录后，桌面壳会重启本地服务并重新加载工作台。"
            : "当前版本由本地服务管理数据目录；桌面应用中可选择和打开目录。"}
        </p>
        {directoryState === "failed" ? (
          <p className="text-sm text-red-600">数据目录操作失败</p>
        ) : null}
        <div className="border-t border-[var(--color-border)] pt-4">
          <p className="mb-3 text-sm text-[var(--color-text-tertiary)]">
            备份包含项目、画布和阅读资料，但不会包含模型 API 密钥。
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              className="inline-flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-low)]"
              href="/api/settings/backup"
            >
              <Download className="size-4" />
              下载备份
            </a>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-low)]">
              {restoreState === "restoring" ? (
                <RefreshCw className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              恢复备份
              <input
                accept=".zip,application/zip"
                className="sr-only"
                disabled={restoreState === "restoring"}
                onChange={(event) => {
                  restoreBackup(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
                type="file"
              />
            </label>
          </div>
          {restoreMessage ? (
            <p
              className={`mt-2 text-sm ${
                restoreState === "failed" ? "text-red-600" : "text-[var(--color-text-tertiary)]"
              }`}
            >
              {restoreMessage}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function validateProxyUrl(value: string) {
  if (!value.trim()) return "请输入代理地址。";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return "仅支持 HTTP 或 HTTPS 代理地址。";
    }
    return "";
  } catch {
    return "代理地址格式无效。";
  }
}

function SavePolicySettings({
  autoSaveIntervalMs,
  saveSettings,
  saveState,
  setAutoSaveIntervalMs,
}: {
  autoSaveIntervalMs: number;
  saveSettings: () => void;
  saveState: "idle" | "saving" | "saved" | "failed";
  setAutoSaveIntervalMs: (value: number) => void;
}) {
  return (
    <section className="max-w-3xl space-y-4">
      <h2 className="text-xl font-medium text-[var(--color-text-primary)]">
        保存策略
      </h2>
      <div className="grid gap-4 rounded-md border border-[var(--color-border)] bg-white p-4">
        <label className="grid gap-2 text-sm font-medium text-[var(--color-text-secondary)]">
          自动保存间隔
          <Input
            min={5}
            onChange={(event) =>
              setAutoSaveIntervalMs(Number(event.target.value) * 1000)
            }
            type="number"
            value={Math.round(autoSaveIntervalMs / 1000)}
          />
        </label>
        <div className="flex items-center gap-3">
          <Button disabled={saveState === "saving"} onClick={saveSettings} type="button">
            {saveState === "saving" ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : saveState === "saved" ? (
              <Check className="size-4" />
            ) : (
              <Save className="size-4" />
            )}
            保存
          </Button>
          {saveState === "failed" ? (
            <span className="text-sm text-red-600">保存失败</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function collectProviderModalities(provider: ModelProviderConfig) {
  return Array.from(
    new Set(
      provider.models.flatMap((model) => model.modalities),
    ),
  );
}

function getProviderModelSummary(provider: ModelProviderConfig) {
  const enabledModels = provider.models.filter((model) => model.enabled);
  const textCount = enabledModels.filter((model) =>
    model.modalities.includes("text"),
  ).length;
  const imageCount = enabledModels.filter((model) =>
    model.modalities.includes("image"),
  ).length;
  const videoCount = enabledModels.filter((model) =>
    model.modalities.includes("video"),
  ).length;
  if (enabledModels.length === 0) {
    return "未启用模型";
  }
  return `${enabledModels.length} 个启用模型 · 文本 ${textCount} · 图片 ${imageCount} · 视频 ${videoCount}`;
}

function getApiFormatLabel(value: ModelProviderApiFormat) {
  if (value === "openai_oauth") return "ChatGPT OAuth";
  return API_FORMAT_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getProviderProtocolSummary(preset: ModelProviderPresetId) {
  if (preset === "zhipu") return "Zhipu GLM · Bearer Token";
  if (preset === "volcengine_agent_plan") {
    return "Responses API / Seedream · Bearer Token";
  }
  if (preset === "volcengine_ark") {
    return "视频生成任务 API · Bearer Token";
  }
  if (preset === "openrouter") {
    return "OpenRouter Images / Chat · Bearer Token";
  }
  if (preset === "ollama") {
    return "OpenAI Chat Completions · 本机无需认证";
  }
  return "通用兼容接口";
}

function getModalityLabel(value: ModelModality) {
  return MODALITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function prepareProviderForSave(provider: ModelProviderConfig): ModelProviderConfig {
  const models = provider.models
    .map((model) => ({
      ...model,
      alias: model.alias?.trim() ?? "",
      id: model.id.trim(),
      modalities: model.modalities.length > 0 ? model.modalities : ["text" as const],
    }))
    .filter((model) => model.id);
  const contextWindows = Object.fromEntries(
    models.flatMap((model) =>
      typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow)
        ? [[model.id, Math.max(0, Math.floor(model.contextWindow))]]
        : [],
    ),
  );
  const modelModalities = Object.fromEntries(
    models.map((model) => [model.id, model.modalities]),
  );
  const firstTextModel =
    models.find(
      (model) => model.enabled && model.modalities.includes("text"),
    )?.id ?? "";
  const firstImageModel =
    models.find(
      (model) => model.enabled && model.modalities.includes("image"),
    )?.id ?? "";
  const firstVideoModel =
    models.find(
      (model) => model.enabled && model.modalities.includes("video"),
    )?.id ?? "";
  const main = models.some((model) => model.id === provider.modelMapping.main)
    ? provider.modelMapping.main
    : firstTextModel;
  const image = models.some((model) => model.id === provider.modelMapping.image)
    ? provider.modelMapping.image
    : firstImageModel;
  const video = models.some((model) => model.id === provider.modelMapping.video)
    ? provider.modelMapping.video
    : firstVideoModel;

  return {
    ...provider,
    contextWindows,
    modelMapping: {
      main,
      image,
      video,
    },
    modelModalities,
    models,
  };
}
