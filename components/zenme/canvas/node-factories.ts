import type { Edge } from "@xyflow/react";

import { NODE_RIGHT_HANDLE_ID } from "@/components/zenme/node-types";
import {
  DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
  DEFAULT_IMAGE_EDIT_QUALITY,
  getImageDisplaySize,
  getImageEditResultNodeSize,
  type ImageCameraControl,
} from "@/components/zenme/image-edit-options";
import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

type ExecutionIdentity = {
  attemptId: string;
  executionId: string;
  nodeRunId: string;
};

import { getReaderChildOrigin, readNodeSize } from "./geometry";
import type { CanvasNode } from "./types";

const TEXT_NODE_DEFAULT_SIZE = { height: 176, width: 560 };
const MANAGED_TEXT_NODE_DEFAULT_SIZE = { height: 380, width: 560 };
const TASK_NODE_COLLAPSED_SIZE = { height: 176, width: 560 };
const TASK_NODE_DEFAULT_EXPANDED_HEIGHT = 460;
const CODE_NODE_DEFAULT_SIZE = { height: 420, width: 720 };
const MARKDOWN_NODE_DEFAULT_SIZE = { height: 320, width: 560 };
export const NANO_BANANA_2_IMAGE_MODEL =
  "google/gemini-3.1-flash-image-preview";
export const IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE = { height: 260, width: 520 };
const IMAGE_RESULT_NODE_DEFAULT_SIZE = { height: 260, width: 520 };
const VIDEO_GENERATION_REQUEST_NODE_DEFAULT_SIZE = IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE;
const VIDEO_RESULT_NODE_DEFAULT_SIZE = { height: 315, width: 560 };
const TEXT_NODE_MIN_HEIGHT = 176;
const TEXT_NODE_MAX_GENERATED_HEIGHT = 560;
const TEXT_NODE_VERTICAL_PADDING = 56;
const TEXT_NODE_LINE_HEIGHT = 30;
const TEXT_NODE_ESTIMATED_CHARS_PER_LINE = 24;

export function createTextCanvasNode(input: {
  codeLanguage?: string;
  height?: number;
  id: string;
  model?: string;
  plainText?: string;
  position: { x: number; y: number };
  richTextHtml?: string;
  textMode?: "code" | "markdown" | "plain";
  title?: string;
  width?: number;
}): CanvasNode {
  return {
    id: input.id,
    type: "text",
    position: input.position,
    style: {
      height: input.height ?? TEXT_NODE_DEFAULT_SIZE.height,
      width: input.width ?? TEXT_NODE_DEFAULT_SIZE.width,
    },
    data: {
      kind: "text",
      title: input.title ?? "文本",
      richTextHtml: input.richTextHtml ?? "",
      plainText: input.plainText ?? "",
      codeContent: input.textMode === "code" ? (input.plainText ?? "") : undefined,
      codeLanguage: input.codeLanguage,
      textMode: input.textMode ?? "plain",
      textGenerationModel: input.model,
    },
  };
}

export function createManagedTextCanvasNode(input: {
  createdAt?: string;
  id: string;
  model?: string;
  name?: string;
  plainText?: string;
  position: { x: number; y: number };
  tags?: string[];
}): CanvasNode {
  return {
    id: input.id,
    type: "managedText",
    position: input.position,
    style: MANAGED_TEXT_NODE_DEFAULT_SIZE,
    data: {
      kind: "managedText",
      title: "强管理节点",
      name: input.name ?? "",
      tags: input.tags ?? [],
      createdAt: input.createdAt ?? new Date().toISOString(),
      plainText: input.plainText ?? "",
      richTextHtml: "",
      textMode: "plain",
      textGenerationModel: input.model,
    },
  };
}

export function createTaskCanvasNode(input: {
  createdAt?: string;
  id: string;
  name?: string;
  position: { x: number; y: number };
  tags?: string[];
}): CanvasNode {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return {
    id: input.id,
    type: "task",
    position: input.position,
    style: TASK_NODE_COLLAPSED_SIZE,
    data: {
      kind: "task",
      title: "任务",
      name: input.name ?? "",
      tags: input.tags ?? [],
      createdAt,
      updatedAt: createdAt,
      taskStatus: "inProgress",
      taskPriority: "P3",
      taskComplexity: "simple",
      taskUrgency: "stand",
      taskChildrenExpanded: false,
      taskExpandedHeight: TASK_NODE_DEFAULT_EXPANDED_HEIGHT,
    },
  };
}

