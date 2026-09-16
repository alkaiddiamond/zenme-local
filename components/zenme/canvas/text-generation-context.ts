import type { Edge } from "@xyflow/react";

import type { CanvasNode } from "@/components/zenme/canvas/types";
import {
  estimateTextTokenCount,
  getCanvasContextTokenBudget,
  truncateTextToTokenBudget,
} from "@/lib/ai/context-budget";

const TEXT_GENERATION_CONTEXT_NODE_KINDS = new Set([
  "agent",
  "book",
  "code",
  "image",
  "imageGeneration",
  "markdown",
  "note",
  "text",
  "textGeneration",
  "managedText",
  "lyrics",
  "video",
  "videoGeneration",
]);

const CONTEXT_TRUNCATION_MARKER = "\n\n[其余上下文因长度限制已省略]";

type CanvasContextEntry = {
  depth: number;
  nodeId: string;
  text: string;
};

export function collectTextGenerationContext(input: {
  edges: Edge[];
  contextWindow?: number;
  maxDepth?: number;
  maxTokens?: number;
  nodeId: string;
  nodes: CanvasNode[];
  sourceNodeIds?: string[];
  transcriptTurnIds?: ReadonlySet<string>;
}) {
  const maxDepth = normalizeTraversalDepth(input.maxDepth);
  const maxTokens = input.maxTokens ?? getCanvasContextTokenBudget({
    contextWindow: input.contextWindow,
  });
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const inboundByTarget = input.edges.reduce((result, edge) => {
    const sources = result.get(edge.target) ?? [];
    sources.push(edge.source);
    result.set(edge.target, sources);
    return result;
  }, new Map<string, string[]>());
  const visited = new Set<string>([input.nodeId]);
  const rootNode = nodeById.get(input.nodeId);
  const queue = (isTextGenerationContextBoundary(rootNode)
    ? []
    : input.sourceNodeIds ?? inboundByTarget.get(input.nodeId) ?? []
  ).map((nodeId) => ({
    depth: 1,
    nodeId,
  }));
  const entries: CanvasContextEntry[] = [];
  const seenContent = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth || visited.has(current.nodeId)) {
      continue;
    }

    visited.add(current.nodeId);
    const node = nodeById.get(current.nodeId);
    if (!node) {
      continue;
    }

    const contextText = node.data.kind === "agent" &&
      typeof node.data.agentTurnId === "string" &&
      input.transcriptTurnIds?.has(node.data.agentTurnId)
      ? `AI 回复节点「${node.data.title || node.data.kind}」（正文已包含在当前 Conversation 历史；此处仅表示显式上游连线关系）`
      : getCanvasNodeContextText(node);
    if (contextText) {
      const contentKey = normalizeContextContent(contextText);
      if (!seenContent.has(contentKey)) {
        seenContent.add(contentKey);
        entries.push({
          depth: current.depth,
          nodeId: current.nodeId,
          text: contextText,
        });
      }
    }

    if (isTextGenerationContextBoundary(node)) {
      continue;
    }

    for (const parentId of inboundByTarget.get(current.nodeId) ?? []) {
      queue.push({
        depth: current.depth + 1,
        nodeId: parentId,
      });
    }
  }

  return organizeTextGenerationContext(entries, maxTokens);
}

export function organizeTextGenerationContext(
  entries: CanvasContextEntry[],
  maxTokens = getCanvasContextTokenBudget({}),
) {
  const organizedEntries = deduplicateContextEntries(entries);
  if (organizedEntries.length === 0) return "";

  const maximumDepth = Math.max(...organizedEntries.map((entry) => entry.depth));
  let context = `画布上游上下文（已整理，共 ${organizedEntries.length} 个节点，最远 L${maximumDepth}，由近到远）`;

  for (const entry of organizedEntries) {
    const appended = appendBoundedContext(
      context,
      `上游上下文 L${entry.depth}\n${entry.text}`,
      maxTokens,
    );
    context = appended.context;
    if (appended.truncated) break;
  }

  return context;
}

export function limitTextGenerationContext(
  sections: Array<string | null | undefined>,
  maxTokens = getCanvasContextTokenBudget({}),
) {
  let context = "";

  for (const section of sections) {
    const normalizedSection = section?.trim();
    if (!normalizedSection) {
      continue;
    }

    const appended = appendBoundedContext(
      context,
      normalizedSection,
      maxTokens,
    );
    context = appended.context;
    if (appended.truncated) {
      break;
    }
  }

  return context;
}

