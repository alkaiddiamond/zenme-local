"use client";

import {
  forwardRef,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
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
  type ImagePromptMention,
  normalizeImagePromptContent,
} from "@/components/zenme/canvas/image-prompt-mentions";
import { createOutsidePointerHandler } from "@/components/zenme/nodes/outside-interaction";
import {
  useAiModelOptions,
} from "@/components/zenme/use-ai-model-options";
import {
  getImageEditPreferences,
  rememberImageEditPreferences,
  resolveImageModelPreference,
} from "@/components/zenme/image-edit-preferences";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { ImageTaskTiming } from "@/components/zenme/nodes/image-task-timing";
import { ImageCameraControlPicker } from "@/components/zenme/nodes/image-camera-control-picker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { writeTextToClipboard } from "@/lib/clipboard";

type ImagePromptImageReference = NonNullable<CanvasNodeData["imageReferenceCandidates"]>[number];
type ImagePromptTextReference = NonNullable<CanvasNodeData["imageTextReferenceCandidates"]>[number];
export type ImagePromptReference = (ImagePromptImageReference & { kind: "image" }) |
  (ImagePromptTextReference & { kind: "text" });

export type ImagePromptEditorHandle = {
  clearPendingReference: () => void;
  insertPendingReference: (reference: ImagePromptReference) => false | {
    mentions: ImagePromptMention[];
    prompt: string;
  };
};

