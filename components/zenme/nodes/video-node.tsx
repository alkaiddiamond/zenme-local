"use client";

import {
  forwardRef,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Mic,
  Sparkles,
  Video,
  Volume2,
  VolumeX,
} from "lucide-react";

import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  NodeContextHandle,
  NodeActionHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { EditableNodeTitle } from "@/components/zenme/nodes/editable-node-title";
import { ImageReferencePicker } from "@/components/zenme/nodes/image-edit-node";
import { ImageTaskTiming } from "@/components/zenme/nodes/image-task-timing";
import { rememberAiModelPreference, useAiModelOptions } from "@/components/zenme/use-ai-model-options";
import { ZenmeModelPicker } from "@/components/zenme/visual-components";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"];
const RESOLUTIONS = ["480p", "720p", "1080p"];
const DURATIONS = Array.from({ length: 9 }, (_, index) => index + 4);

type VideoNodeUpdate = Parameters<NonNullable<CanvasNodeData["onUpdateVideoNode"]>>[1];
type ImageReference = NonNullable<CanvasNodeData["imageReferenceCandidates"]>[number];
type VideoPromptMention = NonNullable<CanvasNodeData["videoPromptMentions"]>[number];

type VideoPromptEditorHandle = {
  clearPendingReference: () => void;
  insertPendingReference: (reference: ImageReference) => false | {
    mentions: VideoPromptMention[];
    prompt: string;
  };
  removeReferences: (nodeIds: string[]) => {
    mentions: VideoPromptMention[];
    prompt: string;
  };
};

