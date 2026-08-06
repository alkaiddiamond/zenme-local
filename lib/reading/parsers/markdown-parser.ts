import katex from "katex";

import type { ReadingSection } from "@/lib/reading/types";
import {
  escapeReadingHtml,
  paginateFixedReadingHtml,
} from "./fixed-page-paginator";

const DEFAULT_TITLE = "正文";

type MarkdownGroup = {
  blocks: string[];
  title: string;
};

export function parseMarkdownSections(markdown: string): ReadingSection[] {
  const groups = groupMarkdownBlocks(markdown.replace(/\r\n?/g, "\n"));
  const sections: ReadingSection[] = [];

  for (const group of groups) {
    const html = group.blocks.join("\n");
    sections.push(
      ...paginateFixedReadingHtml({
        html,
        pageStartIndex: sections.length,
        title: group.title,
      }),
    );
  }

  return sections.length
    ? sections
    : [{ index: 0, title: DEFAULT_TITLE, html: "", text: "" }];
}

function groupMarkdownBlocks(markdown: string): MarkdownGroup[] {
  const lines = markdown.split("\n");
  const groups: MarkdownGroup[] = [];
  let title = DEFAULT_TITLE;
  let blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(
      `<${tag}>${list.items
        .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
        .join("")}</${tag}>`,
    );
    list = null;
  };
  const flushGroup = () => {
    flushParagraph();
    flushList();
    if (!blocks.length) return;
    groups.push({ blocks, title });
    blocks = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      blocks.push(`<pre><code>${escapeReadingHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const math = readMathBlock(lines, index);
    if (math) {
      flushParagraph();
      flushList();
      blocks.push(renderMath(math.content, true));
      index = math.endIndex;
      continue;
    }

    const table = readTable(lines, index);
    if (table) {
      flushParagraph();
      flushList();
      blocks.push(table.html);
      index = table.endIndex;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const headingText = stripInlineMarkdown(heading[2]);
      if (heading[1].length <= 2) {
        flushGroup();
        title = headingText || DEFAULT_TITLE;
      }
      blocks.push(
        `<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`,
      );
      continue;
    }

    const listItem = /^(\d+\.|[-*+])\s+(.+)$/.exec(trimmed);
    if (listItem) {
      flushParagraph();
      const ordered = /\d+\./.test(listItem[1]);
      if (list && list.ordered !== ordered) flushList();
      list ??= { items: [], ordered };
      list.items.push(listItem[2]);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push(
        `<blockquote>${renderInlineMarkdown(trimmed.replace(/^>\s?/, ""))}</blockquote>`,
      );
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      blocks.push("<hr>");
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flushGroup();
  return groups;
}

function renderInlineMarkdown(value: string) {
  const tokens: string[] = [];
  const protect = (html: string) => {
    const index = tokens.push(html) - 1;
    return `\u0000${index}\u0000`;
  };
  let escaped = escapeReadingHtml(value);

  escaped = escaped.replace(/`([^`]+)`/g, (_, code: string) =>
    protect(`<code>${code}</code>`),
  );
  escaped = escaped.replace(/\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g, (_, bracketed, dollar) =>
    protect(renderMath(bracketed ?? dollar, false)),
  );
  escaped = escaped.replace(/\[([^\]]+)]\(([^)]+)\)/g, (_, label: string, href: string) => {
    const safeHref = normalizeLinkHref(decodeHtmlAttribute(href));
    return safeHref
      ? protect(`<a href="${escapeReadingHtml(safeHref)}">${label}</a>`)
      : label;
  });
  escaped = escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return escaped.replace(/\u0000(\d+)\u0000/g, (_, index: string) => tokens[Number(index)] ?? "");
}

function renderMath(content: string, displayMode: boolean) {
  const html = katex.renderToString(content.trim(), {
    displayMode,
    strict: "ignore",
    throwOnError: false,
    trust: false,
  });
  return displayMode ? `<p class="reading-math-block">${html}</p>` : html;
}

function readMathBlock(lines: string[], startIndex: number) {
  const trimmed = lines[startIndex].trim();
  const delimiters = trimmed.startsWith("\\[")
    ? { close: "\\]", open: "\\[" }
    : trimmed.startsWith("$$")
      ? { close: "$$", open: "$$" }
      : null;
  if (!delimiters) return null;

  const first = trimmed.slice(delimiters.open.length);
  const inlineClose = first.indexOf(delimiters.close);
  if (inlineClose >= 0) {
    return { content: first.slice(0, inlineClose), endIndex: startIndex };
  }
  const content = first ? [first] : [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const close = lines[index].indexOf(delimiters.close);
    if (close >= 0) {
      content.push(lines[index].slice(0, close));
      return { content: content.join("\n"), endIndex: index };
    }
    content.push(lines[index]);
  }
  return null;
}

function readTable(lines: string[], startIndex: number) {
  if (!lines[startIndex].includes("|") || !isTableSeparator(lines[startIndex + 1] ?? "")) {
    return null;
  }
  const headers = parseTableRow(lines[startIndex]);
  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(parseTableRow(lines[index]));
    index += 1;
  }
  const head = `<thead><tr>${headers.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${rows.map((row) => `<tr>${headers.map((_, cellIndex) => `<td>${renderInlineMarkdown(row[cellIndex] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return { endIndex: index - 1, html: `<table>${head}${body}</table>` };
}

function parseTableRow(line: string) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string) {
  const cells = parseTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function normalizeLinkHref(value: string) {
  const trimmed = value.trim();
  return /^(https?:|mailto:|#)/i.test(trimmed) ? trimmed : "";
}

function decodeHtmlAttribute(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .trim();
}
