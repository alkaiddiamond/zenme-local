"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  ImageIcon,
  Plus,
  RefreshCw,
  Save,
  Server,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  ModelModality,
  ModelProviderApiFormat,
  ModelProviderAuthType,
  ModelProviderConfig,
  ZenmeLocalSettings,
} from "@/lib/local/settings";

type SettingsPayload = {
  mode: "local";
  settings: ZenmeLocalSettings;
};

type ZenmeDesktopApi = {
  getDataDir: () => Promise<string>;
  openDataDir: () => Promise<string>;
  selectDataDir: () => Promise<{
    canceled: boolean;
    dataDir: string;
    restarted: boolean;
  }>;
};

type SettingsTab = "models" | "local" | "save";

const API_FORMAT_OPTIONS: Array<{
  label: string;
  value: ModelProviderApiFormat;
}> = [
  { label: "OpenAI Chat Completions", value: "openai" },
  { label: "Anthropic Messages", value: "anthropic" },
  { label: "OpenRouter Images / Chat", value: "openrouter" },
  { label: "Zhipu GLM", value: "zhipu" },
  { label: "自定义", value: "custom" },
];

const AUTH_TYPE_OPTIONS: Array<{
  label: string;
  value: ModelProviderAuthType;
}> = [
  { label: "Bearer Token", value: "bearer" },
  { label: "API Key Header", value: "api-key" },
  { label: "无需认证", value: "none" },
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
  const [modelProviders, setModelProviders] = useState<ModelProviderConfig[]>([]);
  const [editingProvider, setEditingProvider] = useState<ModelProviderConfig | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [restoreState, setRestoreState] = useState<"idle" | "restoring" | "done" | "failed">("idle");
  const [restoreMessage, setRestoreMessage] = useState("");
  const [directoryState, setDirectoryState] = useState<"idle" | "choosing" | "opening" | "failed">("idle");

  useEffect(() => {
    async function loadSettings() {
      setIsDesktop(Boolean(window.zenmeDesktop));
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) return;
      const nextPayload = await response.json() as SettingsPayload;
      setPayload(nextPayload);
      setAutoSaveIntervalMs(nextPayload.settings.autoSaveIntervalMs);
      setModelProviders(nextPayload.settings.modelProviders);
      const dataDir = await window.zenmeDesktop?.getDataDir();
      setDesktopDataDir(dataDir ?? "");
    }

    void loadSettings();
  }, []);

  async function saveSettings() {
    await persistSettings({
      autoSaveIntervalMs,
      modelProviders,
    });
  }

  async function persistSettings(updates: {
    autoSaveIntervalMs?: number;
    modelProviders?: ModelProviderConfig[];
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
    const nextProviders = ensureSingleDefaultProvider(
      exists
        ? modelProviders.map((item) => item.id === provider.id ? provider : item)
        : [...modelProviders, provider],
    );

    setModelProviders(nextProviders);
    const nextPayload = await persistSettings({ modelProviders: nextProviders });
    const savedProvider = nextPayload?.settings.modelProviders.find(
      (item) => item.id === provider.id,
    );
    if (savedProvider) {
      setEditingProvider(savedProvider);
    }
    return savedProvider ?? provider;
  }

  function deleteProvider(providerId: string) {
    const nextProviders = ensureSingleDefaultProvider(
      modelProviders.filter((provider) => provider.id !== providerId),
    );
    setModelProviders(nextProviders);
    void persistSettings({ modelProviders: nextProviders });
  }

  function activateProvider(providerId: string) {
    const nextProviders = modelProviders.map((provider) => ({
        ...provider,
        enabled: provider.id === providerId ? true : provider.enabled,
        isDefault: provider.id === providerId,
      }));
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
            <h1 className="text-base font-semibold tracking-normal text-[var(--color-text-primary)]">
              设置
            </h1>
          </div>
          <nav className="space-y-1">
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
          {activeTab === "models" ? (
            <ModelProviderSettings
              activeProviderId={modelProviders.find((provider) => provider.isDefault)?.id}
              onActivateProvider={activateProvider}
              onAddProvider={() => setEditingProvider(createEmptyProvider())}
              onDeleteProvider={deleteProvider}
              onEditProvider={setEditingProvider}
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
          onClose={() => setEditingProvider(null)}
          onSave={upsertProvider}
          provider={editingProvider}
        />
      ) : null}
    </div>
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
          ? "bg-[var(--color-surface-container-high)] text-[var(--color-text-primary)]"
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

function ModelProviderSettings({
  activeProviderId,
  onActivateProvider,
  onAddProvider,
  onDeleteProvider,
  onEditProvider,
  providers,
}: {
  activeProviderId?: string;
  onActivateProvider: (providerId: string) => void;
  onAddProvider: () => void;
  onDeleteProvider: (providerId: string) => void;
  onEditProvider: (provider: ModelProviderConfig) => void;
  providers: ModelProviderConfig[];
}) {
  return (
    <section className="max-w-5xl">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
            模型配置
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            管理模型服务商、模型映射和模型模态能力。
          </p>
        </div>
        <Button className="bg-[#96573f] text-white hover:bg-[#854b36]" onClick={onAddProvider} type="button">
          <Plus className="size-4" />
          添加服务商
        </Button>
      </div>

      <div className="space-y-3">
        {providers.map((provider) => (
          <article
            className={`rounded-md border bg-white p-4 shadow-sm transition ${
              provider.id === activeProviderId
                ? "border-[#96573f]"
                : "border-[var(--color-border)]"
            }`}
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
                  <h3 className="truncate text-base font-semibold text-[var(--color-text-primary)]">
                    {provider.name}
                  </h3>
                  <span className="rounded-md bg-[var(--color-surface-container-high)] px-2 py-0.5 text-xs text-[var(--color-text-tertiary)]">
                    {getApiFormatLabel(provider.apiFormat)}
                  </span>
                  {provider.isDefault ? (
                    <span className="rounded-md bg-[#ead9d1] px-2 py-0.5 text-xs font-medium text-[#96573f]">
                      默认
                    </span>
                  ) : null}
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
                {!provider.isDefault ? (
                  <Button
                    onClick={() => onActivateProvider(provider.id)}
                    type="button"
                    variant="outline"
                  >
                    设为默认
                  </Button>
                ) : null}
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

function ProviderEditorModal({
  onClose,
  onSave,
  provider,
}: {
  onClose: () => void;
  onSave: (provider: ModelProviderConfig) => Promise<ModelProviderConfig>;
  provider: ModelProviderConfig;
}) {
  const [draft, setDraft] = useState<ModelProviderConfig>(provider);
  const [showApiKey, setShowApiKey] = useState(false);
  const [providerSaveState, setProviderSaveState] = useState<
    "idle" | "saving" | "saved" | "failed"
  >("idle");
  const [modelFetchState, setModelFetchState] = useState<
    "idle" | "loading" | "done" | "failed" | "unsupported"
  >("idle");
  const [modelFetchMessage, setModelFetchMessage] = useState("");
  const [fetchedModelIds, setFetchedModelIds] = useState<string[]>([]);
  const textModels = useMemo(
    () =>
      draft.models.filter(
        (model) => model.enabled && model.modalities.includes("text"),
      ),
    [draft.models],
  );
  const imageModels = useMemo(
    () =>
      draft.models.filter(
        (model) => model.enabled && model.modalities.includes("image"),
      ),
    [draft.models],
  );
  async function saveProvider() {
    setProviderSaveState("saving");
    try {
      const savedProvider = await onSave(
        prepareProviderForSave(draft),
      );
      setDraft(savedProvider);
      setProviderSaveState("saved");
      window.setTimeout(() => setProviderSaveState("idle"), 1400);
    } catch {
      setProviderSaveState("failed");
    }
  }

  function updateDefaultModel(
    key: "main" | "imageEdit",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      modelMapping: {
        ...current.modelMapping,
        [key]: value,
      },
    }));
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
        imageEdit:
          current.modelMapping.imageEdit === previousId
            ? id
            : current.modelMapping.imageEdit,
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
        imageEdit:
          current.modelMapping.imageEdit === modelId
            ? ""
            : current.modelMapping.imageEdit,
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
      <div className="flex max-h-[calc(100vh-160px)] min-h-0 w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            编辑服务商
          </h2>
          <button
            className="flex size-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container-low)]"
            onClick={onClose}
            type="button"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid gap-4">
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

            <div className="grid gap-4">
              <Field label="API 格式">
                <Select
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      apiFormat: value as ModelProviderApiFormat,
                    }))
                  }
                  options={API_FORMAT_OPTIONS}
                  value={draft.apiFormat}
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

            <Field label="API 密钥">
              <div className="relative">
                <Input
                  className="pr-11"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, apiKey: event.target.value }))
                  }
                  placeholder="留空表示使用环境变量或无需认证"
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

            <section className="grid gap-4 rounded-md border border-[var(--color-border)] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                    默认模型
                  </h3>
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    节点会直接显示启用模型；这里仅决定新建节点的默认选择。
                  </p>
                </div>
                <Button onClick={() => addModel()} type="button" variant="outline">
                  <Plus className="size-4" />
                  添加模型
                </Button>
              </div>
              <Field label="默认文本模型">
                <Select
                  onChange={(value) => updateDefaultModel("main", value)}
                  options={[
                    { label: "未选择", value: "" },
                    ...textModels.map((model) => ({
                      label: model.alias?.trim() || model.id,
                      value: model.id,
                    })),
                  ]}
                  value={draft.modelMapping.main ?? ""}
                />
              </Field>
              <Field label="默认图片模型">
                <Select
                  onChange={(value) => updateDefaultModel("imageEdit", value)}
                  options={[
                    { label: "未选择", value: "" },
                    ...imageModels.map((model) => ({
                      label: model.alias?.trim() || model.id,
                      value: model.id,
                    })),
                  ]}
                  value={draft.modelMapping.imageEdit ?? ""}
                />
              </Field>
            </section>

            <section className="rounded-md border border-[var(--color-border)] p-3.5">
              <div className="mb-4 flex items-start gap-3">
                <ImageIcon className="mt-0.5 size-5 text-[#96573f]" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                    模型列表
                  </h3>
                  <p className="text-sm text-[var(--color-text-tertiary)]">
                    文本节点只显示启用且包含“文本”模态的模型；图片编辑节点只使用图片模型。
                  </p>
                </div>
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
                  <div className="max-h-52 space-y-2 overflow-auto pr-1">
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
                  </div>
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
                                ? "border-[#96573f] bg-[#ead9d1] text-[#96573f]"
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
        </div>

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
            className="min-w-28 bg-zinc-950 text-white shadow-lg shadow-zinc-950/15 hover:bg-zinc-800 disabled:bg-zinc-400"
            disabled={providerSaveState === "saving"}
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
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
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
      <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">
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

