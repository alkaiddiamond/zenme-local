"use client";

import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type NodeProps, useViewport } from "@xyflow/react";
import {
  Download,
  ImageIcon,
  Loader2,
  Maximize2,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import {
  getImageEditAspectRatioOption,
  getImageEditQualityOption,
} from "@/components/zenme/image-edit-options";
import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  NodeActionHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
  uploadStatusClassName,
  uploadStatusLabel,
} from "@/components/zenme/node-ui";
import { NANO_BANANA_2_IMAGE_MODEL } from "@/components/zenme/canvas/node-factories";
import { ImageEditSizePicker } from "@/components/zenme/nodes/image-edit-node";
import {
  createModelOption,
  rememberAiModelPreference,
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";

export function ImageNode({ data, id, selected }: NodeProps) {
  const { zoom } = useViewport();
  const nodeData = data as CanvasNodeData;
  const imageModelOptions = useAiModelOptions("image");
  const isGeneratedImage = Boolean(
    nodeData.imageGenerated || nodeData.imageEditPrompt,
  );
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
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const isEditing = isSubmitting || nodeData.imageEditStatus === "editing";
  const composerScale = 1 / Math.max(zoom, 0.2);
  const composerStyle: CSSProperties = {
    top: `calc(100% + ${12 / Math.max(zoom, 0.2)}px)`,
    transform: `scale(${composerScale})`,
    transformOrigin: "top left",
  };
  const aspectRatioOption = getImageEditAspectRatioOption(aspectRatio);
  const qualityOption = getImageEditQualityOption(quality);
  const imageUrl = nodeData.originalUrl ?? nodeData.previewUrl;
  const displayImageUrl = nodeData.previewUrl ?? nodeData.originalUrl;
  const imageTitle = isGeneratedImage ? "图片生成" : nodeData.title;
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

  async function submitImageEdit(event: FormEvent<HTMLFormElement>) {
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

  async function downloadImage() {
    if (!imageUrl) {
      return;
    }

    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = createImageDownloadName(nodeData, blob.type);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  const imageControls = imageUrl ? (
    <ImageNodeControls
      onDownload={() => void downloadImage()}
      onOpenPreview={() => setIsPreviewOpen(true)}
    />
  ) : null;

  const previewOverlay =
    isPreviewOpen && imageUrl ? (
      <ImagePreviewOverlay
        aspectRatioLabel={aspectRatioOption.label}
        imageUrl={imageUrl}
        isGeneratedImage={isGeneratedImage}
        modelLabel={imageEditModelLabel}
        onClose={() => setIsPreviewOpen(false)}
        onDownload={() => void downloadImage()}
        prompt={nodeData.imageEditPrompt}
        qualityLabel={qualityOption.label}
        title={imageTitle}
      />
    ) : null;

  if (isGeneratedImage) {
    return (
      <div className="group relative h-full min-h-[190px] w-full min-w-[220px]">
        {selected ? imageControls : null}
        <div className="mb-2 flex items-center gap-1 text-sm font-medium text-zinc-500">
          <span className="zenme-node-title-icon-hitbox">
            <ImageIcon className="size-4" />
          </span>
          图片生成
        </div>
        <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
        <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
        <form
          className="relative h-full w-full"
          onSubmit={submitImageEdit}
        >
          <div
          className={`relative h-full min-h-[190px] overflow-hidden rounded-xl border bg-zinc-950 shadow-xl ${
            selected ? "border-zinc-100" : "border-zinc-800"
          }`}
          >
            {displayImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={nodeData.title}
                className="h-full w-full object-cover"
                crossOrigin="anonymous"
                src={displayImageUrl}
              />
            ) : (
              <div className="flex h-full min-h-[190px] items-center justify-center text-zinc-600">
                <ImageIcon className="size-10" />
              </div>
            )}
            {isEditing ? (
              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full bg-zinc-950/80 px-3 py-1.5 text-xs font-medium text-white shadow-sm backdrop-blur">
                <Loader2 className="size-3.5 animate-spin" />
                编辑中
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
          </div>
          {selected ? (
            <div
              className="nodrag nowheel absolute left-0 z-30 flex min-h-[150px] w-[560px] max-w-[80vw] flex-col rounded-xl border border-zinc-200 bg-white p-3 text-zinc-950 shadow-xl"
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
                placeholder="继续描述想如何编辑这张图片"
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
                  {imageEditModelLabel} 正在重新编辑，旧结果会保留到新图完成
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
                  disabled={isEditing || !prompt.trim()}
                  title="重新编辑图片"
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
        <NodeActionHandle selected={Boolean(selected)} />
        {previewOverlay}
      </div>
    );
  }

  return (
    <div className="group relative w-[280px]">
      {selected ? imageControls : null}
      <div className="mb-2 flex items-center gap-1 text-sm font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <ImageIcon className="size-4" />
        </span>
        image
      </div>
      <NodeTargetHandle visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <div
        className={`relative aspect-[3/4] overflow-hidden rounded-xl border bg-zinc-100 shadow-xl ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
      >
        {displayImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={nodeData.title}
            className="h-full w-full object-cover"
            crossOrigin="anonymous"
            src={displayImageUrl}
          />
        ) : null}
        <button
          className="absolute right-3 top-3 flex items-center gap-2 rounded-md bg-white/85 px-3 py-2 text-sm font-normal text-zinc-900 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100"
          type="button"
        >
          <Upload className="size-4" />
          替换
        </button>
        <div className="absolute bottom-3 left-3 max-w-[calc(100%-24px)] rounded-md bg-white/85 px-2 py-1 text-xs text-zinc-700 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">
          <span className="truncate">{nodeData.title}</span>
          <span
            className={`ml-2 ${uploadStatusClassName(nodeData.uploadStatus)}`}
          >
            {uploadStatusLabel(nodeData.uploadStatus)}
          </span>
        </div>
      </div>
      <NodeActionHandle selected={Boolean(selected)} />
      {previewOverlay}
    </div>
  );
}

function ImageNodeControls({
  onDownload,
  onOpenPreview,
}: {
  onDownload: () => void;
  onOpenPreview: () => void;
}) {
  return (
    <div
      className="nodrag nowheel absolute left-1/2 top-0 z-40 flex -translate-x-1/2 -translate-y-[calc(100%+12px)] items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 text-zinc-600 shadow-xl backdrop-blur"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        className="flex size-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:bg-zinc-100 focus-visible:text-zinc-950"
        onClick={onOpenPreview}
        title="最大化查看"
        type="button"
      >
        <Maximize2 className="size-4" />
      </button>
      <button
        className="flex size-9 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 focus-visible:bg-zinc-100 focus-visible:text-zinc-950"
        onClick={onDownload}
        title="下载原图"
        type="button"
      >
        <Download className="size-4" />
      </button>
    </div>
  );
}

function ImagePreviewOverlay({
  aspectRatioLabel,
  imageUrl,
  isGeneratedImage,
  modelLabel,
  onClose,
  onDownload,
  prompt,
  qualityLabel,
  title,
}: {
  aspectRatioLabel: string;
  imageUrl: string;
  isGeneratedImage: boolean;
  modelLabel: string;
  onClose: () => void;
  onDownload: () => void;
  prompt?: string;
  qualityLabel: string;
  title: string;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/90 text-zinc-100">
      <button
        aria-label="关闭预览"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.06),transparent_48%)]" />
      <div className="relative z-10 grid h-full grid-cols-[1fr_248px] gap-0 p-4">
        <div className="flex min-h-0 items-center justify-center rounded-xl bg-zinc-900/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={title}
            className="max-h-[calc(100vh-32px)] max-w-full object-contain"
            crossOrigin="anonymous"
            src={imageUrl}
          />
        </div>
        <aside className="ml-3 flex min-h-0 flex-col rounded-xl bg-zinc-900/95 p-4 shadow-2xl">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{title}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {isGeneratedImage ? "图片生成结果" : "图片"}
              </p>
            </div>
            <button
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
              onClick={onClose}
              title="关闭"
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
          {prompt ? (
            <section className="mb-4">
              <p className="mb-2 text-xs font-medium text-zinc-500">提示词</p>
              <div className="max-h-36 overflow-auto rounded-lg bg-zinc-800/80 p-3 text-xs leading-5 text-zinc-300">
                {prompt}
              </div>
            </section>
          ) : null}
          <section className="rounded-lg bg-zinc-800/80 p-3 text-xs leading-6 text-zinc-400">
            <p>
              <span className="text-zinc-500">模型：</span>
              {modelLabel}
            </p>
            <p>
              <span className="text-zinc-500">质量：</span>
              {qualityLabel}
            </p>
            <p>
              <span className="text-zinc-500">宽高比：</span>
              {aspectRatioLabel}
            </p>
          </section>
          <button
            className="mt-auto flex h-10 items-center justify-center gap-2 rounded-lg bg-zinc-100 text-sm font-medium text-zinc-950 transition hover:bg-white"
            onClick={onDownload}
            type="button"
          >
            <Download className="size-4" />
            下载
          </button>
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function createImageDownloadName(nodeData: CanvasNodeData, mimeType?: string) {
  const sourceName =
    nodeData.fileName?.trim() ||
    nodeData.title?.trim() ||
    (nodeData.imageGenerated ? "图片生成" : "zenme-image");
  const extension = getImageDownloadExtension(sourceName, mimeType);
  const baseName = sourceName
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim() || "zenme-image";

  return `${baseName}-${formatDownloadTimestamp(new Date())}.${extension}`;
}

function formatDownloadTimestamp(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function getImageDownloadExtension(fileName: string, mimeType?: string) {
  const fileExtension = fileName.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  if (fileExtension) {
    return fileExtension === "jpeg" ? "jpg" : fileExtension;
  }
  if (mimeType?.includes("jpeg") || mimeType?.includes("jpg")) {
    return "jpg";
  }
  if (mimeType?.includes("webp")) {
    return "webp";
  }
  if (mimeType?.includes("gif")) {
    return "gif";
  }
  if (mimeType?.includes("svg")) {
    return "svg";
  }
  return "png";
}
