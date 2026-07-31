import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import type { AssetRef } from "@/lib/execution/types";
import type { ImageCameraControl } from "@/components/zenme/image-edit-options";

export type MusicChildNodeKind = "lyrics";
export type MusicLoopMode = "off" | "one" | "all";

export type MusicLyricLine = {
  end?: number;
  id?: string;
  section?: string;
  start: number;
  text: string;
};

export type MusicSourceSummary = {
  id: string;
  title: string;
};

export type CanvasTagColor =
  | "gray"
  | "brown"
  | "orange"
  | "yellow"
  | "green"
  | "blue"
  | "purple"
  | "pink"
  | "red";

export type ProjectTagAction =
  | { type: "delete"; tag: string }
  | { type: "color"; tag: string; color: CanvasTagColor };

export type TaskStatus = "inProgress" | "paused" | "completed";

export type TaskPriority = "P1" | "P2" | "P3";
export type TaskComplexity = "complex" | "medium" | "simple";
export type TaskUrgency = "stand" | "walk" | "run";

export function normalizeTaskStatus(value: unknown): TaskStatus {
  if (value === "paused" || value === "abandoned" || value === "archived") {
    return "paused";
  }
  if (value === "completed") return "completed";
  return "inProgress";
}

export function normalizeTaskPriority(value: unknown): TaskPriority {
  return value === "P1" || value === "P2" ? value : "P3";
}

export function normalizeTaskComplexity(value: unknown): TaskComplexity {
  if (value === "complex" || value === "medium") return value;
  return "simple";
}

export function normalizeTaskUrgency(value: unknown): TaskUrgency {
  if (value === "run" || value === "urgent") return "run";
  if (value === "walk") return "walk";
  return "stand";
}

export type TaskChildSummary = {
  id: string;
  name: string;
  status: TaskStatus;
};

export type TaskParentOption = {
  id: string;
  name: string;
};

