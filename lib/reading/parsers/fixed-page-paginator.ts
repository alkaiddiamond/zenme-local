import type { ReadingSection } from "@/lib/reading/types";

const PAGE_BODY_HEIGHT_TARGET = 700;
const PAGE_CONTENT_WIDTH = 520;
const BODY_FONT_SIZE = 16;
const BODY_LINE_HEIGHT = 32;
const PARAGRAPH_GAP = 24;

export const FIXED_READING_PAGINATION_VERSION = 2;

export function paginateFixedReadingHtml(input: {
  html: string;
  pageStartIndex: number;
  title: string;
}): ReadingSection[] {
  const blocks = splitReadingBlocks(input.html);
  const pages: ReadingSection[] = [];
  let bucket: string[] = [];
  let bucketHeight = 0;
  let sectionPage = 1;

  const flush = () => {
    const html = bucket.join("\n");
    const text = cleanReadingText(html);
    if (!html && !text) return;
    pages.push({
      index: input.pageStartIndex + pages.length,
      title:
        sectionPage === 1 ? input.title : `${input.title} · ${sectionPage}`,
      html,
      text,
      paginationVersion: FIXED_READING_PAGINATION_VERSION,
    });
    bucket = [];
    bucketHeight = 0;
    sectionPage += 1;
  };

  for (const block of blocks) {
    let pendingBlock: string | null = block;

    while (pendingBlock) {
      const text = cleanReadingText(pendingBlock);
      if (!text && !/<img|<svg|<table/i.test(pendingBlock)) break;

      const blockHeight = estimateReadingBlockHeight(pendingBlock);
      const availableHeight = PAGE_BODY_HEIGHT_TARGET - bucketHeight;
      if (blockHeight <= availableHeight) {
        bucket.push(pendingBlock);
        bucketHeight += blockHeight;
        break;
      }

      const split = splitPlainParagraphToFit(pendingBlock, availableHeight);
      if (split) {
        bucket.push(split.currentPageHtml);
        bucketHeight += estimateReadingBlockHeight(split.currentPageHtml);
        flush();
        pendingBlock = split.nextPageHtml;
        continue;
      }

      if (bucket.length > 0) {
        flush();
        continue;
      }

      if (blockHeight > PAGE_BODY_HEIGHT_TARGET && text) {
        for (const chunk of chunkText(text, getChunkSizeForText(text))) {
          bucket.push(`<p>${escapeReadingHtml(chunk)}</p>`);
          flush();
        }
        break;
      }

      bucket.push(pendingBlock);
      bucketHeight += blockHeight;
      break;
    }
  }
  flush();

  return pages.length
    ? pages
    : [
        {
          index: input.pageStartIndex,
          title: input.title,
          html: input.html,
          text: cleanReadingText(input.html),
          paginationVersion: FIXED_READING_PAGINATION_VERSION,
        },
      ];
}

export function fitsFixedReadingPage(html: string) {
  return getFixedReadingPageEstimatedHeight(html) <= PAGE_BODY_HEIGHT_TARGET;
}

export function getFixedReadingPageEstimatedHeight(html: string) {
  return splitReadingBlocks(html).reduce(
    (height, block) => height + estimateReadingBlockHeight(block),
    0,
  );
}

export function getFixedReadingPageFillRatio(html: string) {
  return getFixedReadingPageEstimatedHeight(html) / PAGE_BODY_HEIGHT_TARGET;
}

function estimateReadingBlockHeight(block: string) {
  const text = cleanReadingText(block);
  const tag = block.match(/^<([a-z0-9]+)/i)?.[1]?.toLowerCase() ?? "p";

  if (/<(?:img|svg)\b/i.test(block)) return 360;
  if (/<table\b/i.test(block)) {
    return Math.max(180, estimateTextLines(text) * BODY_LINE_HEIGHT + 72);
  }
  if (tag === "hr" || tag === "br") return BODY_LINE_HEIGHT;
  if (/^h[1-6]$/.test(tag)) {
    return estimateTextLines(text, 1.15) * BODY_LINE_HEIGHT + 20;
  }
  if (tag === "pre") {
    return (
      Math.max(BODY_LINE_HEIGHT, text.split(/\n/).length * BODY_LINE_HEIGHT) +
      24
    );
  }
  if (tag === "ul" || tag === "ol") {
    return estimateTextLines(text, 0.92) * BODY_LINE_HEIGHT + PARAGRAPH_GAP;
  }

  return estimateTextLines(text) * BODY_LINE_HEIGHT + PARAGRAPH_GAP;
}