export function collectTextGenerationImageUrls(input: {
  edges: Edge[];
  maxDepth?: number;
  maxImages?: number;
  nodeId: string;
  nodes: CanvasNode[];
  sourceNodeIds?: string[];
}) {
  const maxDepth = normalizeTraversalDepth(input.maxDepth);
  const maxImages = input.maxImages ?? 4;
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const inboundByTarget = input.edges.reduce((result, edge) => {
    const sources = result.get(edge.target) ?? [];
    sources.push(edge.source);
    result.set(edge.target, sources);
    return result;
  }, new Map<string, string[]>());
  const visited = new Set<string>([input.nodeId]);
  const rootNode = nodeById.get(input.nodeId);
  const queue = (isTextGenerationContextBoundary(rootNode)
    ? []
    : input.sourceNodeIds ?? inboundByTarget.get(input.nodeId) ?? []
  ).map((nodeId) => ({ depth: 1, nodeId }));
  const urls: string[] = [];

  while (queue.length > 0 && urls.length < maxImages) {
    const current = queue.shift();
    if (!current || current.depth > maxDepth || visited.has(current.nodeId)) {
      continue;
    }

    visited.add(current.nodeId);
    const node = nodeById.get(current.nodeId);
    if (!node) continue;

    if (node.data.kind === "image") {
      const url = node.data.originalUrl ?? node.data.previewUrl;
      if (url && !urls.includes(url)) urls.push(url);
    }

    if (isTextGenerationContextBoundary(node)) {
      continue;
    }

    for (const parentId of inboundByTarget.get(current.nodeId) ?? []) {
      queue.push({ depth: current.depth + 1, nodeId: parentId });
    }
  }

  return urls;
}

export function isTextGenerationContextNode(node: CanvasNode) {
  return TEXT_GENERATION_CONTEXT_NODE_KINDS.has(node.data.kind);
}

export function hasCanvasNodeContextText(node: CanvasNode) {
  const data = node.data;
  switch (data.kind) {
    case "text":
    case "managedText":
    case "markdown":
      return Boolean(data.plainText);
    case "code":
      return Boolean(
        data.codeContent ||
        data.plainText ||
        data.richTextHtml,
      );
    case "agent":
      return Boolean(
        data.aiPrompt ||
        data.aiResponse ||
        data.plainText,
      );
    case "note":
    case "book":
    case "image":
    case "video":
      return true;
    case "videoGeneration":
      return Boolean(data.videoPrompt);
    case "lyrics":
      return Boolean(data.musicLyrics?.some((line) => line.text));
    case "imageGeneration":
      return Boolean(data.imagePrompt);
    case "textGeneration":
      return Boolean(data.textGenerationPrompt);
    default:
      return false;
  }
}

