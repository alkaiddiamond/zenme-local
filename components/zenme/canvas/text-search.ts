import type { CanvasNode } from "@/components/zenme/canvas/types";

export type CanvasTextSearchResult = {
  id: string;
  kindLabel: string;
  snippet: string;
  title: string;
};

const NODE_KIND_LABELS: Record<CanvasNode["data"]["kind"], string> = {
  agent: "AI 回复",
  book: "书籍",
  code: "代码",
  file: "文件",
  group: "分组",
  image: "图片",
  imageGeneration: "图片生成",
  lyrics: "歌词",
  managedText: "文本",
  markdown: "Markdown",
  music: "音乐",
  musicPlayer: "音乐播放器",
  note: "笔记",
  reader: "阅读器",
  task: "任务",
  text: "文本",
  textGeneration: "文本生成",
  video: "视频",
  videoGeneration: "视频生成",
};

export function searchCanvasNodes(
  nodes: CanvasNode[],
  query: string,
): CanvasTextSearchResult[] {
  const terms = normalizeText(query).toLocaleLowerCase().split(" ").filter(Boolean);
  if (terms.length === 0) return [];

  return nodes.flatMap((node) => {
    const title = node.data.name?.trim() || node.data.title?.trim() || "未命名节点";
    const content = getCanvasNodeSearchText(node);
    const normalizedContent = content.toLocaleLowerCase();
    if (!terms.every((term) => normalizedContent.includes(term))) return [];

    return [{
      id: node.id,
      kindLabel: NODE_KIND_LABELS[node.data.kind],
      snippet: createSearchSnippet(content, terms[0]),
      title,
    }];
  });
}

export function getCanvasNodeSearchText(node: CanvasNode) {
  const data = node.data;
  const values = [
    data.title,
    data.name,
    ...(data.tags ?? []),
    data.sourceBookTitle,
    data.selectedText,
    data.comment,
    data.chapterTitle,
    data.fileName,
    data.plainText,
    data.codeContent,
    stripHtmlToText(data.richTextHtml),
    data.aiPrompt,
    data.aiResponse,
    data.aiError,
    data.textGenerationPrompt,
    data.imagePrompt,
    data.imageError,
    data.videoPrompt,
    data.videoError,
    ...(data.musicLyrics ?? []).map((line) => line.text),
    ...(data.lyricsWarnings ?? []),
    ...(data.musicSources ?? []).map((source) => source.title),
    ...(data.taskChildren ?? []).map((child) => child.name),
    ...(data.imageReferences ?? []).map((reference) => reference.title),
    ...(data.imageTextReferences ?? []).map((reference) => reference.title),
  ];

  return normalizeText(values.filter(Boolean).join("\n"));
}

function createSearchSnippet(content: string, normalizedTerm: string) {
  if (!content) return "";
  const lowerContent = content.toLocaleLowerCase();
  const matchIndex = lowerContent.indexOf(normalizedTerm);
  const start = Math.max(0, matchIndex - 36);
  const end = Math.min(content.length, Math.max(matchIndex, 0) + normalizedTerm.length + 72);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripHtmlToText(html?: string) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
