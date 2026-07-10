import type { ReadingSection } from "@/lib/reading/types";

const DEFAULT_TITLE = "正文";
const HEADING_RE = /^(第?[0-9一二三四五六七八九十百千零两]+[章回节卷话篇部].{0,36})$/;

export function parseTxtSections(text: string): ReadingSection[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const paragraphs = normalized
    .split(/\n\s*\n|\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  const sections: ReadingSection[] = [];
  let currentTitle = DEFAULT_TITLE;
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const index = sections.length;
    const html = current.map((p) => `<p>${escapeTxtHtml(p)}</p>`).join("");
    sections.push({ index, title: currentTitle, html, text: current.join("\n") });
    current = [];
  };

  for (const para of paragraphs) {
    if (HEADING_RE.test(para)) {
      flush();
      currentTitle = para;
      current.push(para);
    } else {
      current.push(para);
    }
  }
  flush();

  return sections.length
    ? sections
    : [{ index: 0, title: DEFAULT_TITLE, html: "", text: "" }];
}

function escapeTxtHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