function createEmptyProvider(): ModelProviderConfig {
  return {
    id: crypto.randomUUID(),
    name: "新服务商",
    note: "",
    baseUrl: "",
    apiFormat: "openai",
    authType: "bearer",
    apiKey: "",
    enabled: true,
    isDefault: false,
    modelMapping: {
      main: "",
      imageEdit: "",
    },
    models: [],
    contextWindows: {},
    modelModalities: {},
  };
}

function ensureSingleDefaultProvider(providers: ModelProviderConfig[]) {
  if (providers.length === 0) {
    return providers;
  }

  const defaultIndex = providers.findIndex((provider) => provider.isDefault);
  const targetIndex = defaultIndex === -1 ? 0 : defaultIndex;
  return providers.map((provider, index) => ({
    ...provider,
    isDefault: index === targetIndex,
  }));
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
  if (enabledModels.length === 0) {
    return "未启用模型";
  }
  return `${enabledModels.length} 个启用模型 · 文本 ${textCount} · 图片 ${imageCount}`;
}

function getApiFormatLabel(value: ModelProviderApiFormat) {
  return API_FORMAT_OPTIONS.find((option) => option.value === value)?.label ?? value;
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
  const main = models.some((model) => model.id === provider.modelMapping.main)
    ? provider.modelMapping.main
    : firstTextModel;
  const imageEdit = models.some((model) => model.id === provider.modelMapping.imageEdit)
    ? provider.modelMapping.imageEdit
    : firstImageModel;

  return {
    ...provider,
    contextWindows,
    modelMapping: {
      main,
      imageEdit,
    },
    modelModalities,
    models,
  };
}
