import type { Edge } from "@xyflow/react";

import type { CanvasNode } from "@/components/zenme/canvas/types";

const TEXT_GENERATION_CONTEXT_NODE_KINDS = new Set([
  "agent",
  "book",
  "code",
  "image",
  "imageGeneration",
  "markdown",
  "note",
  "reader",
  "text",
  "textGeneration",
  "managedText",
  "lyrics",
]);

export function collectTextGenerationContext(input: {
  edges: Edge[];
  maxDepth?: number;
  nodeId: string;
  nodes: CanvasNode[];
  sourceNodeIds?: string[];
}) {
  const maxDepth = input.maxDepth ?? 3;
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const inboundByTarget = input.edges.reduce((result, edge) => {
    const sources = result.get(edge.target) ?? [];
    sources.push(edge.source);
    result.set(edge.target, sources);
    return result;
  }, new Map<string, string[]>());
  const visited = new Set<string>([input.nodeId]);
  const queue = (
    input.sourceNodeIds ?? inboundByTarget.get(input.nodeId) ?? []
  ).map((nodeId) => ({
    depth: 1,
    nodeId,
  }));
  const sections: string[] = [];

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

    const contextText = getCanvasNodeContextText(node);
    if (contextText) {
      sections.push(`上游上下文 L${current.depth}\n${contextText}`);
    }

    for (const parentId of inboundByTarget.get(current.nodeId) ?? []) {
      queue.push({
        depth: current.depth + 1,
        nodeId: parentId,
      });
    }
  }

  return sections.join("\n\n---\n\n");
}

export function collectTextGenerationImageUrls(input: {
  edges: Edge[];
  maxDepth?: number;
  maxImages?: number;
  nodeId: string;
  nodes: CanvasNode[];
  sourceNodeIds?: string[];
}) {
  const maxDepth = input.maxDepth ?? 3;
  const maxImages = input.maxImages ?? 4;
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const inboundByTarget = input.edges.reduce((result, edge) => {
    const sources = result.get(edge.target) ?? [];
    sources.push(edge.source);
    result.set(edge.target, sources);
    return result;
  }, new Map<string, string[]>());
  const visited = new Set<string>([input.nodeId]);
  const queue = (
    input.sourceNodeIds ?? inboundByTarget.get(input.nodeId) ?? []
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

    for (const parentId of inboundByTarget.get(current.nodeId) ?? []) {
      queue.push({ depth: current.depth + 1, nodeId: parentId });
    }
  }

  return urls;
}

export function isTextGenerationContextNode(node: CanvasNode) {
  return TEXT_GENERATION_CONTEXT_NODE_KINDS.has(node.data.kind);
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

  if (node.data.kind === "reader") {
    return `阅读器节点「${title}」`;
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

  return "";
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
