"use client";

import {
  type FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import {
  Check,
  ChevronDown,
  ImageIcon,
  ImagePlus,
  Loader2,
  Plus,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  getImageEditAspectRatioOption,
  getImageEditQualityOption,
  IMAGE_EDIT_ASPECT_RATIO_OPTIONS,
  IMAGE_EDIT_QUALITY_OPTIONS,
} from "@/components/zenme/image-edit-options";
import {
  NodeActionHandle,
  NodeContextHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { NANO_BANANA_2_IMAGE_MODEL } from "@/components/zenme/canvas/node-factories";
import {
  createModelOption,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import {
  getImageEditPreferences,
  rememberImageEditPreferences,
} from "@/components/zenme/image-edit-preferences";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { ImageTaskTiming } from "@/components/zenme/nodes/image-task-timing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ImageGenerationNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const imageModelOptions = useAiModelOptions("image");
  const rememberedPreferences = getImageEditPreferences();
  const [prompt, setPrompt] = useState(nodeData.imagePrompt ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>(
    getImageEditAspectRatioOption(
      nodeData.imageOutputAspectRatio ?? rememberedPreferences.aspectRatio,
    ).value,
  );
  const [quality, setQuality] = useState<string>(
    getImageEditQualityOption(
      nodeData.imageQuality ?? rememberedPreferences.quality,
    ).value,
  );
  const [model, setModel] = useState(
    nodeData.imageModel ??
      rememberedPreferences.modelId ??
      imageModelOptions[0]?.id ??
      NANO_BANANA_2_IMAGE_MODEL,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [referencePickerRequest, setReferencePickerRequest] = useState(0);
  const isEditing = isSubmitting || nodeData.imageStatus === "editing";
  const isSubmissionLocked = isSubmitting || Boolean(nodeData.hasRunningGenerationChild);
  const isResultNode = Boolean(nodeData.imageGenerationResult);
  const aspectRatioOption = getImageEditAspectRatioOption(aspectRatio);
  const qualityOption = getImageEditQualityOption(quality);
  const imageModelId = model;
  const imageModelLabel =
    imageModelOptions.find((option) => option.id === imageModelId)?.label ??
    imageModelId;

  useEffect(() => {
    setPrompt(nodeData.imagePrompt ?? "");
  }, [nodeData.imagePrompt]);

  useEffect(() => {
    if (!nodeData.imageOutputAspectRatio) return;
    setAspectRatio(
      getImageEditAspectRatioOption(nodeData.imageOutputAspectRatio).value,
    );
  }, [nodeData.imageOutputAspectRatio]);

  useEffect(() => {
    if (!nodeData.imageQuality) return;
    setQuality(getImageEditQualityOption(nodeData.imageQuality).value);
  }, [nodeData.imageQuality]);

  useEffect(() => {
    const nextModel =
      nodeData.imageModel ??
      getImageEditPreferences().modelId ??
      imageModelOptions[0]?.id;
    if (nextModel) setModel(nextModel);
  }, [imageModelOptions, nodeData.imageModel]);

  function syncPrompt() {
    nodeData.onUpdateImageNode?.(id, {
      imageOutputAspectRatio: aspectRatio,
      imageModel: model,
      imagePrompt: prompt,
      imageQuality: quality,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isSubmissionLocked) {
      return;
    }

    setIsSubmitting(true);
    nodeData.onUpdateImageNode?.(id, {
      imageOutputAspectRatio: aspectRatio,
      imageModel: model,
      imagePrompt: nextPrompt,
      imageQuality: quality,
    });

    try {
      await nodeData.onSubmitImageNode?.(id, {
        aspectRatio,
        model,
        prompt: nextPrompt,
        quality,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={`zenme-image-edit-node group relative h-full w-full ${isRenaming ? "zenme-node-renaming" : ""}`}>
      {isResultNode ? (
        <ImageTaskTiming
          durationMs={nodeData.imageTaskDurationMs}
          running={isEditing}
          startedAt={nodeData.imageTaskStartedAt}
        />
      ) : null}
      <NodeTargetHandle
        revealOnHover={false}
        visible={Boolean(nodeData.hasIncomingEdge)}
      />
      <NodeEdgeSourceHandle
        visible={Boolean(nodeData.hasOutgoingEdge)}
      />
      <NodeContextHandle selected={Boolean(selected)} />
      <EditableNodeTitle
        fallbackTitle="图片生成"
        icon={<ImagePlus className="size-4" />}
        onCommit={(title) => nodeData.onUpdateImageNode?.(id, { title })}
        onEditingChange={setIsRenaming}
        title={nodeData.title}
      />
      {isResultNode ? (
        <div className="relative h-full min-h-[220px] w-full min-w-[420px] text-zinc-950">
          <div
            className={`zenme-shadow-node flex h-full min-h-[220px] items-center justify-center overflow-hidden rounded-xl border bg-white px-4 py-5 ${
              selected ? "border-zinc-900" : "border-zinc-200"
            }`}
          >
            <div className="flex flex-col items-center gap-3 text-center text-zinc-400">
              <ImageIcon className="size-12 stroke-[1.5]" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-500">
                  {isEditing ? "正在生成图片" : "图片生成未完成"}
                </p>
                <p className="max-w-[320px] text-xs leading-5">
                  {isEditing
                    ? "生成完成后，图片会显示在当前节点"
                    : nodeData.imageError ?? "请返回请求节点重新提交"}
                </p>
              </div>
              {isEditing ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <Loader2 className="size-3.5 animate-spin" />
                  正在生成图片...
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <form
          className="relative h-full min-h-[176px] w-full min-w-[420px] text-zinc-950"
          onSubmit={submit}
        >
          <div
            className={`zenme-shadow-node flex h-full min-h-[176px] flex-col rounded-xl border bg-white p-3 ${
              selected ? "border-zinc-900" : "border-zinc-200"
            }`}
          >
            <ImageReferencePicker
              candidates={nodeData.imageReferenceCandidates ?? []}
              onChange={(nodeIds) =>
                nodeData.onUpdateImageNode?.(id, { imageReferenceNodeIds: nodeIds })
              }
              openRequest={referencePickerRequest}
              references={nodeData.imageReferences ?? []}
              required={false}
            />
            <textarea
              className="zenme-text-ai-input nodrag nowheel min-h-10 flex-1 resize-none bg-transparent px-1 py-0.5 text-sm leading-5 text-zinc-900 outline-none placeholder:text-zinc-400"
              onBlur={syncPrompt}
              onChange={(event) => {
                const value = event.target.value;
                if (/(^|\s)@$/.test(value)) {
                  setPrompt(value.slice(0, -1));
                  setReferencePickerRequest((current) => current + 1);
                  return;
                }
                setPrompt(value);
              }}
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
              placeholder="描述想要生成的图片，或说明如何使用参考图"
              value={prompt}
            />
            {nodeData.imageError ? (
              <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs leading-4 text-red-600">
                {nodeData.imageError}
              </p>
            ) : null}
            {isSubmissionLocked ? (
              <div className="mt-1 flex items-center gap-2 px-1 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" />
                {imageModelLabel} 正在生成图片...
              </div>
            ) : null}

            <div className="nodrag nowheel mt-auto flex items-end justify-between gap-3 pt-2">
              <div className="flex min-w-0 items-center gap-2">
                <ZenmeModelPicker
                  icon={<Sparkles className="size-3.5" />}
                  model={model}
                  models={
                    imageModelOptions.some((option) => option.id === model)
                      ? imageModelOptions
                      : [createModelOption(model), ...imageModelOptions]
                  }
                  onChange={(nextModel) => {
                    setModel(nextModel);
                    nodeData.onUpdateImageNode?.(id, { imageModel: nextModel });
                    void rememberImageEditPreferences({ modelId: nextModel });
                  }}
                />
                <ImageEditSizePicker
                  aspectRatio={aspectRatioOption.value}
                  aspectRatioLabel={aspectRatioOption.label}
                  onAspectRatioChange={(nextAspectRatio) => {
                    setAspectRatio(nextAspectRatio);
                    nodeData.onUpdateImageNode?.(id, {
                      imageOutputAspectRatio: nextAspectRatio,
                      imagePrompt: prompt,
                      imageQuality: quality,
                    });
                    void rememberImageEditPreferences({
                      aspectRatio: nextAspectRatio,
                      modelId: model,
                      quality,
                    });
                  }}
                  onQualityChange={(nextQuality) => {
                    setQuality(nextQuality);
                    nodeData.onUpdateImageNode?.(id, {
                      imageOutputAspectRatio: aspectRatio,
                      imagePrompt: prompt,
                      imageQuality: nextQuality,
                    });
                    void rememberImageEditPreferences({
                      aspectRatio,
                      modelId: model,
                      quality: nextQuality,
                    });
                  }}
                  quality={qualityOption.value}
                  qualityLabel={qualityOption.label}
                />
              </div>
              <button
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                disabled={isSubmissionLocked || !prompt.trim()}
                title="生成图片"
                type="submit"
              >
                {isSubmissionLocked ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
          </div>
        </form>
      )}
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected && !isRenaming)}
        lineClassName="zenme-text-resize-line"
        minHeight={isResultNode ? 220 : 176}
        minWidth={420}
      />
      <NodeActionHandle selected={Boolean(selected && !isRenaming)} />
    </div>
  );
}

export function ImageReferencePicker({
  candidates,
  onChange,
  openRequest,
  references,
  required = false,
}: {
  candidates: NonNullable<CanvasNodeData["imageReferenceCandidates"]>;
  onChange: (nodeIds: string[]) => void;
  openRequest: number;
  references: NonNullable<CanvasNodeData["imageReferences"]>;
  required?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const previousOpenRequest = useRef(openRequest);
  const selectedIds = references.map((reference) => reference.nodeId);
  const filteredCandidates = candidates.filter((candidate) =>
    candidate.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (openRequest !== previousOpenRequest.current) {
      previousOpenRequest.current = openRequest;
      setIsOpen(true);
    }
  }, [openRequest]);

  function toggleReference(nodeId: string) {
    if (required && selectedIds.length === 1 && selectedIds[0] === nodeId) {
      return;
    }
    onChange(
      selectedIds.includes(nodeId)
        ? selectedIds.filter((id) => id !== nodeId)
        : [...selectedIds, nodeId],
    );
  }

  return (
    <div className="relative mb-2">
      <div className="flex min-h-11 items-center gap-2">
        {references.map((reference) => (
          <div
            className="group/reference-image nodrag nowheel relative size-11 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 shadow-sm"
            key={reference.nodeId}
            title={reference.title}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={reference.title} className="h-full w-full object-cover" src={reference.url} />
            <button
              aria-label={`取消引用 ${reference.title}`}
              className="absolute right-0.5 top-0.5 hidden size-4 items-center justify-center rounded-full bg-zinc-950/80 text-white group-hover/reference-image:flex"
              onClick={() => toggleReference(reference.nodeId)}
              type="button"
            >
              <X className="size-2.5" />
            </button>
          </div>
        ))}
        <button
          aria-label="参考"
          className="nodrag nowheel flex size-11 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          onClick={() => setIsOpen((current) => !current)}
          title="参考"
          type="button"
        >
          <Plus className="size-4" />
        </button>
        <span className="min-w-0 truncate text-xs text-zinc-400">
          {references.length > 0 ? `${references.length} 张参考图片` : "输入 @ 或点击 + 添加参考"}
        </span>
      </div>
      {references.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {references.map((reference) => (
            <span className="flex max-w-40 items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600" key={reference.nodeId}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="" className="size-3 rounded-sm object-cover" src={reference.url} />
              <span className="truncate" title={reference.title}>
                {truncateReferenceTitle(reference.title)}
              </span>
            </span>
          ))}
        </div>
      ) : null}
      {isOpen ? (
        <div className="zenme-shadow-dropdown nodrag nowheel absolute left-0 top-full z-50 mt-2 w-80 rounded-lg border border-zinc-200 bg-white p-2">
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 pl-8 pr-2 text-xs outline-none focus:border-zinc-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索已连接图片"
              value={query}
            />
          </div>
          <p className="px-1 pb-1 text-[11px] font-medium text-zinc-400">已连接节点</p>
          <div className="max-h-52 space-y-1 overflow-auto">
            {filteredCandidates.map((candidate) => {
              const selected = selectedIds.includes(candidate.nodeId);
              return (
                <button
                  className={`flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition ${selected ? "bg-zinc-100 text-zinc-950" : "text-zinc-600 hover:bg-zinc-50"}`}
                  key={candidate.nodeId}
                  onClick={() => {
                    toggleReference(candidate.nodeId);
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" className="size-7 rounded object-cover" src={candidate.url} />
                  <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                  {selected ? <span className="text-zinc-500">已选</span> : null}
                </button>
              );
            })}
            {filteredCandidates.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-zinc-400">暂无可选的已连接图片</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function truncateReferenceTitle(title: string) {
  const characters = Array.from(title);
  return characters.length > 10
    ? `${characters.slice(0, 10).join("")}...`
    : title;
}

export function ImageEditSizePicker({
  aspectRatio,
  aspectRatioLabel,
  onAspectRatioChange,
  onQualityChange,
  quality,
  qualityLabel,
}: {
  aspectRatio: string;
  aspectRatioLabel: string;
  onAspectRatioChange: (aspectRatio: string) => void;
  onQualityChange: (quality: string) => void;
  quality: string;
  qualityLabel: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex min-w-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100"
          title="选择输出尺寸"
          type="button"
        >
          <span className="truncate">
            {aspectRatioLabel} · {qualityLabel}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-zinc-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="zenme-shadow-dropdown nodrag nowheel w-72 rounded-lg border-zinc-200 bg-white p-3"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        side="top"
        sideOffset={8}
      >
        <div className="space-y-3">
          <div>
            <p className="mb-2 px-1 text-xs font-medium text-zinc-500">清晰度</p>
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-zinc-100 p-1">
              {IMAGE_EDIT_QUALITY_OPTIONS.map((option) => (
                <button
                  className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${
                    option.value === quality
                      ? "bg-white text-zinc-950 shadow-sm"
                      : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"
                  }`}
                  key={option.value}
                  onClick={() => onQualityChange(option.value)}
                  title={option.prompt}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 px-1 text-xs font-medium text-zinc-500">比例</p>
            <div className="grid grid-cols-3 gap-1.5">
              {IMAGE_EDIT_ASPECT_RATIO_OPTIONS.map((option) => (
                <button
                  className={`flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition ${
                    option.value === aspectRatio
                      ? "border-zinc-900 bg-zinc-50 text-zinc-950"
                      : "border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                  }`}
                  key={option.value}
                  onClick={() => onAspectRatioChange(option.value)}
                  title={option.prompt}
                  type="button"
                >
                  <span>{option.label}</span>
                  {option.value === aspectRatio ? (
                    <Check className="size-3.5" />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
          <p className="px-1 text-xs leading-5 text-zinc-400">
            尺寸选项会写入图片编辑 system prompt。
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