export function ImageGenerationNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const isPromptExpanded = Boolean(nodeData.imagePromptExpanded);
  const imageModelOptions = useAiModelOptions("image");
  const rememberedPreferences = getImageEditPreferences();
  const [prompt, setPrompt] = useState(nodeData.imagePrompt ?? "");
  const [promptMentions, setPromptMentions] = useState(
    nodeData.imagePromptMentions ?? [],
  );
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
  const [referencePickerRequest, setReferencePickerRequest] = useState(0);
  const promptEditorRef = useRef<ImagePromptEditorHandle>(null);
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
    setPromptMentions(nodeData.imagePromptMentions ?? []);
  }, [nodeData.imagePromptMentions]);

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
    const nextModel = resolveImageModelPreference(
      imageModelOptions,
      nodeData.imageModel ?? getImageEditPreferences().modelId,
    );
    if (nextModel) setModel(nextModel);
  }, [imageModelOptions, nodeData.imageModel]);

  async function submit(event: FormEvent<HTMLFormElement>) {
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
      imagePrompt: prompt,
      imagePromptMentions: promptMentions,
      imageQuality: quality,
    });

    try {
      await nodeData.onSubmitImageNode?.(id, {
        aspectRatio,
        cameraControl,
        model,
        prompt,
        promptMentions,
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
            className={`zenme-shadow-node flex h-full min-h-[176px] flex-col overflow-hidden rounded-xl border bg-white p-3 ${
              selected ? "border-zinc-900" : "border-zinc-200"
            }`}
          >
            <ImageReferencePicker
              candidates={nodeData.imageReferenceCandidates ?? []}
              onChange={(nodeIds) =>
                nodeData.onUpdateImageNode?.(id, { imageReferenceNodeIds: nodeIds })
              }
              onTextChange={(nodeIds) =>
                nodeData.onUpdateImageNode?.(id, {
                  imageTextReferenceNodeIds: nodeIds,
                })
              }
              mentionOnly
              onOpenChange={(open) => {
                if (!open) promptEditorRef.current?.clearPendingReference();
              }}
              onSelect={(reference) => {
                const content = promptEditorRef.current?.insertPendingReference({
                  ...reference,
                  kind: "image",
                });
                if (!content) return false;
                setPrompt(content.prompt);
                setPromptMentions(content.mentions);
                nodeData.onUpdateImageNode?.(id, {
                  imagePrompt: content.prompt,
                  imagePromptMentions: content.mentions,
                });
                return true;
              }}
              onTextSelect={(reference) => {
                const content = promptEditorRef.current?.insertPendingReference({
                  ...reference,
                  kind: "text",
                });
                if (!content) return false;
                setPrompt(content.prompt);
                setPromptMentions(content.mentions);
                nodeData.onUpdateImageNode?.(id, {
                  imagePrompt: content.prompt,
                  imagePromptMentions: content.mentions,
                });
                return true;
              }}
              openRequest={referencePickerRequest}
              references={nodeData.imageReferences ?? []}
              required={false}
              textCandidates={nodeData.imageTextReferenceCandidates ?? []}
              textReferences={nodeData.imageTextReferences ?? []}
            />
            <ImagePromptEditor
              candidates={nodeData.imageReferenceCandidates ?? []}
              className="zenme-text-ai-input nodrag nowheel min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-transparent px-1 py-0.5 text-sm leading-5 text-zinc-900 outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]"
              mentions={promptMentions}
              onBlur={(nextPrompt, nextMentions) => {
                setPrompt(nextPrompt);
                setPromptMentions(nextMentions);
                nodeData.onUpdateImageNode?.(id, {
                  imageCameraControl: cameraControl,
                  imageOutputAspectRatio: aspectRatio,
                  imageModel: model,
                  imagePrompt: nextPrompt,
                  imagePromptMentions: nextMentions,
                  imageQuality: quality,
                });
              }}
              onChange={(nextPrompt, nextMentions) => {
                setPrompt(nextPrompt);
                setPromptMentions(nextMentions);
              }}
              onReferenceRequest={() =>
                setReferencePickerRequest((current) => current + 1)
              }
              placeholder="描述想要生成的图片，或说明如何使用参考图"
              prompt={prompt}
              ref={promptEditorRef}
              textCandidates={nodeData.imageTextReferenceCandidates ?? []}
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
                  compact
                  icon={<Sparkles className="size-3.5" />}
                  model={model}
                  models={imageModelOptions}
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
                <ImageCameraControlPicker
                  onChange={(nextCameraControl) => {
                    setCameraControl(nextCameraControl);
                    nodeData.onUpdateImageNode?.(id, {
                      imageCameraControl: nextCameraControl,
                    });
                  }}
                  value={cameraControl}
                />
              </div>
              <button
                aria-busy={isSubmissionLocked}
                aria-label={isSubmissionLocked ? "正在生成图片" : "生成图片"}
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
                title="生成图片"
                type="submit"
              >
                {isSubmissionLocked ? (
                  <span aria-hidden="true" className="size-4 rounded-[2px] bg-white" />
                ) : (
                  <ArrowUp className="size-5" strokeWidth={1.75} />
                )}
              </button>
            </div>
            <div className="zenme-text-node-floating-actions nodrag absolute right-3 top-3 z-30 flex items-center gap-1">
              <button
                aria-expanded={isPromptExpanded}
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/80 text-zinc-400 opacity-55 backdrop-blur transition hover:bg-zinc-100 hover:text-zinc-900 hover:opacity-100 focus-visible:bg-zinc-100 focus-visible:text-zinc-900 focus-visible:opacity-100"
                onClick={() =>
                  nodeData.onToggleImagePromptExpanded?.(
                    id,
                    !isPromptExpanded,
                  )
                }
                title={
                  isPromptExpanded ? "收起提示词" : "展开为 A4 阅读面板"
                }
                type="button"
              >
                {isPromptExpanded ? (
                  <Minimize2 className="size-4" />
                ) : (
                  <Maximize2 className="size-4" />
                )}
              </button>
              <button
                className="flex size-7 shrink-0 items-center justify-center rounded-md bg-white/80 text-zinc-400 opacity-55 backdrop-blur transition hover:bg-zinc-100 hover:text-zinc-900 hover:opacity-100 focus-visible:bg-zinc-100 focus-visible:text-zinc-900 focus-visible:opacity-100"
                onClick={() => {
                  const content = prompt.trim();
                  if (content) void writeTextToClipboard(content);
                }}
                title="复制提示词"
                type="button"
              >
                <Copy className="size-4" />
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
  mentionOnly = false,
  onChange,
  onOpenChange,
  onSelect,
  onTextChange,
  onTextSelect,
  openRequest,
  references,
  required = false,
  showReferenceBar = true,
  textCandidates = [],
  textReferences = [],
}: {
  candidates: NonNullable<CanvasNodeData["imageReferenceCandidates"]>;
  mentionOnly?: boolean;
  onChange: (nodeIds: string[]) => void;
  onOpenChange?: (open: boolean) => void;
  onSelect?: (
    reference: NonNullable<CanvasNodeData["imageReferenceCandidates"]>[number],
  ) => boolean | void;
  onTextChange?: (nodeIds: string[]) => void;
  onTextSelect?: (
    reference: NonNullable<CanvasNodeData["imageTextReferenceCandidates"]>[number],
  ) => boolean | void;
  openRequest: number;
  references: NonNullable<CanvasNodeData["imageReferences"]>;
  required?: boolean;
  showReferenceBar?: boolean;
  textCandidates?: NonNullable<CanvasNodeData["imageTextReferenceCandidates"]>;
  textReferences?: NonNullable<CanvasNodeData["imageTextReferences"]>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const previousOpenRequest = useRef(openRequest);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const selectedIds = references.map((reference) => reference.nodeId);
  const selectedTextIds = textReferences.map((reference) => reference.nodeId);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredCandidates = candidates.filter((candidate) =>
    candidate.title.toLowerCase().includes(normalizedQuery),
  );
  const filteredTextCandidates = textCandidates.filter((candidate) =>
    candidate.title.toLowerCase().includes(normalizedQuery),
  );

  useEffect(() => {
    if (openRequest !== previousOpenRequest.current) {
      previousOpenRequest.current = openRequest;
      setIsOpen(true);
      onOpenChangeRef.current?.(true);
    }
  }, [openRequest]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = createOutsidePointerHandler(
      () => pickerRef.current,
      () => {
        setIsOpen(false);
        onOpenChangeRef.current?.(false);
      },
    );

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isOpen]);

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

  function toggleTextReference(nodeId: string) {
    onTextChange?.(
      selectedTextIds.includes(nodeId)
        ? selectedTextIds.filter((id) => id !== nodeId)
        : [...selectedTextIds, nodeId],
    );
  }

  const referenceSummary = [
    references.length > 0 ? `${references.length} 张图片` : "",
    textReferences.length > 0 ? `${textReferences.length} 条文本` : "",
  ].filter(Boolean).join("、");

  return (
    <div
      className={showReferenceBar ? "relative mb-2" : "relative h-0"}
      ref={pickerRef}
    >
      {showReferenceBar ? (
      <div className="flex min-h-11 flex-wrap items-center gap-2">
        {references.map((reference) => (
          <div
            className="group/reference-item nodrag nowheel relative size-11 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100 shadow-sm"
            key={reference.nodeId}
            title={reference.title}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={reference.title} className="h-full w-full object-cover" src={reference.url} />
            <button
              aria-label={`取消引用 ${reference.title}`}
              className="absolute right-0.5 top-0.5 hidden size-4 items-center justify-center rounded-full bg-zinc-950/80 text-white group-hover/reference-item:flex"
              onClick={() => toggleReference(reference.nodeId)}
              type="button"
            >
              <X className="size-2.5" />
            </button>
          </div>
        ))}
        {textReferences.map((reference) => (
          <div
            className="group/reference-item nodrag nowheel relative flex size-11 shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 px-1 text-zinc-600 shadow-sm"
            key={reference.nodeId}
            title={reference.title}
          >
            <FileText className="size-4 shrink-0" />
            <span className="w-full truncate text-center text-[10px] leading-3">
              {reference.title}
            </span>
            <button
              aria-label={`取消引用 ${reference.title}`}
              className="absolute right-0.5 top-0.5 hidden size-4 items-center justify-center rounded-full bg-zinc-950/80 text-white group-hover/reference-item:flex"
              onClick={() => toggleTextReference(reference.nodeId)}
              type="button"
            >
              <X className="size-2.5" />
            </button>
          </div>
        ))}
        <button
          aria-label="参考"
          className="nodrag nowheel flex size-11 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          onClick={() => setIsOpen((current) => {
            const nextOpen = !current;
            onOpenChangeRef.current?.(nextOpen);
            return nextOpen;
          })}
          title="参考"
          type="button"
        >
          <Plus className="size-4" />
        </button>
        <span className="min-w-0 truncate text-xs text-zinc-400">
          {referenceSummary || "点击 + 添加参考；输入 @ 在提示词中引用"}
        </span>
      </div>
      ) : null}
      {isOpen ? (
        <div className={`zenme-shadow-dropdown nodrag nowheel absolute left-0 z-50 w-80 rounded-lg border border-zinc-200 bg-white p-2 ${showReferenceBar ? "top-full mt-2" : "top-0"}`}>
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              autoFocus
              className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 pl-8 pr-2 text-xs outline-none focus:border-zinc-400"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索已连接节点"
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
                    const handled = onSelect?.(candidate) === true;
                    if (!selected && !(mentionOnly && handled)) {
                      toggleReference(candidate.nodeId);
                    }
                    setIsOpen(false);
                    onOpenChangeRef.current?.(false);
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
            {filteredTextCandidates.map((candidate) => {
              const selected = selectedTextIds.includes(candidate.nodeId);
              return (
                <button
                  className={`flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-xs transition ${selected ? "bg-zinc-100 text-zinc-950" : "text-zinc-600 hover:bg-zinc-50"}`}
                  key={candidate.nodeId}
                  onClick={() => {
                    const handled = onTextSelect?.(candidate) === true;
                    if (!selected && !(mentionOnly && handled)) {
                      toggleTextReference(candidate.nodeId);
                    }
                    setIsOpen(false);
                    onOpenChangeRef.current?.(false);
                  }}
                  type="button"
                >
                  <span className="flex size-7 items-center justify-center rounded bg-zinc-100 text-zinc-500">
                    <FileText className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                  {selected ? <span className="text-zinc-500">已选</span> : null}
                </button>
              );
            })}
            {filteredCandidates.length === 0 && filteredTextCandidates.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-zinc-400">暂无可选的已连接节点</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export const ImagePromptEditor = forwardRef<ImagePromptEditorHandle, {
  candidates: ImagePromptImageReference[];
  className?: string;
  mentions: ImagePromptMention[];
  onBlur: (prompt: string, mentions: ImagePromptMention[]) => void;
  onChange: (prompt: string, mentions: ImagePromptMention[]) => void;
  onReferenceRequest: () => void;
  placeholder: string;
  prompt: string;
  textCandidates: ImagePromptTextReference[];
}>(function ImagePromptEditor(
  {
    candidates,
    className,
    mentions,
    onBlur,
    onChange,
    onReferenceRequest,
    placeholder,
    prompt,
    textCandidates,
  },
  forwardedRef,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const pendingReferenceAnchor = useRef<HTMLElement | null>(null);
  const initialContentRef = useRef({
    candidates,
    originalMentions: mentions,
    originalPrompt: prompt,
    ...normalizeImagePromptContent(prompt, mentions),
    textCandidates,
  });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const initial = initialContentRef.current;
    if (
      initial.prompt !== initial.originalPrompt ||
      JSON.stringify(initial.mentions) !== JSON.stringify(initial.originalMentions)
    ) {
      onChangeRef.current(initial.prompt, initial.mentions);
    }
  }, []);

  function syncContent() {
    const content = readImagePromptEditor(editorRef.current);
    onChangeRef.current(content.prompt, content.mentions);
    return content;
  }

  useImperativeHandle(forwardedRef, () => ({
    clearPendingReference() {
      pendingReferenceAnchor.current?.remove();
      pendingReferenceAnchor.current = null;
    },
    insertPendingReference(reference) {
      const editor = editorRef.current;
      const anchor = pendingReferenceAnchor.current;
      if (!editor || !anchor || !editor.contains(anchor)) return false;

      const chip = createImagePromptReferenceChip(reference);
      const trailingSpace = document.createTextNode("\u00a0");
      anchor.replaceWith(chip, trailingSpace);
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStartAfter(trailingSpace);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      pendingReferenceAnchor.current = null;
      editor.focus();
      return syncContent();
    },
  }));

  function openReferenceMenuAtRange(range: Range) {
    pendingReferenceAnchor.current?.remove();
    const anchor = document.createElement("span");
    anchor.contentEditable = "false";
    anchor.dataset.imagePromptReferenceAnchor = "true";
    range.deleteContents();
    range.insertNode(anchor);
    pendingReferenceAnchor.current = anchor;
    onReferenceRequest();
  }

  function handleInput() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const triggerRange = getTypedImageReferenceTriggerRange(range, editor);
    if (triggerRange) {
      openReferenceMenuAtRange(triggerRange);
    }
    syncContent();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "@") {
      event.preventDefault();
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && editorRef.current?.contains(range.commonAncestorContainer)) {
        openReferenceMenuAtRange(range);
      }
      return;
    }
  }

  return (
    <div
      className={className}
      contentEditable
      data-placeholder={placeholder}
      onBlur={() => {
        const content = syncContent();
        onBlur(content.prompt, content.mentions);
      }}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      ref={(editor) => {
        editorRef.current = editor;
        if (!editor || initializedRef.current) return;
        initializedRef.current = true;
        const initial = initialContentRef.current;
        renderImagePromptEditor(
          editor,
          initial.prompt,
          initial.mentions,
          initial.candidates,
          initial.textCandidates,
        );
      }}
      role="textbox"
      suppressContentEditableWarning
    />
  );
});

