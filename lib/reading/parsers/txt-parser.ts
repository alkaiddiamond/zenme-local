import type { ReadingSection } from "@/lib/reading/types";
import {
  escapeReadingHtml,
  FIXED_READING_PAGINATION_VERSION,
  fitsFixedReadingPage,
  paginateFixedReadingHtml,
} from "./fixed-page-paginator";

const DEFAULT_TITLE = "正文";
const HEADING_RE =
  /^(第?[0-9一二三四五六七八九十百千零两]+[章回节卷话篇部].{0,36})$/;

export function decodeTxtBytes(bytes: Uint8Array) {
  if (hasPrefix(bytes, [0xff, 0xfe])) {
    return new TextDecoder("utf-16le").decode(bytes);
  }
  if (hasPrefix(bytes, [0xfe, 0xff])) {
    return new TextDecoder("utf-16be").decode(bytes);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gb18030").decode(bytes);
  }
}

export function parseTxtSections(text: string): ReadingSection[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sections: ReadingSection[] = [];
  let currentTitle = DEFAULT_TITLE;
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const html = current.map((p) => `<p>${escapeReadingHtml(p)}</p>`).join("");
    sections.push(
      ...paginateFixedReadingHtml({
        html,
        pageStartIndex: sections.length,
        title: currentTitle,
      }).map((page) => ({
        ...page,
        text: txtHtmlToText(page.html),
      })),
    );
    current = [];
  };

  for (const line of normalized.split("\n")) {
    const para = line.trim();
    if (!para) continue;
    if (HEADING_RE.test(para)) {
      flush();
      currentTitle = para;
    }
    current.push(para);
  }
  flush();

  return sections.length
    ? sections
    : [{
        index: 0,
        title: DEFAULT_TITLE,
        html: "",
        text: "",
        paginationVersion: FIXED_READING_PAGINATION_VERSION,
      }];
}

export function shouldRebuildTxtSections(sections: ReadingSection[]) {
  let characters = 0;
  let replacements = 0;
  for (const section of sections) {
    for (const character of section.text) {
      characters += 1;
      if (character === "\uFFFD") replacements += 1;
      if (characters >= 100_000) break;
    }
    if (characters >= 100_000) break;
  }
  const hasBrokenEncoding =
    replacements >= 3 && replacements / Math.max(1, characters) >= 0.005;
  return (
    hasBrokenEncoding ||
    sections.some(
      (section) =>
        section.paginationVersion !== FIXED_READING_PAGINATION_VERSION,
    ) ||
    sections.some(
      (section) =>
        (!section.html && Boolean(section.text)) ||
        !fitsFixedReadingPage(section.html),
    )
  );
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function txtHtmlToText(html: string) {
  return html
    .replace(/<\/p>\s*<p>/gi, "\n")
    .replace(/^<p>|<\/p>$/gi, "")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
