import type { Edge } from "@xyflow/react";

import type { CanvasNode } from "@/components/zenme/canvas/types";

const TEXT_GENERATION_CONTEXT_NODE_KINDS = new Set([
  "agent",
  "book",
  "code",
  "markdown",
  "note",
  "reader",
  "text",
  "managedText",
]);

export function collectTextGenerationContext(input: {
  edges: Edge[];
  maxDepth?: number;
  nodeId: string;
  nodes: CanvasNode[];
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
  const queue = (inboundByTarget.get(input.nodeId) ?? []).map((nodeId) => ({
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

  if (node.data.kind === "textGeneration") {
    const prompt = node.data.textGenerationPrompt?.trim();
    return prompt ? `文本生成节点「${title}」\n${prompt}` : "";
  }

  return "";
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
