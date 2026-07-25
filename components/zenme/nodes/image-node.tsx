"use client";

import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type NodeProps, useUpdateNodeInternals, useViewport } from "@xyflow/react";
import {
  ArrowUp,
  Download,
  ImageIcon,
  Loader2,
  Maximize2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

import {
  getImageDisplaySize,
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
import {
  ImageEditSizePicker,
  ImageReferencePicker,
} from "@/components/zenme/nodes/image-edit-node";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { ImageTaskTiming } from "@/components/zenme/nodes/image-task-timing";
import { ImageCameraControlPicker } from "@/components/zenme/nodes/image-camera-control-picker";
import {
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import {
  getImageEditPreferences,
  rememberImageEditPreferences,
  resolveImageModelPreference,
} from "@/components/zenme/image-edit-preferences";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";

export function ImageNode({ data, id, selected }: NodeProps) {
  const { zoom } = useViewport();
  const updateNodeInternals = useUpdateNodeInternals();
  const nodeData = data as CanvasNodeData;
  const imageModelOptions = useAiModelOptions("image");
  const rememberedPreferences = getImageEditPreferences();
  const isGeneratedImage = Boolean(nodeData.imageGenerated);
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
  const [cameraControl, setCameraControl] = useState(
    nodeData.imageCameraControl,
  );
  const [model, setModel] = useState(
    resolveImageModelPreference(
      imageModelOptions,
      nodeData.imageModel ?? rememberedPreferences.modelId,
    ) ??
      NANO_BANANA_2_IMAGE_MODEL,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [isCameraPickerOpen, setIsCameraPickerOpen] = useState(false);
  const [referencePickerRequest, setReferencePickerRequest] = useState(0);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [detectedAspectRatio, setDetectedAspectRatio] = useState<number | undefined>(
    nodeData.imageAspectRatio,
  );
  const isEditing = isSubmitting || nodeData.imageStatus === "editing";
  const isSubmissionLocked = isSubmitting || Boolean(nodeData.hasRunningGenerationChild);
  const composerScale = 1 / Math.max(zoom, 0.2);
  const composerStyle: CSSProperties = {
    top: `calc(100% + ${12 / Math.max(zoom, 0.2)}px)`,
    transform: `translateX(-50%) scale(${composerScale})`,
    transformOrigin: "top center",
  };
  const aspectRatioOption = getImageEditAspectRatioOption(aspectRatio);
  const qualityOption = getImageEditQualityOption(quality);
  const imageUrl = nodeData.originalUrl ?? nodeData.previewUrl;
  const displayImageUrl = nodeData.previewUrl ?? nodeData.originalUrl;
  const displaySize = getImageDisplaySize(
    nodeData.imageAspectRatio ?? detectedAspectRatio,
  );
  const imageTitle = nodeData.title || (isGeneratedImage ? "图片生成" : "图片");
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
    setCameraControl(nodeData.imageCameraControl);
  }, [nodeData.imageCameraControl]);

  useEffect(() => {
    if (nodeData.imageAspectRatio) setDetectedAspectRatio(nodeData.imageAspectRatio);
  }, [nodeData.imageAspectRatio]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => updateNodeInternals(id));
    return () => window.cancelAnimationFrame(frame);
  }, [
    displaySize.height,
    displaySize.width,
    id,
    nodeData.imageStatus,
    nodeData.originalUrl,
    nodeData.previewUrl,
    updateNodeInternals,
  ]);

  function detectImageAspectRatio(image: HTMLImageElement) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width > 0 && height > 0) {
      setDetectedAspectRatio(width / height);
      nodeData.onResolveImageDimensions?.(id, { height, width });
    }
  }

  useEffect(() => {
    const nextModel = resolveImageModelPreference(
      imageModelOptions,
      nodeData.imageModel ?? getImageEditPreferences().modelId,
    );
    if (nextModel) setModel(nextModel);
  }, [imageModelOptions, nodeData.imageModel]);

  function syncPrompt() {
    nodeData.onUpdateImageNode?.(id, {
      imageCameraControl: cameraControl,
      imageOutputAspectRatio: aspectRatio,
      imageModel: model,
      imagePrompt: prompt,
      imageQuality: quality,
    });
  }

  async function submitImageEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextPrompt = prompt.trim();
    if (!nextPrompt || isSubmissionLocked) {
      return;
    }

    setIsSubmitting(true);
    nodeData.onUpdateImageNode?.(id, {
      imageCameraControl: cameraControl,
      imageOutputAspectRatio: aspectRatio,
      imageModel: model,
      imagePrompt: nextPrompt,
      imageQuality: quality,
    });

    try {
      await nodeData.onSubmitImageNode?.(id, {
        aspectRatio,
        cameraControl,
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
        modelLabel={imageModelLabel}
        onClose={() => setIsPreviewOpen(false)}
        onDownload={() => void downloadImage()}
        prompt={nodeData.imagePrompt}
        qualityLabel={qualityOption.label}
        title={imageTitle}
      />
    ) : null;

  if (imageUrl) {
    return (
      <div className={`group relative h-full min-h-[190px] w-full min-w-[220px] ${isRenaming ? "zenme-node-renaming" : ""}`}>
        <ImageTaskTiming
          durationMs={nodeData.imageTaskDurationMs}
          running={isEditing}
          startedAt={nodeData.imageTaskStartedAt}
        />
        {selected && !isRenaming ? imageControls : null}
        <EditableNodeTitle
          fallbackTitle={isGeneratedImage ? "图片生成" : "图片"}
          icon={<ImageIcon className="size-4" />}
          onCommit={(title) => nodeData.onUpdateImageNode?.(id, { title })}
          onEditingChange={setIsRenaming}
          title={nodeData.title}
        />
        <NodeTargetHandle
          revealOnHover={false}
          visible={Boolean(nodeData.hasIncomingEdge)}
        />
        <NodeEdgeSourceHandle
          visible={Boolean(nodeData.hasOutgoingEdge)}
        />
        <form
          className="relative h-full w-full"
          onSubmit={submitImageEdit}
        >
          <div
          className={`zenme-shadow-node relative h-full min-h-[190px] overflow-hidden rounded-xl border bg-zinc-100 ${
            selected ? "border-zinc-900" : "border-zinc-200"
          }`}
          >
            {displayImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={nodeData.title}
                className="h-full w-full object-contain"
                crossOrigin="anonymous"
                onLoad={(event) => detectImageAspectRatio(event.currentTarget)}
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
          {(selected || isModelPickerOpen || isCameraPickerOpen) &&
          !nodeData.isMultiSelection &&
          !isRenaming ? (
            <div
              className="zenme-node-floating-control zenme-shadow-canvas nodrag nowheel absolute left-1/2 z-30 flex min-h-[220px] w-[640px] max-w-[calc(100vw-48px)] flex-col rounded-xl border border-zinc-200 bg-white p-3 text-zinc-950"
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              style={composerStyle}
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
                className="zenme-text-ai-input min-h-24 flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-6 text-zinc-900 outline-none placeholder:text-zinc-400"
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
                placeholder={
                  isGeneratedImage
                    ? "继续描述想如何编辑这张图片"
                    : "描述想如何编辑这张图片"
                }
                value={prompt}
              />
              {nodeData.imageError ? (
                <p className="mt-2 rounded-md bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-600">
                  {nodeData.imageError}
                </p>
              ) : null}
              {isSubmissionLocked ? (
                <div className="mt-2 flex items-center gap-2 px-1 text-xs text-zinc-500">
                  <Loader2 className="size-3.5 animate-spin" />
                  {imageModelLabel} 正在编辑，原图会保留到新图完成
                </div>
              ) : null}
              <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ZenmeModelPicker
                    compact
                    icon={<Sparkles className="size-3.5" />}
                    model={model}
                    models={imageModelOptions}
                    onChange={(nextModel) => {
                      setModel(nextModel);
                      nodeData.onUpdateImageNode?.(id, { imageModel: nextModel });
                      void rememberImageEditPreferences({ modelId: nextModel });
                    }}
                    onOpenChange={setIsModelPickerOpen}
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
                  <ImageCameraControlPicker
                    onChange={(nextCameraControl) => {
                      setCameraControl(nextCameraControl);
                      nodeData.onUpdateImageNode?.(id, {
                        imageCameraControl: nextCameraControl,
                      });
                    }}
                    onOpenChange={setIsCameraPickerOpen}
                    value={cameraControl}
                  />
                </div>
                <button
                  aria-busy={isSubmissionLocked}
                  aria-label={
                    isSubmissionLocked
                      ? "正在编辑图片"
                      : isGeneratedImage
                        ? "重新编辑图片"
                        : "编辑图片"
                  }
                  className={`flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-colors hover:bg-zinc-800 active:bg-black focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${
                    isSubmissionLocked
                      ? "cursor-wait"
                      : "disabled:cursor-not-allowed disabled:bg-zinc-300"
                  }`}
                  disabled={
                    isSubmissionLocked ||
                    !prompt.trim() ||
                    !imageModelOptions.some((option) => option.id === model)
                  }
                  title={isGeneratedImage ? "重新编辑图片" : "编辑图片"}
                  type="submit"
                >
                  {isSubmissionLocked ? (
                    <span aria-hidden="true" className="size-4 rounded-[2px] bg-white" />
                  ) : (
                    <ArrowUp className="size-5" strokeWidth={1.75} />
                  )}
                </button>
              </div>
            </div>
          ) : null}
        </form>
        <NodeActionHandle
          selected={Boolean(selected && !isRenaming)}
        />
        {previewOverlay}
      </div>
    );
  }

  return (
    <div className={`group relative ${isRenaming ? "zenme-node-renaming" : ""}`} style={displaySize}>
      <ImageTaskTiming
        durationMs={nodeData.imageTaskDurationMs}
        running={isEditing}
        startedAt={nodeData.imageTaskStartedAt}
      />
      {selected && !isRenaming ? imageControls : null}
      <EditableNodeTitle
        fallbackTitle="图片"
        icon={<ImageIcon className="size-4" />}
        onCommit={(title) => nodeData.onUpdateImageNode?.(id, { title })}
        onEditingChange={setIsRenaming}
        title={nodeData.title}
      />
      <NodeTargetHandle
        revealOnHover={false}
        visible={Boolean(nodeData.hasIncomingEdge)}
      />
      <NodeEdgeSourceHandle
        visible={Boolean(nodeData.hasOutgoingEdge)}
      />
      <div
        className={`zenme-shadow-node relative h-full w-full overflow-hidden rounded-xl border bg-zinc-100 ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
      >
        {displayImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={nodeData.title}
            className="h-full w-full object-contain"
            crossOrigin="anonymous"
            onLoad={(event) => detectImageAspectRatio(event.currentTarget)}
            src={displayImageUrl}
          />
        ) : null}
        <button
          className="zenme-node-inline-control absolute right-3 top-3 flex items-center gap-2 rounded-md bg-white/85 px-3 py-2 text-sm font-normal text-zinc-900 opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100"
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
      <NodeActionHandle
        selected={Boolean(selected && !isRenaming)}
      />
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
      className="zenme-node-floating-control zenme-shadow-canvas nodrag nowheel absolute left-1/2 top-0 z-40 flex -translate-x-1/2 -translate-y-[calc(100%+12px)] items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 text-zinc-600 backdrop-blur"
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
        <aside className="zenme-shadow-overlay ml-3 flex min-h-0 flex-col rounded-xl bg-zinc-900/95 p-4">
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