function estimateTextLines(text: string, widthFactor = 1) {
  const visualUnits = getTextVisualUnits(text);
  const unitsPerLine = (PAGE_CONTENT_WIDTH / BODY_FONT_SIZE) * widthFactor;
  return Math.max(1, Math.ceil(visualUnits / unitsPerLine));
}

function getTextVisualUnits(text: string) {
  let units = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff]/.test(char)) units += 1;
    else if (/\s/.test(char)) units += 0.32;
    else if (/[A-Za-z0-9]/.test(char)) units += 0.58;
    else units += 0.72;
  }
  return units;
}

function getChunkSizeForText(text: string) {
  const visualUnits = Math.max(getTextVisualUnits(text), 1);
  const averageUnitsPerChar = visualUnits / Math.max(text.length, 1);
  const maxVisualUnits =
    ((PAGE_BODY_HEIGHT_TARGET - PARAGRAPH_GAP) / BODY_LINE_HEIGHT) *
    (PAGE_CONTENT_WIDTH / BODY_FONT_SIZE);

  return Math.max(
    120,
    Math.floor((maxVisualUnits / averageUnitsPerChar) * 0.9),
  );
}

function splitPlainParagraphToFit(block: string, availableHeight: number) {
  const match = /^<p(\s[^>]*)?>([\s\S]*)<\/p>$/i.exec(block.trim());
  if (!match || /<[^>]+>/.test(match[2])) return null;

  const text = cleanReadingText(match[2]);
  const availableLineCount = Math.floor(
    (availableHeight - PARAGRAPH_GAP) / BODY_LINE_HEIGHT,
  );
  if (availableLineCount < 2) return null;

  const unitsPerLine = PAGE_CONTENT_WIDTH / BODY_FONT_SIZE;
  const cut = findVisualTextCut(text, availableLineCount * unitsPerLine);
  if (cut <= 0 || cut >= text.length) return null;

  const attributes = match[1] ?? "";
  return {
    currentPageHtml: `<p${attributes}>${escapeReadingHtml(text.slice(0, cut).trim())}</p>`,
    nextPageHtml: `<p${withContinuationClass(attributes)}>${escapeReadingHtml(text.slice(cut).trim())}</p>`,
  };
}

function findVisualTextCut(text: string, maxVisualUnits: number) {
  let visualUnits = 0;
  let hardCut = 0;
  let preferredCut = 0;

  for (let index = 0; index < text.length; index += 1) {
    const nextUnits = visualUnits + getTextVisualUnits(text[index]);
    if (nextUnits > maxVisualUnits) break;
    visualUnits = nextUnits;
    hardCut = index + 1;
    if (/[。！？；.!?;\s]/.test(text[index])) {
      preferredCut = index + 1;
    }
  }

  return preferredCut >= hardCut * 0.85 ? preferredCut : hardCut;
}

function withContinuationClass(attributes: string) {
  const classMatch = /\bclass=(['"])(.*?)\1/i.exec(attributes);
  if (!classMatch) {
    return `${attributes} class="reading-paragraph-continuation"`;
  }
  return attributes.replace(
    classMatch[0],
    `class=${classMatch[1]}${classMatch[2]} reading-paragraph-continuation${classMatch[1]}`,
  );
}

function splitReadingBlocks(html: string) {
  const blocks: string[] = [];
  const blockRe =
    /<(?:p|div|section|article|header|footer|blockquote|pre|ul|ol|table|figure|h[1-6])\b[\s\S]*?<\/(?:p|div|section|article|header|footer|blockquote|pre|ul|ol|table|figure|h[1-6])>|<(?:img|hr|br)\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(html)) !== null) blocks.push(match[0]);
  if (blocks.length > 0) return blocks;

  const text = cleanReadingText(html);
  return text
    ? text
        .split(/(?<=。|！|？|\.)\s+/)
        .map((item) => `<p>${escapeReadingHtml(item)}</p>`)
    : [];
}

function chunkText(text: string, size: number) {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > size) {
    let cut = Math.max(
      remaining.lastIndexOf("。", size),
      remaining.lastIndexOf("！", size),
      remaining.lastIndexOf("？", size),
      remaining.lastIndexOf(".", size),
      remaining.lastIndexOf(" ", size),
    );
    if (cut < Math.floor(size * 0.5)) cut = size;
    chunks.push(remaining.slice(0, cut + 1).trim());
    remaining = remaining.slice(cut + 1).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function cleanReadingText(value: string) {
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

export function escapeReadingHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