export function getCanvasNodeContextText(node: CanvasNode) {
  const title = node.data.title || node.data.kind;

  if (node.data.kind === "text") {
    const text = node.data.plainText?.trim();
    if (!text) {
      return "";
    }

    if (node.data.textMode === "markdown") {
      return `Markdown 节点「${title}」\n${text}`;
    }

    if (node.data.textMode === "code") {
      return `代码节点「${title}」\n语言：${node.data.codeLanguage ?? "text"}\n${text}`;
    }

    return `文本节点「${title}」\n${text}`;
  }

  if (node.data.kind === "managedText") {
    const text = node.data.plainText?.trim();
    if (!text) {
      return "";
    }

    const name = node.data.name?.trim() || "未命名节点";
    const tags = node.data.tags?.length ? `\n标签：${node.data.tags.join("、")}` : "";
    return `强管理节点「${name}」${tags}\n${text}`;
  }

  if (node.data.kind === "markdown") {
    const markdown = node.data.plainText?.trim();
    return markdown ? `Markdown 节点「${title}」\n${markdown}` : "";
  }

  if (node.data.kind === "code") {
    const code =
      node.data.codeContent?.trim() ||
      node.data.plainText?.trim() ||
      stripHtmlToText(node.data.richTextHtml).trim();
    return code
      ? `代码节点「${title}」\n语言：${node.data.codeLanguage ?? "text"}\n${code}`
      : "";
  }

  if (node.data.kind === "agent") {
    const prompt = node.data.aiPrompt?.trim();
    const response = node.data.aiResponse?.trim() || node.data.plainText?.trim();
    return [
      `AI 回复节点「${title}」`,
      prompt ? `提问：\n${prompt}` : "",
      response ? `回答：\n${response}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (node.data.kind === "note") {
    return [
      `阅读笔记「${title}」`,
      node.data.sourceBookTitle ? `来源：${node.data.sourceBookTitle}` : "",
      node.data.chapterTitle ? `章节：${node.data.chapterTitle}` : "",
      node.data.selectedText ? `原文：\n${node.data.selectedText}` : "",
      node.data.comment ? `备注：\n${node.data.comment}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (node.data.kind === "book") {
    return [
      `书籍节点「${title}」`,
      node.data.fileName ? `文件名：${node.data.fileName}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (node.data.kind === "lyrics") {
    const lyrics = (node.data.musicLyrics ?? [])
      .filter((line) => line.text.trim())
      .map((line) => `${formatTimestamp(line.start)} ${line.text.trim()}`)
      .join("\n");
    return lyrics ? `歌词节点「${title}」\n${lyrics}` : "";
  }

  if (node.data.kind === "imageGeneration") {
    const prompt = node.data.imagePrompt?.trim();
    return prompt ? `图片提示词节点「${title}」\n${prompt}` : "";
  }

  if (node.data.kind === "image") {
    return node.data.originalUrl || node.data.previewUrl
      ? `图片节点「${title}」（图片内容已作为视觉输入提供）`
      : `图片节点「${title}」（暂无可用图片内容）`;
  }

  if (node.data.kind === "textGeneration") {
    const prompt = node.data.textGenerationPrompt?.trim();
    return prompt ? `文本生成节点「${title}」\n${prompt}` : "";
  }

  if (node.data.kind === "video" || node.data.kind === "videoGeneration") {
    return [
      `视频${node.data.kind === "videoGeneration" ? "生成" : ""}节点「${title}」`,
      node.data.videoPrompt ? `生成提示词：${node.data.videoPrompt}` : "",
      node.data.fileName ? `文件名：${node.data.fileName}` : "",
      node.data.videoStatus ? `状态：${node.data.videoStatus}` : "",
      node.data.videoDuration ? `生成时长设置：${node.data.videoDuration} 秒` : "",
      node.data.videoResolution ? `清晰度设置：${node.data.videoResolution}` : "",
      node.data.videoRatio ? `画幅设置：${node.data.videoRatio}` : "",
      "这里只提供节点信息与生成设置，未提供视频画面或音轨；不要将生成提示词当作实际视频内容。",
    ].filter(Boolean).join("\n");
  }

  return "";
}

function isTextGenerationContextBoundary(node: CanvasNode | undefined) {
  return node?.data.kind === "note" || node?.data.kind === "reader";
}

function appendBoundedContext(
  context: string,
  section: string,
  maxTokens: number,
) {
  const separator = context ? "\n\n---\n\n" : "";
  const prefix = `${context}${separator}`;
  const availableTokens = Math.max(
    0,
    Math.floor(maxTokens) - estimateTextTokenCount(prefix),
  );

  if (estimateTextTokenCount(section) <= availableTokens) {
    return {
      context: `${prefix}${section}`,
      truncated: false,
    };
  }

  if (availableTokens <= 0) {
    return { context, truncated: true };
  }

  return {
    context: `${prefix}${truncateTextToTokenBudget(
      section,
      availableTokens,
      CONTEXT_TRUNCATION_MARKER,
    )}`,
    truncated: true,
  };
}

function normalizeTraversalDepth(maxDepth?: number) {
  return typeof maxDepth === "number" && Number.isFinite(maxDepth)
    ? Math.max(0, Math.floor(maxDepth))
    : Number.POSITIVE_INFINITY;
}

function normalizeContextContent(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function deduplicateContextEntries(entries: CanvasContextEntry[]) {
  const seen = new Set<string>();
  return [...entries]
    .sort((left, right) => left.depth - right.depth)
    .filter((entry) => {
      const key = normalizeContextContent(entry.text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatTimestamp(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = Math.floor(safeSeconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function stripHtmlToText(html?: string) {
  if (!html) {
    return "";
  }

  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}