function getTypedImageReferenceTriggerRange(
  selectionRange: Range | null,
  editor: HTMLDivElement | null,
) {
  if (
    !selectionRange ||
    !selectionRange.collapsed ||
    !editor?.contains(selectionRange.startContainer)
  ) {
    return null;
  }

  const container = selectionRange.startContainer;
  const offset = selectionRange.startOffset;
  if (container.nodeType === Node.TEXT_NODE) {
    const text = container.textContent ?? "";
    if (offset < 1 || text[offset - 1] !== "@") return null;
    const triggerRange = document.createRange();
    triggerRange.setStart(container, offset - 1);
    triggerRange.setEnd(container, offset);
    return triggerRange;
  }

  const previousChild = container.childNodes[offset - 1];
  const previousText = previousChild?.textContent ?? "";
  if (previousChild?.nodeType !== Node.TEXT_NODE || !previousText.endsWith("@")) {
    return null;
  }
  const triggerRange = document.createRange();
  triggerRange.setStart(previousChild, previousText.length - 1);
  triggerRange.setEnd(previousChild, previousText.length);
  return triggerRange;
}

function createImagePromptReferenceChip(reference: ImagePromptReference) {
  const chip = document.createElement("span");
  chip.className = "mx-0.5 inline-flex max-w-44 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 align-middle text-xs font-medium text-zinc-700";
  chip.contentEditable = "false";
  chip.dataset.imagePromptReferenceId = reference.nodeId;
  chip.dataset.imagePromptReferenceKind = reference.kind;
  chip.title = reference.title;

  if (reference.kind === "image") {
    const image = document.createElement("img");
    image.alt = "";
    image.className = "size-4 shrink-0 rounded object-cover";
    image.src = reference.url;
    chip.append(image);
  } else {
    const icon = document.createElement("span");
    icon.className = "flex size-4 shrink-0 items-center justify-center rounded bg-white text-[10px]";
    icon.textContent = "T";
    chip.append(icon);
  }
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = reference.title;
  chip.append(label);
  return chip;
}

