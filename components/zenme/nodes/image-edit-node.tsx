"use client";

import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { NodeResizer, type NodeProps, useViewport } from "@xyflow/react";
import {
  Check,
  ChevronDown,
  ImageIcon,
  ImagePlus,
  Loader2,
  Send,
  Sparkles,
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
  rememberAiModelPreference,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ImageEditNode({ data, id, selected }: NodeProps) {
  const { zoom } = useViewport();
  const nodeData = data as CanvasNodeData;
  const imageModelOptions = useAiModelOptions("image");
  const [prompt, setPrompt] = useState(nodeData.imageEditPrompt ?? "");
  const [aspectRatio, setAspectRatio] = useState<string>(
    getImageEditAspectRatioOption(nodeData.imageEditAspectRatio).value,
  );
  const [quality, setQuality] = useState<string>(
    getImageEditQualityOption(nodeData.imageEditQuality).value,
  );
  const [model, setModel] = useState(
    nodeData.imageEditModel ?? imageModelOptions[0]?.id ?? NANO_BANANA_2_IMAGE_MODEL,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = isSubmitting || nodeData.imageEditStatus === "editing";
  const showComposer = Boolean(selected);
  const composerScale = 1 / Math.max(zoom, 0.2);
  const composerStyle: CSSProperties = {
    top: `calc(100% + ${12 / Math.max(zoom, 0.2)}px)`,
    transform: `scale(${composerScale})`,
    transformOrigin: "top left",
  };
  const aspectRatioOption = getImageEditAspectRatioOption(aspectRatio);
  const qualityOption = getImageEditQualityOption(quality);
  const imageEditModelId = model;
  const imageEditModelLabel =
    imageModelOptions.find((option) => option.id === imageEditModelId)?.label ??
    imageEditModelId;

  useEffect(() => {
    setPrompt(nodeData.imageEditPrompt ?? "");
  }, [nodeData.imageEditPrompt]);

  useEffect(() => {
    setAspectRatio(
      getImageEditAspectRatioOption(nodeData.imageEditAspectRatio).value,
    );
  }, [nodeData.imageEditAspectRatio]);

  useEffect(() => {
    setQuality(getImageEditQualityOption(nodeData.imageEditQuality).value);
  }, [nodeData.imageEditQuality]);

  useEffect(() => {
    const nextModel = nodeData.imageEditModel ?? imageModelOptions[0]?.id;
    if (nextModel) setModel(nextModel);
  }, [imageModelOptions, nodeData.imageEditModel]);

  function syncPrompt() {
    nodeData.onUpdateImageEditNode?.(id, {
      imageEditAspectRatio: aspectRatio,
      imageEditModel: model,
      imageEditPrompt: prompt,
      imageEditQuality: quality,
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isEditing) {
      return;
    }

    setIsSubmitting(true);
    nodeData.onUpdateImageEditNode?.(id, {
      imageEditAspectRatio: aspectRatio,
      imageEditError: undefined,
      imageEditModel: model,
      imageEditPrompt: nextPrompt,
      imageEditQuality: quality,
      imageEditStatus: "editing",
    });

    try {
      await nodeData.onSubmitImageEditNode?.(id, {
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
    <div className="zenme-image-edit-node group relative h-full w-full">
      <NodeTargetHandle
        visible={Boolean(nodeData.hasIncomingEdge)}
      />
      <NodeEdgeSourceHandle
        visible={Boolean(nodeData.hasOutgoingEdge)}
      />
      <NodeContextHandle selected={Boolean(selected)} />
      <div className="absolute -top-8 left-1 flex h-5 max-w-full items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <ImagePlus className="size-4" />
        </span>
        图片编辑
      </div>
      <form
        className="relative h-full min-h-[220px] w-full min-w-[420px] text-zinc-950"
        onSubmit={submit}
      >
        <div
          className={`flex h-full min-h-[220px] items-center justify-center overflow-hidden rounded-xl border bg-white px-4 py-5 shadow-xl ${
            selected ? "border-zinc-900" : "border-zinc-200"
          }`}
        >
          <div className="flex flex-col items-center gap-3 text-center text-zinc-400">
            <ImageIcon className="size-12 stroke-[1.5]" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-500">待生成图片</p>
              <p className="max-w-[320px] text-xs leading-5">
                {showComposer
                  ? "编辑完成后，图片会作为新的图片节点连接到这里"
                  : "选中节点后输入编辑指令"}
              </p>
            </div>
            {!showComposer && isEditing ? (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" />
                正在编辑图片...
              </div>
            ) : null}
          </div>
        </div>
        {showComposer ? (
          <div
            className={`nodrag nowheel absolute left-0 z-30 flex min-h-[150px] w-full flex-col rounded-xl border bg-white p-3 shadow-xl ${
              selected ? "border-zinc-900" : "border-zinc-200"
            }`}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            style={composerStyle}
          >
            <textarea
              className="zenme-text-ai-input min-h-16 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400"
              onBlur={syncPrompt}
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
              placeholder="描述想如何编辑这张图片"
              value={prompt}
            />
            {nodeData.imageEditError ? (
              <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-600">
                {nodeData.imageEditError}
              </p>
            ) : null}
            {isEditing ? (
              <div className="mt-2 flex items-center gap-2 px-1 text-xs text-zinc-500">
                <Loader2 className="size-3.5 animate-spin" />
                {imageEditModelLabel} 正在编辑图片...
              </div>
            ) : null}

            <div className="mt-auto flex items-end justify-between gap-3 pt-3">
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
                    nodeData.onUpdateImageEditNode?.(id, { imageEditModel: nextModel });
                    void rememberAiModelPreference("image", nextModel);
                  }}
                />
                <ImageEditSizePicker
                  aspectRatio={aspectRatioOption.value}
                  aspectRatioLabel={aspectRatioOption.label}
                  onAspectRatioChange={(nextAspectRatio) => {
                    setAspectRatio(nextAspectRatio);
                    nodeData.onUpdateImageEditNode?.(id, {
                      imageEditAspectRatio: nextAspectRatio,
                      imageEditPrompt: prompt,
                      imageEditQuality: quality,
                    });
                  }}
                  onQualityChange={(nextQuality) => {
                    setQuality(nextQuality);
                    nodeData.onUpdateImageEditNode?.(id, {
                      imageEditAspectRatio: aspectRatio,
                      imageEditPrompt: prompt,
                      imageEditQuality: nextQuality,
                    });
                  }}
                  quality={qualityOption.value}
                  qualityLabel={qualityOption.label}
                />
              </div>
              <button
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                disabled={isEditing || !prompt.trim() || !nodeData.sourceImageUrl}
                title="编辑图片"
                type="submit"
              >
                {isEditing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </div>
          </div>
        ) : null}
      </form>
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected)}
        lineClassName="zenme-text-resize-line"
        minHeight={220}
        minWidth={420}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
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
        className="nodrag nowheel w-72 rounded-xl border-zinc-200 bg-white p-3 shadow-xl"
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