export function VideoNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const models = useAiModelOptions("video");
  const [prompt, setPrompt] = useState(nodeData.videoPrompt ?? "");
  const [promptMentions, setPromptMentions] = useState(
    nodeData.videoPromptMentions ?? [],
  );
  const [model, setModel] = useState(nodeData.videoModel ?? "");
  const [ratio, setRatio] = useState(nodeData.videoRatio ?? "adaptive");
  const [resolution, setResolution] = useState(nodeData.videoResolution ?? "720p");
  const [duration, setDuration] = useState(nodeData.videoDuration ?? 5);
  const [generateAudio, setGenerateAudio] = useState(nodeData.videoGenerateAudio !== false);
  const [referenceMode, setReferenceMode] = useState(nodeData.videoReferenceMode ?? "firstLast");
  const [submitting, setSubmitting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [referencePickerRequest, setReferencePickerRequest] = useState(0);
  const promptEditorRef = useRef<VideoPromptEditorHandle>(null);
  const isResult = nodeData.kind === "video";
  const running = submitting || nodeData.videoStatus === "generating";
  const effectiveRatio = referenceMode === "firstLast" ? "adaptive" : ratio;

  useEffect(() => {
    if (!model && models[0]) setModel(models[0].id);
  }, [model, models]);

  useEffect(() => {
    if (referenceMode !== "firstLast" || ratio === "adaptive") return;
    setRatio("adaptive");
    nodeData.onUpdateVideoNode?.(id, { videoRatio: "adaptive" });
  }, [id, nodeData, ratio, referenceMode]);

  function update(updates: VideoNodeUpdate) {
    nodeData.onUpdateVideoNode?.(id, updates);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || !model || running) return;
    setSubmitting(true);
    update({
      videoDuration: duration,
      videoGenerateAudio: generateAudio,
      videoModel: model,
      videoPrompt: prompt.trim(),
      videoPromptMentions: promptMentions,
      videoRatio: effectiveRatio,
      videoReferenceMode: referenceMode,
      videoResolution: resolution,
    });
    try {
      await nodeData.onSubmitVideoNode?.(id, {
        duration,
        generateAudio,
        model,
        prompt: prompt.trim(),
        ratio: effectiveRatio,
        referenceMode,
        resolution,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={`group relative h-full w-full text-zinc-950 ${isRenaming ? "zenme-node-renaming" : ""}`}>
      <NodeTargetHandle revealOnHover={false} visible={Boolean(nodeData.hasIncomingEdge)} />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextHandle selected={Boolean(selected)} />
      <NodeActionHandle selected={Boolean(selected && !isRenaming)} />
      <EditableNodeTitle
        fallbackTitle="视频生成"
        icon={<Video className="size-4" />}
        onCommit={(title) => update({ title })}
        onEditingChange={setIsRenaming}
        title={nodeData.title}
      />
      {isResult ? (
        <VideoResult nodeData={nodeData} running={running} selected={Boolean(selected)} />
      ) : (
        <form
          className="relative h-full min-h-[176px] w-full min-w-[420px] text-zinc-950"
          onSubmit={submit}
        >
          <div
            className={`zenme-shadow-node flex h-full min-h-[176px] flex-col rounded-xl border bg-white p-3 ${selected ? "border-zinc-900" : "border-zinc-200"}`}
          >
              <ImageReferencePicker
                candidates={nodeData.imageReferenceCandidates ?? []}
                onChange={(nodeIds) => {
                  const editorContent = promptEditorRef.current?.removeReferences(nodeIds);
                  const nextMentions = editorContent?.mentions ?? promptMentions.filter(
                    (mention) => nodeIds.includes(mention.nodeId),
                  );
                  const nextPrompt = editorContent?.prompt ?? prompt;
                  setPrompt(nextPrompt);
                  setPromptMentions(nextMentions);
                  update({
                    imageReferenceNodeIds: nodeIds,
                    videoPrompt: nextPrompt,
                    videoPromptMentions: nextMentions,
                  });
                }}
                onOpenChange={(open) => {
                  if (!open) {
                    promptEditorRef.current?.clearPendingReference();
                  }
                }}
                onSelect={(reference) => {
                  const editorContent = promptEditorRef.current?.insertPendingReference(reference);
                  if (!editorContent) return;
                  setPrompt(editorContent.prompt);
                  setPromptMentions(editorContent.mentions);
                  update({
                    videoPrompt: editorContent.prompt,
                    videoPromptMentions: editorContent.mentions,
                  });
                }}
                openRequest={referencePickerRequest}
                references={nodeData.imageReferences ?? []}
                required={false}
              />
              <VideoPromptEditor
                candidates={nodeData.imageReferenceCandidates ?? []}
                mentions={promptMentions}
                onBlur={(nextPrompt, nextMentions) => update({
                  videoPrompt: nextPrompt,
                  videoPromptMentions: nextMentions,
                })}
                onChange={(nextPrompt, nextMentions) => {
                  setPrompt(nextPrompt);
                  setPromptMentions(nextMentions);
                }}
                onReferenceRequest={() =>
                  setReferencePickerRequest((request) => request + 1)
                }
                placeholder="描述任何你想要生成的内容，按 @ 引用素材"
                prompt={prompt}
                ref={promptEditorRef}
              />
              {nodeData.videoError ? (
                <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-600">
                  {nodeData.videoError}
                </p>
              ) : null}
              <div className="nodrag nowheel mt-auto flex min-w-0 items-center justify-between gap-3 pt-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ZenmeModelPicker
                    compact
                    icon={<Sparkles className="size-3.5" />}
                    model={model}
                    models={models}
                    onChange={(value) => {
                      setModel(value);
                      update({ videoModel: value });
                    void rememberAiModelPreference("video", value);
                  }}
                  />
                  <VideoSettings
                    duration={duration}
                    generateAudio={generateAudio}
                    onDurationChange={(value) => {
                      setDuration(value);
                      update({ videoDuration: value });
                    }}
                    onGenerateAudioChange={(value) => {
                      setGenerateAudio(value);
                      update({ videoGenerateAudio: value });
                    }}
                    onRatioChange={(value) => {
                      setRatio(value);
                      update({ videoRatio: value });
                    }}
                    onReferenceModeChange={(value) => {
                      setReferenceMode(value);
                      if (value === "firstLast") {
                        setRatio("adaptive");
                        update({
                          videoRatio: "adaptive",
                          videoReferenceMode: value,
                        });
                        return;
                      }
                      const nextRatio = ratio === "adaptive" ? "16:9" : ratio;
                      setRatio(nextRatio);
                      update({
                        videoRatio: nextRatio,
                        videoReferenceMode: value,
                      });
                    }}
                    onResolutionChange={(value) => {
                      setResolution(value);
                      update({ videoResolution: value });
                    }}
                    ratio={effectiveRatio}
                    referenceMode={referenceMode}
                    resolution={resolution}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    aria-label="语音输入（即将支持）"
                    className="flex size-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled
                    title="语音输入即将支持"
                    type="button"
                  >
                    <Mic className="size-4" />
                  </button>
                  <span className="h-5 w-px bg-zinc-200" />
                  <button
                    aria-busy={running}
                    aria-label={running ? "正在生成视频" : "生成视频"}
                    className={`flex size-9 items-center justify-center rounded-full bg-zinc-950 text-white transition-colors hover:bg-zinc-800 active:bg-black focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus-ring)] ${running ? "cursor-wait" : "disabled:cursor-not-allowed disabled:bg-zinc-300"}`}
                    disabled={running || !prompt.trim() || !model}
                    type="submit"
                  >
                    {running ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-5" strokeWidth={1.75} />}
                  </button>
                </div>
              </div>
          </div>
        </form>
      )}
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected && !isRenaming)}
        lineClassName="zenme-text-resize-line"
        minHeight={isResult ? 220 : 176}
        minWidth={420}
      />
    </div>
  );
}

const VideoPromptEditor = forwardRef<VideoPromptEditorHandle, {
  candidates: ImageReference[];
  mentions: VideoPromptMention[];
  onBlur: (prompt: string, mentions: VideoPromptMention[]) => void;
  onChange: (prompt: string, mentions: VideoPromptMention[]) => void;
  onReferenceRequest: () => void;
  placeholder: string;
  prompt: string;
}>(function VideoPromptEditor(
  {
    candidates,
    mentions,
    onBlur,
    onChange,
    onReferenceRequest,
    placeholder,
    prompt,
  },
  forwardedRef,
) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);
  const pendingReferenceAnchor = useRef<HTMLElement | null>(null);
  const initialContentRef = useRef({ candidates, mentions, prompt });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  function syncContent() {
    const content = readVideoPromptEditor(editorRef.current);
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
      if (!editor || !anchor || !editor.contains(anchor)) {
        return false;
      }

      const chip = createVideoPromptReferenceChip(reference);
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
    removeReferences(nodeIds) {
      const editor = editorRef.current;
      if (editor) {
        for (const chip of editor.querySelectorAll<HTMLElement>(
          "[data-video-reference-id]",
        )) {
          if (!nodeIds.includes(chip.dataset.videoReferenceId ?? "")) {
            chip.remove();
          }
        }
      }
      return syncContent();
    },
  }));

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "@") {
      event.preventDefault();
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && editorRef.current?.contains(range.commonAncestorContainer)) {
        pendingReferenceAnchor.current?.remove();
        const anchor = document.createElement("span");
        anchor.contentEditable = "false";
        anchor.dataset.videoReferenceAnchor = "true";
        range.deleteContents();
        range.insertNode(anchor);
        pendingReferenceAnchor.current = anchor;
      }
      onReferenceRequest();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.closest("form")?.requestSubmit();
    }
  }

  return (
    <div
      className="zenme-text-ai-input nodrag nowheel min-h-[72px] flex-1 whitespace-pre-wrap break-words bg-transparent px-1 py-2 text-sm leading-6 text-zinc-900 outline-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]"
      contentEditable
      data-placeholder={placeholder}
      onBlur={() => {
        const content = syncContent();
        onBlur(content.prompt, content.mentions);
      }}
      onInput={syncContent}
      onKeyDown={handleKeyDown}
      ref={(editor) => {
        editorRef.current = editor;
        if (!editor || initializedRef.current) return;
        initializedRef.current = true;
        const initial = initialContentRef.current;
        renderVideoPromptEditor(
          editor,
          initial.prompt,
          initial.mentions,
          initial.candidates,
        );
      }}
      role="textbox"
      suppressContentEditableWarning
    />
  );
});