export function createCodeCanvasNode(input: {
  codeContent?: string;
  codeLanguage?: string;
  height?: number;
  id: string;
  position: { x: number; y: number };
  width?: number;
}): CanvasNode {
  return createTextCanvasNode({
    codeLanguage: input.codeLanguage ?? "python",
    height: input.height ?? CODE_NODE_DEFAULT_SIZE.height,
    id: input.id,
    plainText: input.codeContent ?? "",
    position: input.position,
    textMode: "code",
    title: "代码",
    width: input.width ?? CODE_NODE_DEFAULT_SIZE.width,
  });
}

export function createMarkdownCanvasNode(input: {
  height?: number;
  id: string;
  markdown?: string;
  position: { x: number; y: number };
  title?: string;
  width?: number;
}): CanvasNode {
  return createTextCanvasNode({
    height: input.height ?? MARKDOWN_NODE_DEFAULT_SIZE.height,
    id: input.id,
    plainText: input.markdown ?? "",
    position: input.position,
    richTextHtml: "",
    textMode: "markdown",
    title: input.title ?? "Markdown",
    width: input.width ?? MARKDOWN_NODE_DEFAULT_SIZE.width,
  });
}

export function createTextGenerationCanvasNode(input: {
  id: string;
  model?: string;
  position: { x: number; y: number };
  prompt?: string;
  sourceNode?: CanvasNode;
}): { edge: Edge | null; node: CanvasNode } {
  const node: CanvasNode = {
    id: input.id,
    type: "textGeneration",
    position: input.position,
    style: {
      height: 180,
      width: 560,
    },
    data: {
      kind: "textGeneration",
      title: "文本生成",
      textGenerationModel: input.model ?? "glm-4.5",
      textGenerationPrompt: input.prompt ?? "",
    },
  };

  return {
    edge: input.sourceNode
      ? createConnectedEdge(input.sourceNode.id, input.id)
      : null,
    node,
  };
}