function renderImagePromptEditor(
  editor: HTMLDivElement,
  prompt: string,
  mentions: ImagePromptMention[],
  candidates: ImagePromptImageReference[],
  textCandidates: ImagePromptTextReference[],
) {
  const normalized = normalizeImagePromptContent(prompt, mentions);
  const referencesById = new Map<string, ImagePromptReference>([
    ...candidates.map((candidate) => [candidate.nodeId, { ...candidate, kind: "image" as const }] as const),
    ...textCandidates.map((candidate) => [candidate.nodeId, { ...candidate, kind: "text" as const }] as const),
  ]);
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const mention of normalized.mentions) {
    const reference = referencesById.get(mention.nodeId);
    if (!reference) continue;
    const offset = Math.max(cursor, Math.min(mention.offset, normalized.prompt.length));
    if (offset > cursor) fragment.append(document.createTextNode(normalized.prompt.slice(cursor, offset)));
    fragment.append(createImagePromptReferenceChip(reference));
    cursor = offset;
  }
  if (cursor < normalized.prompt.length) {
    fragment.append(document.createTextNode(normalized.prompt.slice(cursor)));
  }
  editor.replaceChildren(fragment);
}

function readImagePromptEditor(editor: HTMLDivElement | null) {
  const mentions: ImagePromptMention[] = [];
  let prompt = "";

  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      prompt += node.textContent?.replaceAll("\u00a0", " ") ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const referenceId = node.dataset.imagePromptReferenceId;
    if (referenceId) {
      mentions.push({ nodeId: referenceId, offset: prompt.length });
      return;
    }
    if (node.dataset.imagePromptReferenceAnchor) return;
    if (node.tagName === "BR") {
      prompt += "\n";
      return;
    }
    const isBlock = node.tagName === "DIV" || node.tagName === "P";
    if (isBlock && prompt && !prompt.endsWith("\n")) prompt += "\n";
    for (const child of node.childNodes) visit(child);
  }

  if (editor) for (const child of editor.childNodes) visit(child);
  return normalizeImagePromptContent(prompt, mentions);
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
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
