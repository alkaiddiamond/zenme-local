import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

export type CanvasNodeData = {
  kind:
    | "image"
    | "file"
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