export function createReferencedImageGenerationCanvasNode(input: {
  aspectRatio?: string;
  id: string;
  model?: string;
  position?: { x: number; y: number };
  quality?: string;
  sourceNode: CanvasNode;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: 360,
    width: 280,
  });
  const node: CanvasNode = {
    id: input.id,
    type: "imageGeneration",
    position:
      input.position ?? {
        x: input.sourceNode.position.x + sourceSize.width + 80,
        y: input.sourceNode.position.y,
      },
    style: {
      height: IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE.height,
      width: IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE.width,
    },
    data: {
      kind: "imageGeneration",
      imageOperation: "generate",
      imageReferenceNodeIds:
        input.sourceNode.data.kind === "image" &&
        Boolean(
          input.sourceNode.data.originalUrl || input.sourceNode.data.previewUrl,
        )
          ? [input.sourceNode.id]
          : [],
      imageOutputAspectRatio:
        input.aspectRatio ?? DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
      title: "图片生成",
      imageModel: input.model ?? NANO_BANANA_2_IMAGE_MODEL,
      imagePrompt: "",
      imageQuality: input.quality ?? DEFAULT_IMAGE_EDIT_QUALITY,
      imageStatus: "idle",
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

export function createImageGenerationCanvasNode(input: {
  aspectRatio?: string;
  id: string;
  model?: string;
  position: { x: number; y: number };
  quality?: string;
}): CanvasNode {
  return {
    id: input.id,
    type: "imageGeneration",
    position: input.position,
    style: {
      height: IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE.height,
      width: IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE.width,
    },
    data: {
      kind: "imageGeneration",
      imageOperation: "generate",
      imageReferenceNodeIds: [],
      imageOutputAspectRatio:
        input.aspectRatio ?? DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
      title: "图片生成",
      imageModel: input.model ?? NANO_BANANA_2_IMAGE_MODEL,
      imagePrompt: "",
      imageQuality: input.quality ?? DEFAULT_IMAGE_EDIT_QUALITY,
      imageStatus: "idle",
    },
  };
}

export function createVideoGenerationCanvasNode(input: {
  id: string;
  model?: string;
  position: { x: number; y: number };
  sourceNode?: CanvasNode;
}): { edge: Edge | null; node: CanvasNode } {
  return {
    edge: input.sourceNode
      ? createConnectedEdge(input.sourceNode.id, input.id)
      : null,
    node: {
      id: input.id,
      type: "videoGeneration",
      position: input.position,
      style: VIDEO_GENERATION_REQUEST_NODE_DEFAULT_SIZE,
      data: {
        kind: "videoGeneration",
        title: "视频生成",
        videoPrompt: "",
        videoPromptMentions: [],
        videoReferenceMode: "firstLast",
        videoModel: input.model ?? "",
        videoRatio: "adaptive",
        videoResolution: "720p",
        videoDuration: 5,
        videoGenerateAudio: true,
        videoStatus: "idle",
      },
    },
  };
}

export function createPendingVideoResultChildCanvasNode(input: {
  duration: number;
  execution: ExecutionIdentity;
  generateAudio: boolean;
  id: string;
  model: string;
  position: { x: number; y: number };
  prompt: string;
  ratio: string;
  resolution: string;
  sourceNode: CanvasNode;
  startedAt: string;
}): { edge: Edge; node: CanvasNode } {
  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node: {
      id: input.id,
      type: "video",
      position: input.position,
      style: VIDEO_RESULT_NODE_DEFAULT_SIZE,
      data: {
        ...input.execution,
        kind: "video",
        title: "视频生成",
        videoDuration: input.duration,
        videoGenerateAudio: input.generateAudio,
        videoGenerationResult: true,
        videoModel: input.model,
        videoPrompt: input.prompt,
        videoRatio: input.ratio,
        videoResolution: input.resolution,
        videoStatus: "generating",
        videoTaskStartedAt: input.startedAt,
      },
    },
  };
}

export function createEditedImageChildCanvasNode(input: {
  aspectRatio?: string;
  fileId: string;
  id: string;
  originalUrl: string;
  position?: { x: number; y: number };
  previewUrl?: string;
  prompt: string;
  sourceNode: CanvasNode;
  title?: string;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: IMAGE_RESULT_NODE_DEFAULT_SIZE.height,
    width: IMAGE_RESULT_NODE_DEFAULT_SIZE.width,
  });
  const resultSize = getImageEditResultNodeSize(input.aspectRatio);
  const node: CanvasNode = {
    id: input.id,
    type: "image",
    position:
      input.position ?? {
        x: input.sourceNode.position.x + sourceSize.width + 80,
        y: input.sourceNode.position.y,
      },
    style: {
      height: resultSize.height,
      width: resultSize.width,
    },
    data: {
      fileId: input.fileId,
      imageOutputAspectRatio: input.aspectRatio,
      imagePrompt: input.prompt,
      imageGenerated: true,
      kind: "image",
      originalUrl: input.originalUrl,
      previewUrl: input.previewUrl ?? input.originalUrl,
      title: input.title ?? "图片生成",
      uploadStatus: "uploaded",
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

export function createTextChildCanvasNode(input: {
  id: string;
  position?: { x: number; y: number };
  selectedText: string;
  sourceNode: CanvasNode;
  title?: string;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: TEXT_NODE_DEFAULT_SIZE.height,
    width: TEXT_NODE_DEFAULT_SIZE.width,
  });
  const node = createTextCanvasNode({
    height: estimateTextNodeHeight(input.selectedText),
    id: input.id,
    plainText: input.selectedText,
    position: input.position ?? {
      x: input.sourceNode.position.x + sourceSize.width + 80,
      y: input.sourceNode.position.y + 48,
    },
    richTextHtml: textToRichTextHtml(input.selectedText),
    title: input.title ?? "文本",
  });

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

export function createAiResponseChildCanvasNode(input: {
  execution?: ExecutionIdentity;
  id: string;
  model?: string;
  position?: { x: number; y: number };
  prompt: string;
  response?: string;
  startedAt?: string;
  sourceNode: CanvasNode;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: TEXT_NODE_DEFAULT_SIZE.height,
    width: TEXT_NODE_DEFAULT_SIZE.width,
  });
  const node: CanvasNode = {
    id: input.id,
    type: "agent",
    position: input.position ?? {
      x: input.sourceNode.position.x + sourceSize.width + 80,
      y: input.sourceNode.position.y + 48,
    },
    style: {
      height: input.response ? estimateAiResponseNodeHeight(input.response) : 260,
      width: 620,
    },
    data: {
      ...input.execution,
      kind: "agent",
      title: "AI 回复",
      aiPrompt: input.prompt,
      aiResponse: input.response,
      aiModel: input.model,
      aiCreatedAt: new Date().toISOString(),
      aiStatus: input.response ? "done" : "generating",
      aiTaskStartedAt: input.startedAt ?? new Date().toISOString(),
      textGenerationModel: input.model,
      plainText: input.response ?? "",
      textMode: "markdown",
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

export function createPendingImageResultChildCanvasNode(input: {
  aspectRatio?: string;
  cameraControl?: ImageCameraControl;
  execution: ExecutionIdentity;
  id: string;
  model?: string;
  position: { x: number; y: number };
  prompt: string;
  quality?: string;
  sourceNode: CanvasNode;
  startedAt?: string;
}): { edge: Edge; node: CanvasNode } {
  const node: CanvasNode = {
    id: input.id,
    type: "imageGeneration",
    position: input.position,
    style: {
      height: IMAGE_RESULT_NODE_DEFAULT_SIZE.height,
      width: IMAGE_RESULT_NODE_DEFAULT_SIZE.width,
    },
    data: {
      ...input.execution,
      kind: "imageGeneration",
      title: "图片生成",
      imageOperation: "generate",
      imageGenerationResult: true,
      imageCameraControl: input.cameraControl,
      imageModel: input.model ?? NANO_BANANA_2_IMAGE_MODEL,
      imageOutputAspectRatio: input.aspectRatio ?? DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
      imagePrompt: input.prompt,
      imageQuality: input.quality ?? DEFAULT_IMAGE_EDIT_QUALITY,
      imageStatus: "editing",
      imageTaskStartedAt: input.startedAt ?? new Date().toISOString(),
      imageReferenceNodeIds: [],
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

function estimateTextNodeHeight(text: string) {
  const lineCount = text.split(/\r?\n/).reduce((total, line) => {
    const weightedLength = Array.from(line).reduce(
      (sum, char) => sum + (char.charCodeAt(0) > 255 ? 1 : 0.55),
      0,
    );
    const estimatedWrappedLines = Math.max(
      1,
      Math.ceil(weightedLength / TEXT_NODE_ESTIMATED_CHARS_PER_LINE),
    );

    return total + estimatedWrappedLines;
  }, 0);
  const estimatedHeight =
    lineCount * TEXT_NODE_LINE_HEIGHT + TEXT_NODE_VERTICAL_PADDING;

  return Math.min(
    TEXT_NODE_MAX_GENERATED_HEIGHT,
    Math.max(TEXT_NODE_MIN_HEIGHT, estimatedHeight),
  );
}

function estimateAiResponseNodeHeight(response: string) {
  const contentHeight = estimateTextNodeHeight(response) + 84;

  return Math.min(720, Math.max(240, contentHeight));
}

export function createReaderCanvasNode(input: {
  id: string;
  readingAssetId: string;
  sourceNode: CanvasNode;
}): { edge: Edge; node: CanvasNode } {
  const node: CanvasNode = {
    id: input.id,
    type: "reader",
    position: {
      x: input.sourceNode.position.x + 360,
      y: input.sourceNode.position.y,
    },
    style: {
      width: 960,
      height: 620,
    },
    data: {
      kind: "reader",
      title: `阅读：${input.sourceNode.data.title}`,
      readingAssetId: input.readingAssetId,
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

export function createConnectedPlaceholderCanvasNode(input: {
  aspectRatio?: string;
  id: string;
  kind:
    | "text"
    | "agent"
    | "managedText"
    | "task"
    | "textGeneration"
    | "imageGeneration"
    | "videoGeneration";
  model?: string;
  position?: { x: number; y: number };
  quality?: string;
  sourceNode: CanvasNode;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: TEXT_NODE_DEFAULT_SIZE.height,
    width: TEXT_NODE_DEFAULT_SIZE.width,
  });
  if (input.kind === "textGeneration") {
    const { edge, node } = createTextGenerationCanvasNode({
      id: input.id,
      position:
        input.position ?? {
          x: input.sourceNode.position.x + sourceSize.width + 80,
          y: input.sourceNode.position.y,
        },
      sourceNode: input.sourceNode,
    });

    return {
      edge: edge as Edge,
      node,
    };
  }

  if (input.kind === "imageGeneration") {
    return createReferencedImageGenerationCanvasNode(input);
  }

  if (input.kind === "videoGeneration") {
    const result = createVideoGenerationCanvasNode({
      id: input.id,
      model: input.model,
      position: input.position ?? {
        x: input.sourceNode.position.x + sourceSize.width + 80,
        y: input.sourceNode.position.y,
      },
      sourceNode: input.sourceNode,
    });
    return { edge: result.edge as Edge, node: result.node };
  }

  if (input.kind === "task") {
    const taskNode = createTaskCanvasNode({
      id: input.id,
      position: input.position ?? {
        x: input.sourceNode.position.x + sourceSize.width + 80,
        y: input.sourceNode.position.y,
      },
    });
    return {
      edge: createConnectedEdge(input.sourceNode.id, input.id),
      node:
        input.sourceNode.data.kind === "task"
          ? {
              ...taskNode,
              data: {
                ...taskNode.data,
                taskParentId: input.sourceNode.id,
              },
            }
          : taskNode,
    };
  }

  if (input.kind === "managedText") {
    return {
      edge: createConnectedEdge(input.sourceNode.id, input.id),
      node: createManagedTextCanvasNode({
        id: input.id,
        model: input.model,
        position: input.position ?? {
          x: input.sourceNode.position.x + sourceSize.width + 80,
          y: input.sourceNode.position.y,
        },
      }),
    };
  }

  const node: CanvasNode = {
    id: input.id,
    type: input.kind,
    position: input.position ?? {
      x: input.sourceNode.position.x + sourceSize.width + 80,
      y: input.sourceNode.position.y + (input.kind === "agent" ? 120 : 0),
    },
    style:
      input.kind === "text"
        ? TEXT_NODE_DEFAULT_SIZE
        : undefined,
    data: {
      kind: input.kind,
      title: input.kind === "agent" ? "Agent 输出占位" : "文本",
      richTextHtml: input.kind === "text" ? "" : undefined,
      plainText: input.kind === "text" ? "" : undefined,
      textGenerationModel:
        input.kind === "text" || input.kind === "agent"
          ? input.model
          : undefined,
      uploadStatus: "pending",
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
  };
}

export function createReadingNoteCanvasNode(input: {
  asset: ReadingAsset;
  edges?: Edge[];
  fallbackPosition: { x: number; y: number };
  id: string;
  note: ReadingNote;
  nodes: CanvasNode[];
  readerNodeId?: string;
}): { edge: Edge | null; node: CanvasNode } {
  const sourceNode =
    (input.readerNodeId
      ? input.nodes.find((node) => node.id === input.readerNodeId)
      : undefined) ??
    input.nodes.find(
      (node) =>
        node.data.readingAssetId === input.asset.id ||
        node.id === input.asset.nodeId,
    );
  const sourcePosition = sourceNode?.position ?? input.fallbackPosition;
  const sourceSize = readNodeSize(
    sourceNode,
    sourceNode?.data.kind === "reader"
      ? { height: 620, width: 960 }
      : { height: 160, width: 320 },
  );
  const isReaderSource = sourceNode?.data.kind === "reader";
  const childNodesByEdgeOrder = sourceNode
    ? (input.edges ?? [])
        .filter(
          (edge) => edge.source === sourceNode.id && edge.target !== sourceNode.id,
        )
        .map((edge) => input.nodes.find((node) => node.id === edge.target))
        .filter((node): node is CanvasNode => Boolean(node))
    : [];
  const latestChild = childNodesByEdgeOrder[childNodesByEdgeOrder.length - 1];
  const latestChildSize = readNodeSize(latestChild, {
    height: 180,
    width: 320,
  });
  const defaultPosition =
    isReaderSource && sourceNode
      ? getReaderChildOrigin(sourceNode, sourceSize)
      : {
          x: sourcePosition.x + sourceSize.width + 60,
          y: sourcePosition.y + 80,
        };
  const node: CanvasNode = {
    id: input.id,
    type: "note",
    position: latestChild
      ? {
          x: latestChild.position.x,
          y: latestChild.position.y + latestChildSize.height + 32,
        }
      : defaultPosition,
    data: {
      kind: "note",
      title: input.note.chapterTitle || "阅读笔记",
      readingAssetId: input.asset.id,
      readingNoteId: input.note.id,
      sourceBookTitle: input.asset.title,
      selectedText: input.note.selectedText,
      comment: input.note.comment,
      chapterTitle: input.note.chapterTitle ?? undefined,
    },
  };

  return {
    edge: sourceNode
      ? createConnectedEdge(sourceNode.id, input.id)
      : null,
    node,
  };
}

export function createDroppedReadingNoteCanvasNode(input: {
  asset: ReadingAsset;
  id: string;
  note: ReadingNote;
  nodes: CanvasNode[];
  position: { x: number; y: number };
}): { edge: Edge | null; node: CanvasNode } {
  const sourceNode = input.nodes.find(
    (node) =>
      node.data.readingAssetId === input.asset.id ||
      node.id === input.asset.nodeId,
  );
  const node: CanvasNode = {
    id: input.id,
    type: "note",
    position: input.position,
    data: {
      kind: "note",
      title: input.note.chapterTitle || "阅读笔记",
      readingAssetId: input.asset.id,
      readingNoteId: input.note.id,
      sourceBookTitle: input.asset.title,
      selectedText: input.note.selectedText,
      comment: input.note.comment,
      chapterTitle: input.note.chapterTitle ?? undefined,
    },
  };

  return {
    edge: sourceNode
      ? createConnectedEdge(sourceNode.id, input.id)
      : null,
    node,
  };
}

export function createConnectedEdge(sourceId: string, targetId: string): Edge {
  return {
    id: `edge-${sourceId}-${targetId}`,
    source: sourceId,
    sourceHandle: NODE_RIGHT_HANDLE_ID,
    target: targetId,
    type: "default",
  };
}

function textToRichTextHtml(value: string) {
  const lines = value.split(/\r?\n/);
  const html = lines
    .map((line) => escapeHtml(line))
    .join("<br>");

  return `<p>${html}</p>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createMusicFolderCanvasNode(input: {
  id: string;
  mode: "system" | "virtual";
  path?: string;
  position: { x: number; y: number };
  sources?: NonNullable<CanvasNode["data"]["musicFolderSources"]>;
  title?: string;
}): CanvasNode {
  return {
    id: input.id,
    type: "musicFolder",
    position: input.position,
    data: {
      kind: "musicFolder",
      title: input.title ?? "文件夹",
      musicFolderMode: input.mode,
      musicFolderPath: input.path,
      musicFolderSources: input.sources ?? [],
      musicFolderExpanded: false,
    },
  };
}

export function createDerivedImageChildCanvasNode(input: {
  fileId: string;
  fileName: string;
  height: number;
  id: string;
  mimeType: string;
  originalUrl: string;
  position?: { x: number; y: number };
  previewUrl?: string;
  sourceNode: CanvasNode;
  title: string;
  width: number;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, IMAGE_RESULT_NODE_DEFAULT_SIZE);
  const imageAspectRatio = input.width / input.height;
  const resultSize = getImageDisplaySize(imageAspectRatio);
  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node: {
      id: input.id,
      type: "image",
      position: input.position ?? {
        x: input.sourceNode.position.x + sourceSize.width + 80,
        y: input.sourceNode.position.y,
      },
      style: resultSize,
      data: {
        fileId: input.fileId,
        fileName: input.fileName,
        imageAspectRatio,
        imageHeight: input.height,
        imageWidth: input.width,
        kind: "image",
        mimeType: input.mimeType,
        originalUrl: input.originalUrl,
        previewUrl: input.previewUrl ?? input.originalUrl,
        title: input.title,
        uploadStatus: "uploaded",
      },
    },
  };
}
