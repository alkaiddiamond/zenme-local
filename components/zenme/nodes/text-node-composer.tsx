"use client";

import { type CSSProperties, type FormEvent, useEffect, useRef, useState } from "react";
import { useViewport } from "@xyflow/react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Plus,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  X,
} from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import { createImagePreview } from "@/components/zenme/canvas/files";
import {
  rememberAiModelPreference,
  rememberTextGenerationPreferences,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ZenmeModelSpeed, ZenmeReasoningEffort, ZenmeSessionPermissionMode } from "@/lib/local/settings";

const PERMISSION_OPTIONS: Array<{
  description: string;
  label: string;
  value: ZenmeSessionPermissionMode;
}> = [
  {
    value: "untrusted",
    label: "不可信",
    description: "采取操作前始终询问",
  },
  {
    value: "onRequest",
    label: "按请求",
    description: "Agent 请求提升权限时询问",
  },
  {
    value: "neverAsk",
    label: "从不请求审批",
    description: "受阻操作直接失败，不请求批准",
  },
];

const REASONING_OPTIONS: Array<{ label: string; value: ZenmeReasoningEffort }> = [
  { value: "low", label: "轻" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
];

function PermissionIcon({ mode }: { mode: ZenmeSessionPermissionMode }) {
  if (mode === "untrusted") {
    return <ShieldOff className="size-[18px]" />;
  }
  if (mode === "neverAsk") {
    return <ShieldCheck className="size-[18px]" />;
  }
  return <ShieldAlert className="size-[18px]" />;
}

export function TextNodeComposer({
  nodeData,
  nodeId,
}: {
  nodeData: CanvasNodeData;
  nodeId: string;
}) {
  const { zoom } = useViewport();
  const [prompt, setPrompt] = useState(nodeData.textGenerationPrompt ?? "");
  const [model, setModel] = useState(
    nodeData.textGenerationModel ?? "",
  );
  const [permissionMode, setPermissionMode] =
    useState<ZenmeSessionPermissionMode>("onRequest");
  const [permissionModeOverridden, setPermissionModeOverridden] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ZenmeReasoningEffort>("low");
  const [modelSpeed, setModelSpeed] = useState<ZenmeModelSpeed>("standard");
  const [images, setImages] = useState<Array<{ dataUrl: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isGenerating = isSubmitting || Boolean(
    nodeData.hasRunningGenerationChild || nodeData.hasRunningAgentTurn,
  );
  const hasSteeringPrompt = Boolean(prompt.trim());
  const configuredModels = useAiModelOptions();
  const preferredModel = configuredModels[0]?.id ?? "";
  const pickerModels = configuredModels;
  const composerScale = 1 / Math.max(zoom, 0.2);
  const composerStyle: CSSProperties = {
    top: `calc(100% + ${12 / Math.max(zoom, 0.2)}px)`,
    transform: `translateX(-50%) scale(${composerScale})`,
    transformOrigin: "top center",
  };

  useEffect(() => {
    setPrompt(nodeData.textGenerationPrompt ?? "");
  }, [nodeData.textGenerationPrompt]);

  useEffect(() => {
    setModel(nodeData.textGenerationModel ?? preferredModel);
  }, [nodeData.textGenerationModel, preferredModel]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void fetch("/api/settings", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("会话权限加载失败");
        }
        return response.json() as Promise<{
          settings?: {
            defaultSessionPermissionMode?: ZenmeSessionPermissionMode;
            defaultReasoningEffort?: ZenmeReasoningEffort;
            defaultModelSpeed?: ZenmeModelSpeed;
          };
        }>;
      })
      .then((payload) => {
        if (cancelled) return;
        const nextMode = payload.settings?.defaultSessionPermissionMode;
        if (nextMode) setPermissionMode(nextMode);
        if (payload.settings?.defaultReasoningEffort) setReasoningEffort(payload.settings.defaultReasoningEffort);
        if (payload.settings?.defaultModelSpeed) setModelSpeed(payload.settings.defaultModelSpeed);
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === "AbortError")) {
          setError(loadError instanceof Error ? loadError.message : "会话权限加载失败");
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nodeData.projectId]);

  function syncComposerState(nextState?: {
    model?: string;
    prompt?: string;
  }) {
    nodeData.onUpdateTextGenerationNode?.(nodeId, {
      textGenerationModel: nextState?.model ?? model,
      textGenerationPrompt: nextState?.prompt ?? prompt,
    });
  }

  function handleModelChange(nextModel: string) {
    setModel(nextModel);
    syncComposerState({ model: nextModel });
    void rememberAiModelPreference("text", nextModel);
  }

  function handlePermissionChange(nextMode: ZenmeSessionPermissionMode) {
    setPermissionMode(nextMode);
    setPermissionModeOverridden(true);
    setError(null);
  }

  function handleReasoningEffortChange(nextEffort: ZenmeReasoningEffort) {
    setReasoningEffort(nextEffort);
    void rememberTextGenerationPreferences({ reasoningEffort: nextEffort });
  }

  function handleModelSpeedChange() {
    const nextSpeed = modelSpeed === "fast" ? "standard" : "fast";
    setModelSpeed(nextSpeed);
    void rememberTextGenerationPreferences({ modelSpeed: nextSpeed });
  }

  async function addImages(files: FileList | null) {
    if (!files?.length) return;
    const available = Math.max(0, 4 - images.length);
    const selected = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .slice(0, available);
    if (!selected.length) {
      setError(available === 0 ? "单次最多添加 4 张图片" : "请选择图片文件");
      return;
    }
    setError(null);
    try {
      const previews = await Promise.all(selected.map(async (file) => ({
        dataUrl: (await createImagePreview(file)).dataUrl,
        name: file.name,
      })));
      setImages((current) => [...current, ...previews].slice(0, 4));
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : "图片读取失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (isGenerating) {
      if (!nextPrompt) return;
      setError(null);
      try {
        await nodeData.onSteerTextGenerationNode?.(nodeId, nextPrompt);
        setPrompt("");
        syncComposerState({ prompt: "" });
      } catch (steeringError) {
        setError(steeringError instanceof Error ? steeringError.message : "补充指令提交失败");
      }
      return;
    }

    setError(null);
    setIsSubmitting(true);
    syncComposerState({ prompt: nextPrompt });
    try {
      await nodeData.onSubmitTextGenerationNode?.(nodeId, {
        imageDataUrls: images.map((image) => image.dataUrl),
        model,
        modelSpeed,
        permissionMode: permissionModeOverridden ? permissionMode : undefined,
        prompt: nextPrompt,
        reasoningEffort,
      });
      setImages([]);
    } catch (submitError) {
      if (submitError instanceof DOMException && submitError.name === "AbortError") return;
      setError(
        submitError instanceof Error ? submitError.message : "文本生成失败",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form
      aria-label="节点对话框"
      className="zenme-node-floating-control zenme-shadow-canvas nodrag nowheel absolute left-1/2 z-50 flex min-h-[220px] w-[640px] max-w-[calc(100vw-48px)] flex-col rounded-xl border border-zinc-200 bg-white p-3 text-zinc-950"
      onSubmit={submit}
      style={composerStyle}
    >
      <textarea
        aria-label="消息"
        className="zenme-text-ai-input min-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-6 text-zinc-900 caret-zinc-950 outline-none placeholder:text-zinc-400 focus:placeholder:text-transparent"
        onBlur={() => syncComposerState()}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" ||
            event.shiftKey ||
            event.nativeEvent.isComposing
          ) {
            return;
          }

          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }}
        placeholder="基于这个节点继续提问或执行任务…"
        value={prompt}
      />
      {images.length ? (
        <div aria-label="已添加图片" className="flex flex-wrap gap-2 px-1 pt-2">
          {images.map((image, index) => (
            <span className="group/image relative size-12 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100" key={`${image.name}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local transient data URL preview */}
              <img alt={image.name} className="size-full object-cover" src={image.dataUrl} />
              <button aria-label={`移除 ${image.name}`} className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-zinc-950/75 text-white opacity-0 transition group-hover/image:opacity-100 focus-visible:opacity-100" onClick={() => setImages((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? (
        <p className="mt-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs leading-5 text-red-600">
          {error}
        </p>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <div className="flex items-center gap-1">
          <input accept="image/*" aria-label="添加图片" className="sr-only" multiple onChange={(event) => void addImages(event.target.files)} ref={fileInputRef} type="file" />
          <button aria-label="添加图片上下文" className="flex size-8 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]" onClick={() => fileInputRef.current?.click()} title="添加图片上下文" type="button">
            <Plus className="size-5" />
          </button>
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="会话权限"
              className={`inline-flex h-9 items-center gap-2 rounded-full px-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                permissionMode === "onRequest"
                  ? "text-amber-700 hover:bg-amber-50"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-container)]"
              }`}
              type="button"
            >
              <PermissionIcon mode={permissionMode} />
              <span>{PERMISSION_OPTIONS.find((option) => option.value === permissionMode)?.label}</span>
              <ChevronDown className="size-4 opacity-70" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="nodrag nopan nowheel zenme-shadow-dropdown w-[330px] rounded-2xl border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] p-1.5"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            side="top"
            sideOffset={8}
          >
            {PERMISSION_OPTIONS.map((option) => (
              <DropdownMenuItem
                className="cursor-pointer items-start rounded-xl px-3 py-2.5 focus:bg-[var(--color-surface-container)]"
                key={option.value}
                onSelect={() => void handlePermissionChange(option.value)}
              >
                <PermissionIcon mode={option.value} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--color-text-primary)]">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-[var(--color-text-tertiary)]">{option.description}</span>
                </span>
                {option.value === permissionMode ? <Check className="mt-0.5 size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center gap-1.5">
          <select aria-label="推理强度" className="h-9 rounded-full border border-zinc-200 bg-white px-2 text-xs text-zinc-700 outline-none" onChange={(event) => handleReasoningEffortChange(event.target.value as ZenmeReasoningEffort)} title="本轮推理强度" value={reasoningEffort}>
            {REASONING_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <button aria-pressed={modelSpeed === "fast"} className={`h-9 rounded-full border px-3 text-xs transition ${modelSpeed === "fast" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"}`} onClick={handleModelSpeedChange} title="快速模式可能消耗更多额度或产生更高费用" type="button">
            {modelSpeed === "fast" ? "快速" : "标准"}
          </button>
          <ZenmeModelPicker
            compact
            icon={<Sparkles className="size-3.5" />}
            model={model}
            models={pickerModels}
            onChange={handleModelChange}
          />
          {isGenerating && !hasSteeringPrompt ? (
            <button
              aria-busy
              aria-label="停止"
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-zinc-950 text-white transition-colors hover:bg-zinc-800 active:bg-black focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)]"
              key="stop"
              onClick={() => nodeData.onStopTextGenerationNode?.(nodeId)}
              title="停止"
              type="button"
            >
              <span aria-hidden="true" className="size-4 rounded-[2px] bg-white" />
            </button>
          ) : (
            <button
              aria-busy={isGenerating}
              aria-label={isGenerating ? "追加指令" : "提交"}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-colors hover:bg-zinc-800 active:bg-black focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] disabled:cursor-not-allowed disabled:bg-zinc-300"
              disabled={!configuredModels.some((option) => option.id === model)}
              key="submit"
              title={isGenerating ? "追加指令" : "提交"}
              type="submit"
            >
              <ArrowUp className="size-5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
