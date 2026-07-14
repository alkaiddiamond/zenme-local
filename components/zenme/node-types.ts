import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

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
    | "textGeneration"
    | "imageGeneration"
    | "agent"
    | "book"
    | "note"
    | "reader"
    | "group";
  title: string;
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
  aiPrompt?: string;
  aiResponse?: string;
  aiModel?: string;
  aiCreatedAt?: string;
  textGenerationPrompt?: string;
  textGenerationModel?: string;
  imagePrompt?: string;
  imageModel?: string;
  imageOutputAspectRatio?: string;
  imageQuality?: string;
  imageStatus?: "idle" | "editing" | "done" | "failed";
  imageError?: string;
  imageTaskStartedAt?: string;
  imageTaskDurationMs?: number;
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
    input?: { aspectRatio?: string; model?: string; prompt?: string; quality?: string },
  ) => Promise<void> | void;
};

export const NODE_RIGHT_HANDLE_ID = "node-right";
export const NODE_ACTION_HANDLE_ID = "node-action";
export const NODE_CONTEXT_HANDLE_ID = "node-context";
export const NODE_CONTEXT_TARGET_HANDLE_ID = "node-context-target";