export type CanvasNodeData = {
  kind:
    | "image"
    | "file"
    | "music"
    | "musicPlayer"
    | "lyrics"
    | "code"
    | "markdown"
    | "text"
    | "managedText"
    | "task"
    | "textGeneration"
    | "imageGeneration"
    | "videoGeneration"
    | "video"
    | "agent"
    | "book"
    | "note"
    | "reader"
    | "group";
  title: string;
  name?: string;
  tags?: string[];
  tagColors?: Partial<Record<string, CanvasTagColor>>;
  projectTags?: string[];
  projectTagColors?: Partial<Record<string, CanvasTagColor>>;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  taskStatus?: TaskStatus;
  taskPriority?: TaskPriority;
  taskComplexity?: TaskComplexity;
  taskUrgency?: TaskUrgency;
  taskParentId?: string;
  taskParentOptions?: TaskParentOption[];
  taskChildren?: TaskChildSummary[];
  taskProgress?: number;
  taskChildrenExpanded?: boolean;
  taskExpandedHeight?: number;
  projectId?: string;
  fileId?: string;
  readingAssetId?: string;
  readingNoteId?: string;
  groupId?: string;
  sourceBookTitle?: string;
  selectedText?: string;
  comment?: string;
  chapterTitle?: string;
  readingError?: string;
  fileName?: string;
  fileSize?: number;
  coverUrl?: string;
  previewUrl?: string;
  originalUrl?: string;
  mimeType?: string;
  musicError?: string;
  lyricsFetchStatus?: "fetching" | "succeeded" | "failed";
  lyricsFetchDurationMs?: number;
  lyricsWarnings?: string[];
  musicDuration?: number;
  musicCurrentTime?: number;
  musicIsPlaying?: boolean;
  musicLoop?: boolean;
  musicLoopMode?: MusicLoopMode;
  musicMuted?: boolean;
  musicPlaybackRate?: number;
  musicVolume?: number;
  musicWaveform?: number[];
  musicWaveformSourceNodeId?: string;
  musicWaveformVersion?: number;
  musicLyrics?: MusicLyricLine[];
  musicLyricsSourceNodeId?: string;
  musicChildExpanded?: boolean;
  musicSourceListExpanded?: boolean;
  musicSourceNodeId?: string;
  musicSources?: MusicSourceSummary[];
  musicLyricsOverlayOpen?: boolean;
  musicPlayerNodeId?: string;
  musicParentPlayerNodeId?: string;
  onEnsureMusicWaveform?: (playerNodeId: string) => Promise<void>;
  onCreateMusicPlayerNode?: (musicNodeId: string) => void;
  onLocateMusicPlayerNode?: (musicNodeId: string, playerNodeId: string) => void;
  onToggleMusicPlayback?: (playerNodeId: string, playing: boolean) => void;
  onEnsureMusicPlayback?: (playerNodeId: string) => void;
  onSeekMusicPlayer?: (playerNodeId: string, seconds: number) => void;
  onSelectMusicSource?: (playerNodeId: string, sourceNodeId: string) => void;
  onToggleMusicLyricsOverlay?: (playerNodeId: string) => void;
  onCreateMusicChildNode?: (playerNodeId: string, kind: MusicChildNodeKind) => void;
  onUpdateMusicNode?: (nodeId: string, updates: { title?: string }) => void;
  onUpdateMusicPlayback?: (playerNodeId: string, updates: {
    loop?: boolean;
    loopMode?: MusicLoopMode;
    muted?: boolean;
    playbackRate?: number;
    sourceListExpanded?: boolean;
    volume?: number;
  }) => void;
  imageGenerated?: boolean;
  imageOperation?: "edit" | "generate";
  imageHeight?: number;
  imageWidth?: number;
  imageAspectRatio?: number;
  uploadStatus?: "pending" | "uploaded" | "failed";
  readerCollapsed?: boolean;
  readerExpandedSize?: { height: number; width: number };
  richTextHtml?: string;
  plainText?: string;
  codeContent?: string;
  codeLanguage?: string;
  textMode?: "code" | "markdown" | "plain";
  textExpanded?: boolean;
  aiPrompt?: string;
  aiResponse?: string;
  aiModel?: string;
  aiCreatedAt?: string;
  aiStatus?: "generating" | "done" | "failed";
  aiError?: string;
  aiTaskStartedAt?: string;
  aiTaskDurationMs?: number;
  aiResponseExpanded?: boolean;
  textGenerationPrompt?: string;
  textGenerationModel?: string;
  imagePrompt?: string;
  imagePromptExpanded?: boolean;
  imagePromptMentions?: Array<{
    nodeId: string;
    offset: number;
  }>;
  imageModel?: string;
  imageCameraControl?: ImageCameraControl;
  imageOutputAspectRatio?: string;
  imageQuality?: string;
  imageStatus?: "idle" | "editing" | "done" | "failed";
  imageError?: string;
  imageTaskStartedAt?: string;
  imageTaskDurationMs?: number;
  imageGenerationResult?: boolean;
  imageReferences?: Array<{
    nodeId: string;
    title: string;
    url: string;
  }>;
  imageReferenceCandidates?: Array<{
    nodeId: string;
    title: string;
    url: string;
  }>;
  imageReferenceNodeIds?: string[];
  imageTextReferences?: Array<{
    nodeId: string;
    title: string;
  }>;
  imageTextReferenceCandidates?: Array<{
    nodeId: string;
    title: string;
  }>;
  imageTextReferenceNodeIds?: string[];
  executionId?: string;
  nodeRunId?: string;
  attemptId?: string;
  externalTaskId?: string;
  assetRefs?: AssetRef[];
  /** @deprecated Read legacy snapshots only; use externalTaskId. */
  providerTaskId?: string;
  videoPrompt?: string;
  videoPromptMentions?: Array<{
    nodeId: string;
    offset: number;
  }>;
  videoModel?: string;
  videoRatio?: string;
  videoResolution?: string;
  videoDuration?: number;
  videoGenerateAudio?: boolean;
  videoReferenceMode?: "firstLast" | "reference";
  videoStatus?: "idle" | "generating" | "done" | "failed";
  videoError?: string;
  videoTaskStartedAt?: string;
  videoTaskDurationMs?: number;
  videoGenerationResult?: boolean;
  hasIncomingEdge?: boolean;
  hasOutgoingEdge?: boolean;
  isMultiSelection?: boolean;
  hasRunningGenerationChild?: boolean;
  onUpdateProjectTag?: (action: ProjectTagAction) => void;
  onUpdateTaskNode?: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "name"
        | "tags"
        | "taskStatus"
        | "taskPriority"
        | "taskComplexity"
        | "taskUrgency"
      >
    >,
    ) => void;
  onSetTaskParent?: (
    nodeId: string,
    parentId?: string,
  ) => void;
  onLocateTaskNode?: (nodeId: string) => void;
  onToggleTaskChildren?: (
    nodeId: string,
    expanded: boolean,
    expandedContentHeight: number,
  ) => void;
  onToggleAiResponseExpanded?: (
    nodeId: string,
    expanded: boolean,
  ) => void;
  onToggleTextExpanded?: (
    nodeId: string,
    expanded: boolean,
  ) => void;
  onToggleImagePromptExpanded?: (
    nodeId: string,
    expanded: boolean,
  ) => void;
  onToggleMusicChildExpanded?: (
    nodeId: string,
    expanded: boolean,
  ) => void;
  onResolveImageDimensions?: (
    nodeId: string,
    dimensions: { height: number; width: number },
  ) => void;
  onCreateDerivedImageNode?: (
    nodeId: string,
    input: {
      file: File;
      height: number;
      operation: "brush" | "crop";
      width: number;
    },
  ) => Promise<void> | void;
  onCreateNoteNode?: (
    note: ReadingNote,
    asset: ReadingAsset,
    readerNodeId?: string,
  ) => void;
  onToggleReaderCollapse?: (nodeId: string) => void;
  onCreateTextChildNode?: (
    nodeId: string,
    selectedText: string,
    title?: string,
    options?: {
      aiModel?: string;
      kind?: "agent" | "text";
      prompt?: string;
    },
  ) => void;
  onUpdateTextNode?: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "codeContent"
        | "codeLanguage"
        | "plainText"
        | "richTextHtml"
        | "textMode"
        | "title"
        | "name"
        | "tags"
      >
    >,
  ) => void;
  onUpdateCodeNode?: (
    nodeId: string,
    updates: Partial<Pick<CanvasNodeData, "codeContent" | "codeLanguage" | "title">>,
  ) => void;
  onUpdateTextGenerationNode?: (
    nodeId: string,
    updates: Partial<
      Pick<CanvasNodeData, "textGenerationModel" | "textGenerationPrompt">
    >,
  ) => void;
  onSubmitTextGenerationNode?: (
    nodeId: string,
    input?: { model?: string; prompt?: string },
  ) => Promise<void> | void;
  onUpdateImageNode?: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "fileId"
        | "imageCameraControl"
        | "imageOutputAspectRatio"
        | "imageError"
        | "imageModel"
        | "imageQuality"
        | "imagePrompt"
        | "imagePromptMentions"
        | "imageStatus"
        | "imageReferenceNodeIds"
        | "imageTextReferenceNodeIds"
        | "imageTaskDurationMs"
        | "imageTaskStartedAt"
        | "originalUrl"
        | "previewUrl"
        | "title"
      >
    >,
  ) => void;
  onSubmitImageNode?: (
    nodeId: string,
    input?: {
      aspectRatio?: string;
      cameraControl?: ImageCameraControl;
      model?: string;
      prompt?: string;
      promptMentions?: Array<{ nodeId: string; offset: number }>;
      quality?: string;
    },
  ) => Promise<void> | void;
  onUpdateVideoNode?: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "fileId"
        | "imageReferenceNodeIds"
        | "originalUrl"
        | "title"
        | "videoDuration"
        | "videoError"
        | "videoGenerateAudio"
        | "videoModel"
        | "videoPrompt"
        | "videoPromptMentions"
        | "videoReferenceMode"
        | "videoRatio"
        | "videoResolution"
        | "videoStatus"
        | "videoTaskDurationMs"
        | "videoTaskStartedAt"
      >
    >,
  ) => void;
  onSubmitVideoNode?: (
    nodeId: string,
    input?: {
      duration?: number;
      generateAudio?: boolean;
      model?: string;
      prompt?: string;
      ratio?: string;
      referenceMode?: "firstLast" | "reference";
      resolution?: string;
    },
  ) => Promise<void> | void;
};

export const NODE_RIGHT_HANDLE_ID = "node-right";
export const NODE_LEFT_HANDLE_ID = "node-left";
export const NODE_ACTION_HANDLE_ID = "node-action";
export const NODE_CONTEXT_HANDLE_ID = "node-context";
export const NODE_CONTEXT_TARGET_HANDLE_ID = "node-context-target";
