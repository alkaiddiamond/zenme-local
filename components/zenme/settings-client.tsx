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
  RefreshCw,
  Save,
  Server,
  Settings2,
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
  NetworkProxyConfig,
  ZenmeLocalSettings,
  ZenmeTheme,
} from "@/lib/local/settings";
import { announceThemePreference } from "@/components/zenme/theme-controller";
import {
  createModelProviderPreset,
  identifyModelProviderPreset,
  type ModelProviderPresetId,
} from "@/lib/ai/provider-presets";

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

type SettingsTab = "appearance" | "models" | "usage" | "local" | "save";

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
  const [activeTab, setActiveTab] = useState<SettingsTab>("models");
  const [autoSaveIntervalMs, setAutoSaveIntervalMs] = useState(5_000);
  const [theme, setTheme] = useState<ZenmeTheme>("light");
  const [modelProviders, setModelProviders] = useState<ModelProviderConfig[]>([]);
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
      setModelProviders(nextPayload.settings.modelProviders);
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
    theme?: ZenmeTheme;
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
      setTheme(nextPayload.settings.theme);
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
              active={activeTab === "appearance"}
              icon={<Sun className="size-5" />}
              label="外观"
              onClick={() => setActiveTab("appearance")}
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
          {activeTab === "appearance" ? (
            <AppearanceSettings
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
    description: "自动匹配系统外观设置",
    icon: <Monitor className="size-5" />,
    label: "跟随系统",
    value: "system",
  },
];

function AppearanceSettings({
  onChange,
  saveState,
  theme,
}: {
  onChange: (theme: ZenmeTheme) => void;
  saveState: "idle" | "saving" | "saved" | "failed";
  theme: ZenmeTheme;
}) {
  return (
    <section className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-xl font-medium text-[var(--color-text-primary)]">外观</h2>
        <p className="mt-1 text-sm text-[var(--color-text-tertiary)]">
          主题会应用到工作台、画布、节点、阅读器和所有弹层。
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4" role="radiogroup" aria-label="界面主题">
        {THEME_OPTIONS.map((option) => {
          const selected = theme === option.value;
          return (
            <button
              aria-checked={selected}
              className={`group overflow-hidden rounded-xl border text-left transition focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                selected
                  ? "border-[var(--color-border-focus)] ring-1 ring-[var(--color-border-focus)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
              }`}
              key={option.value}
              onClick={() => onChange(option.value)}
              role="radio"
              type="button"
            >
              <ThemePreview theme={option.value} />
              <span className="flex items-start gap-3 bg-[var(--color-surface-container-lowest)] px-4 py-3.5">
                <span className="mt-0.5 text-[var(--color-text-secondary)]">{option.icon}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                    {option.label}
                    {selected ? <Check className="size-4" /> : null}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-[var(--color-text-tertiary)]">
                    {option.description}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="text-sm text-[var(--color-text-tertiary)]">
        {saveState === "saving"
          ? "正在保存主题…"
          : saveState === "saved"
            ? "主题已保存"
            : saveState === "failed"
              ? "主题保存失败，请重试"
              : "切换后立即生效。"}
      </p>
    </section>
  );
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
                </div>
              </div>
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
