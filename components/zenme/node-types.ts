import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

export type CanvasNodeData = {
  kind:
    | "image"
    | "file"
    | "code"
    | "markdown"
    | "text"
    | "textGeneration"
    | "imageEdit"
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
  imageEditPrompt?: string;
  imageEditModel?: string;
  imageEditAspectRatio?: string;
  imageEditQuality?: string;
  imageEditStatus?: "idle" | "editing" | "done" | "failed";
  imageEditError?: string;
  sourceImageUrl?: string;
  sourceImageTitle?: string;
  hasIncomingEdge?: boolean;
  hasOutgoingEdge?: boolean;
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
  onUpdateImageEditNode?: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "fileId"
        | "imageEditAspectRatio"
        | "imageEditError"
        | "imageEditModel"
        | "imageEditQuality"
        | "imageEditPrompt"
        | "imageEditStatus"
        | "originalUrl"
        | "previewUrl"
        | "title"
      >
    >,
  ) => void;
  onSubmitImageEditNode?: (
    nodeId: string,
    input?: { aspectRatio?: string; model?: string; prompt?: string; quality?: string },
  ) => Promise<void> | void;
};

export const NODE_RIGHT_HANDLE_ID = "node-right";
export const NODE_ACTION_HANDLE_ID = "node-action";
export const NODE_CONTEXT_HANDLE_ID = "node-context";
export const NODE_CONTEXT_TARGET_HANDLE_ID = "node-context-target";