function createVideoPromptReferenceChip(reference: ImageReference) {
  const chip = document.createElement("span");
  chip.className = "mx-0.5 inline-flex max-w-44 items-center gap-1 rounded-md bg-zinc-100 px-1.5 py-0.5 align-middle text-xs font-medium text-zinc-700";
  chip.contentEditable = "false";
  chip.dataset.videoReferenceId = reference.nodeId;
  chip.title = reference.title;

  const image = document.createElement("img");
  image.alt = "";
  image.className = "size-4 shrink-0 rounded object-cover";
  image.src = reference.url;
  const label = document.createElement("span");
  label.className = "truncate";
  label.textContent = reference.title;
  chip.append(image, label);
  return chip;
}

function renderVideoPromptEditor(
  editor: HTMLDivElement,
  prompt: string,
  mentions: VideoPromptMention[],
  candidates: ImageReference[],
) {
  const referencesById = new Map(
    candidates.map((candidate) => [candidate.nodeId, candidate]),
  );
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const mention of [...mentions].sort((left, right) => left.offset - right.offset)) {
    const reference = referencesById.get(mention.nodeId);
    if (!reference) continue;
    const offset = Math.max(cursor, Math.min(mention.offset, prompt.length));
    if (offset > cursor) {
      fragment.append(document.createTextNode(prompt.slice(cursor, offset)));
    }
    fragment.append(createVideoPromptReferenceChip(reference));
    cursor = offset;
  }
  if (cursor < prompt.length) {
    fragment.append(document.createTextNode(prompt.slice(cursor)));
  }
  editor.replaceChildren(fragment);
}

function readVideoPromptEditor(editor: HTMLDivElement | null) {
  const mentions: VideoPromptMention[] = [];
  let prompt = "";

  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      prompt += node.textContent?.replaceAll("\u00a0", " ") ?? "";
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const referenceId = node.dataset.videoReferenceId;
    if (referenceId) {
      mentions.push({ nodeId: referenceId, offset: prompt.length });
      return;
    }
    if (node.dataset.videoReferenceAnchor) return;
    if (node.tagName === "BR") {
      prompt += "\n";
      return;
    }
    const isBlock = node.tagName === "DIV" || node.tagName === "P";
    if (isBlock && prompt && !prompt.endsWith("\n")) prompt += "\n";
    for (const child of node.childNodes) visit(child);
  }

  if (editor) {
    for (const child of editor.childNodes) visit(child);
  }
  return { mentions, prompt };
}

