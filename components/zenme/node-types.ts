import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import type { ImageCameraControl } from "@/components/zenme/image-edit-options";

export type MusicJobStatus =
  | "queued"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type MusicJobSnapshot = {
  id: string;
  status: MusicJobStatus;
  progress: number;
  stage: string;
  stageLabel: string;
  createdAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  elapsedMs?: number;
  durationMs?: number | null;
  retryable: boolean;
  error: { message?: string } | null;
  plannedStages?: Array<{
    adapterId?: string;
    device?: string;
    provides?: string[];
    requires?: string[];
    stageId?: string;
  }>;
  completedStages?: string[];
};

export type MusicChildNodeKind = "lyrics" | "musicAnalysis" | "sunoPrompt";

export type MusicLyricLine = {
  end?: number;
  id?: string;
  section?: string;
  start: number;
  text: string;
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
    | "musicAnalysis"
    | "sunoPrompt"
    | "code"
    | "markdown"
    | "text"
    | "managedText"
    | "task"
    | "textGeneration"
    | "imageGeneration"
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
  musicJobId?: string;
  musicJobStatus?: MusicJobStatus;
  musicProgress?: number;
  musicStage?: string;
  musicStageLabel?: string;
  musicRetryable?: boolean;
  musicError?: string;
  musicWarnings?: string[];
  musicJobCreatedAt?: string;
  musicJobStartedAt?: string;
  musicJobCompletedAt?: string;
  musicJobElapsedMs?: number;
  musicJobDurationMs?: number;
  musicAnalysisResult?: Record<string, unknown>;
  musicDuration?: number;
  musicCurrentTime?: number;
  musicIsPlaying?: boolean;
  musicLoop?: boolean;
  musicMuted?: boolean;
  musicPlaybackRate?: number;
  musicVolume?: number;
  musicWaveform?: number[];
  musicWaveformVersion?: number;
  musicLyrics?: MusicLyricLine[];
  musicChildExpanded?: boolean;
  musicPlayerNodeId?: string;
  musicParentPlayerNodeId?: string;
  sunoPromptZh?: string;
  sunoPromptEn?: string;
  onMusicAnalysisComplete?: (nodeId: string, jobId: string, result: Record<string, unknown>) => void;
  onEnsureMusicWaveform?: (playerNodeId: string) => Promise<void>;
  onMusicJobUpdate?: (nodeId: string, job: MusicJobSnapshot) => void;
  onCreateMusicPlayerNode?: (musicNodeId: string) => void;
  onLocateMusicPlayerNode?: (musicNodeId: string, playerNodeId: string) => void;
  onToggleMusicPlayback?: (playerNodeId: string, playing: boolean) => void;
  onEnsureMusicPlayback?: (playerNodeId: string) => void;
  onSeekMusicPlayer?: (playerNodeId: string, seconds: number) => void;
  onCancelMusicAnalysis?: (playerNodeId: string, jobId: string) => Promise<void> | void;
  onRetryMusicAnalysis?: (playerNodeId: string, jobId: string) => Promise<void> | void;
  onCreateMusicChildNode?: (playerNodeId: string, kind: MusicChildNodeKind) => void;
  onUpdateMusicNode?: (nodeId: string, updates: { title?: string }) => void;
  onUpdateMusicPlayback?: (playerNodeId: string, updates: {
    loop?: boolean;
    muted?: boolean;
    playbackRate?: number;
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
  onToggleMusicChildExpanded?: (
    nodeId: string,
    expanded: boolean,
  ) => void;
  onResolveImageDimensions?: (
    nodeId: string,
    dimensions: { height: number; width: number },
  ) => void;
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
        | "imageStatus"
        | "imageReferenceNodeIds"
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
      quality?: string;
    },
  ) => Promise<void> | void;
};

export const NODE_RIGHT_HANDLE_ID = "node-right";
export const NODE_LEFT_HANDLE_ID = "node-left";
export const NODE_ACTION_HANDLE_ID = "node-action";
export const NODE_CONTEXT_HANDLE_ID = "node-context";
export const NODE_CONTEXT_TARGET_HANDLE_ID = "node-context-target";
