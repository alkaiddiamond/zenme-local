import type { Edge } from "@xyflow/react";

import { NODE_RIGHT_HANDLE_ID } from "@/components/zenme/node-types";
import {
  DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
  DEFAULT_IMAGE_EDIT_QUALITY,
  getImageEditResultNodeSize,
} from "@/components/zenme/image-edit-options";
import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

import { readNodeSize } from "./geometry";
import type { CanvasNode } from "./types";

const TEXT_NODE_DEFAULT_SIZE = { height: 260, width: 520 };
const CODE_NODE_DEFAULT_SIZE = { height: 420, width: 720 };
const MARKDOWN_NODE_DEFAULT_SIZE = { height: 320, width: 560 };
export const NANO_BANANA_2_IMAGE_MODEL =
  "google/gemini-3.1-flash-image-preview";
const IMAGE_EDIT_NODE_DEFAULT_SIZE = { height: 260, width: 560 };
const TEXT_NODE_MIN_HEIGHT = 180;
const TEXT_NODE_MAX_GENERATED_HEIGHT = 560;
const TEXT_NODE_VERTICAL_PADDING = 56;
const TEXT_NODE_LINE_HEIGHT = 30;
const TEXT_NODE_ESTIMATED_CHARS_PER_LINE = 24;

export function createTextCanvasNode(input: {
  codeLanguage?: string;
  height?: number;
  id: string;
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

export function createImageEditCanvasNode(input: {
  id: string;
  position?: { x: number; y: number };
  sourceNode: CanvasNode;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: 360,
    width: 280,
  });
  const sourceImageUrl =
    input.sourceNode.data.originalUrl ?? input.sourceNode.data.previewUrl;
  const node: CanvasNode = {
    id: input.id,
    type: "imageEdit",
    position:
      input.position ?? {
        x: input.sourceNode.position.x + sourceSize.width + 80,
        y: input.sourceNode.position.y,
      },
    style: {
      height: IMAGE_EDIT_NODE_DEFAULT_SIZE.height,
      width: IMAGE_EDIT_NODE_DEFAULT_SIZE.width,
    },
    data: {
      kind: "imageEdit",
      imageEditAspectRatio: DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
      title: "图片编辑",
      imageEditModel: NANO_BANANA_2_IMAGE_MODEL,
      imageEditPrompt: "",
      imageEditQuality: DEFAULT_IMAGE_EDIT_QUALITY,
      imageEditStatus: "idle",
      sourceImageTitle: input.sourceNode.data.title,
      sourceImageUrl,
    },
  };

  return {
    edge: createConnectedEdge(input.sourceNode.id, input.id),
    node,
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
    height: IMAGE_EDIT_NODE_DEFAULT_SIZE.height,
    width: IMAGE_EDIT_NODE_DEFAULT_SIZE.width,
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
      imageEditAspectRatio: input.aspectRatio,
      imageEditPrompt: input.prompt,
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
  id: string;
  model?: string;
  position?: { x: number; y: number };
  prompt: string;
  response: string;
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
      height: estimateAiResponseNodeHeight(input.response),
      width: 620,
    },
    data: {
      kind: "agent",
      title: "AI 回复",
      aiPrompt: input.prompt,
      aiResponse: input.response,
      aiModel: input.model,
      aiCreatedAt: new Date().toISOString(),
      textGenerationModel: input.model,
      plainText: input.response,
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
  id: string;
  kind: "text" | "agent" | "textGeneration" | "imageEdit";
  position?: { x: number; y: number };
  sourceNode: CanvasNode;
}): { edge: Edge; node: CanvasNode } {
  const sourceSize = readNodeSize(input.sourceNode, {
    height: 260,
    width: 520,
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

  if (input.kind === "imageEdit") {
    return createImageEditCanvasNode(input);
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
        ? {
            height: 260,
            width: 520,
          }
        : undefined,
    data: {
      kind: input.kind,
      title: input.kind === "agent" ? "Agent 输出占位" : "文本",
      richTextHtml: input.kind === "text" ? "" : undefined,
      plainText: input.kind === "text" ? "" : undefined,
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
  const defaultPosition = {
    x: isReaderSource
      ? sourcePosition.x + sourceSize.width + 48
      : sourcePosition.x + sourceSize.width + 60,
    y: isReaderSource
      ? sourcePosition.y +
        Math.min(Math.max(sourceSize.height * 0.18, 80), 180)
      : sourcePosition.y + 80,
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

function createConnectedEdge(sourceId: string, targetId: string): Edge {
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