function VideoResult({ nodeData, running, selected }: { nodeData: CanvasNodeData; running: boolean; selected: boolean }) {
  return (
    <>
      <ImageTaskTiming durationMs={nodeData.videoTaskDurationMs} running={running} startedAt={nodeData.videoTaskStartedAt} />
      <div className={`zenme-shadow-node flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border bg-zinc-100 ${selected ? "border-zinc-900" : "border-zinc-200"}`}>
        {nodeData.originalUrl && nodeData.videoStatus === "done" ? (
          <video className="h-full w-full bg-black object-contain" controls preload="metadata" src={nodeData.originalUrl} />
        ) : (
          <div className="flex flex-col items-center gap-3 text-sm text-zinc-500">
            {running ? <Loader2 className="size-8 animate-spin" /> : <Video className="size-10" />}
            <span>{running ? "正在生成视频…" : nodeData.videoError ?? "视频生成未完成"}</span>
          </div>
        )}
      </div>
    </>
  );
}

function VideoSettings(props: {
  duration: number;
  generateAudio: boolean;
  onDurationChange: (value: number) => void;
  onGenerateAudioChange: (value: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  onRatioChange: (value: string) => void;
  onReferenceModeChange: (value: "firstLast" | "reference") => void;
  onResolutionChange: (value: string) => void;
  ratio: string;
  referenceMode: "firstLast" | "reference";
  resolution: string;
}) {
  const modeLabel = props.referenceMode === "firstLast" ? "首尾帧" : "全能参考";
  const ratioLabel = props.ratio === "adaptive" ? "自适应" : props.ratio;
  return (
    <DropdownMenu onOpenChange={props.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button aria-label="视频生成设置" className="flex h-[30px] min-w-0 items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50" type="button">
          {props.generateAudio ? <Volume2 className="size-3.5 shrink-0" /> : <VolumeX className="size-3.5 shrink-0" />}
          <span className="truncate">{modeLabel} · {ratioLabel} · {props.resolution} · {props.duration}s</span>
          <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="zenme-shadow-dropdown nodrag nowheel w-[28rem] rounded-xl border-zinc-200 bg-white p-3"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        side="top"
        sideOffset={8}
      >
        <div className="space-y-3">
          <SettingGroup className="grid-cols-2" label="生成方式">
            <Segment active={props.referenceMode === "firstLast"} onClick={() => props.onReferenceModeChange("firstLast")}>首尾帧</Segment>
            <Segment active={props.referenceMode === "reference"} onClick={() => props.onReferenceModeChange("reference")}>全能参考</Segment>
          </SettingGroup>
          <SettingGroup
            className={props.referenceMode === "reference" ? "grid-cols-6" : "grid-cols-1"}
            label="比例"
          >
            {props.referenceMode === "reference" ? (
              RATIOS.map((value) => <Segment active={props.ratio === value} key={value} onClick={() => props.onRatioChange(value)}>{value}</Segment>)
            ) : (
              <Segment active onClick={() => undefined}>自适应</Segment>
            )}
          </SettingGroup>
          <SettingGroup className="grid-cols-4" label="清晰度">
            {RESOLUTIONS.map((value) => <Segment active={props.resolution === value} key={value} onClick={() => props.onResolutionChange(value)}>{value}</Segment>)}
            <Segment active={false} disabled onClick={() => undefined}>4K</Segment>
          </SettingGroup>
          <SettingGroup className="grid-cols-9" label="生成时长">
            {DURATIONS.map((value) => <Segment active={props.duration === value} key={value} onClick={() => props.onDurationChange(value)}>{value}s</Segment>)}
          </SettingGroup>
          <SettingGroup className="grid-cols-2" label="生成音频">
            <Segment active={props.generateAudio} onClick={() => props.onGenerateAudioChange(true)}>开启</Segment>
            <Segment active={!props.generateAudio} onClick={() => props.onGenerateAudioChange(false)}>关闭</Segment>
          </SettingGroup>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SettingGroup({ children, className, label }: { children: ReactNode; className: string; label: string }) {
  return (
    <div>
      <p className="mb-1.5 px-0.5 text-[11px] font-medium text-zinc-500">{label}</p>
      <div className={`grid gap-1 rounded-lg bg-zinc-100 p-1 ${className}`}>{children}</div>
    </div>
  );
}

function Segment({ active, children, disabled = false, onClick }: { active: boolean; children: ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      className={`min-h-8 rounded-md px-1.5 py-1.5 text-xs font-medium transition ${active ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:bg-white/70 hover:text-zinc-800"} disabled:cursor-not-allowed disabled:opacity-35`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
