import mammoth from "mammoth";

import { sanitizeReadingHtml } from "@/lib/reading/html-sanitize";
import type { ReadingSection } from "@/lib/reading/types";

import { paginateFixedReadingHtml } from "./fixed-page-paginator";

const DEFAULT_TITLE = "正文";

type DocxGroup = {
  blocks: string[];
  title: string;
};

export async function parseDocxSections(bytes: Buffer): Promise<ReadingSection[]> {
  const result = await mammoth.convertToHtml({ buffer: bytes });
  const html = sanitizeReadingHtml(result.value);
  const groups = groupDocxBlocks(html);
  const sections: ReadingSection[] = [];

  for (const group of groups) {
    sections.push(
      ...paginateFixedReadingHtml({
        html: group.blocks.join("\n"),
        pageStartIndex: sections.length,
        title: group.title,
      }),
    );
  }

  return sections.length
    ? sections
    : [{ index: 0, title: DEFAULT_TITLE, html: "", text: "" }];
}

function groupDocxBlocks(html: string): DocxGroup[] {
  const blocks = html.match(
    /<(?:p|div|section|article|blockquote|pre|ul|ol|table|figure|h[1-6])\b[\s\S]*?<\/(?:p|div|section|article|blockquote|pre|ul|ol|table|figure|h[1-6])>|<img\b[^>]*\/?>/gi,
  ) ?? [];
  const groups: DocxGroup[] = [];
  let title = DEFAULT_TITLE;
  let current: string[] = [];

  const flush = () => {
    if (!current.length) return;
    groups.push({ blocks: current, title });
    current = [];
  };

  for (const block of blocks) {
    const heading = /^<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>$/i.exec(
      block.trim(),
    );
    if (heading) {
      flush();
      title = cleanDocxText(heading[2]) || DEFAULT_TITLE;
    }
    current.push(block);
  }
  flush();

  if (!groups.length && html.trim()) {
    return [{ blocks: [html], title: DEFAULT_TITLE }];
  }
  return groups;
}

function cleanDocxText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
