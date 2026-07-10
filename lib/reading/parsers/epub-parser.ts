import AdmZip from "adm-zip";
import path from "path";

import type { ReadingSection } from "@/lib/reading/types";
import { sanitizeReadingHtml } from "@/lib/reading/html-sanitize";

const EPUB_PAGE_BODY_HEIGHT_TARGET = 700;
const EPUB_PAGE_CONTENT_WIDTH = 520;
const EPUB_BODY_FONT_SIZE = 16;
const EPUB_BODY_LINE_HEIGHT = 32;
const EPUB_PARAGRAPH_GAP = 24;

export function readEpubTitle(bytes: Buffer): string | null {
  try {
    const zip = new AdmZip(bytes);
    const opfInfo = getOpfInfo(zip);
    if (!opfInfo) return null;

    return cleanText(
      opfInfo.opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? "",
    ) || null;
  } catch {
    return null;
  }
}

export function parseEpubSections(
  assetId: string,
  bytes: Buffer,
): ReadingSection[] {
  const zip = new AdmZip(bytes);
  const opfInfo = getOpfInfo(zip);
  if (!opfInfo) return [];

  const manifest = parseManifest(opfInfo.opfXml, opfInfo.opfBase);
  const spine = Array.from(
    opfInfo.opfXml.matchAll(/<itemref[^>]*idref="([^"]+)"/gi),
  )
    .map((match) => match[1])
    .map((idref) => manifest.get(idref))
    .filter((href): href is string => Boolean(href));

  const pages: ReadingSection[] = [];

  spine.forEach((href, sectionIndex) => {
    const entry = zip.getEntry(href);
    const raw = entry?.getData().toString("utf8") ?? "";
    const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw;
    const title = cleanText(
      body.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] ??
        raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
        `章节 ${sectionIndex + 1}`,
    );
    const html = rewriteEpubHtml(assetId, body, href);
    const sectionPages = paginateEpubHtml({
      html,
      pageStartIndex: pages.length,
      sectionIndex,
      title,
    });
    pages.push(...sectionPages);
  });

  return pages.length ? pages : [{ index: 0, title: "正文", html: "", text: "" }];
}

function paginateEpubHtml(input: {
  html: string;
  pageStartIndex: number;
  sectionIndex: number;
  title: string;
}): ReadingSection[] {
  const blocks = splitEpubBlocks(input.html);
  const pages: ReadingSection[] = [];
  let bucket: string[] = [];
  let bucketHeight = 0;
  let sectionPage = 1;

  const flush = () => {
    const html = bucket.join("\n");
    const text = cleanText(html);
    if (!html && !text) return;
    pages.push({
      index: input.pageStartIndex + pages.length,
      title: sectionPage === 1 ? input.title : `${input.title} · ${sectionPage}`,
      html,
      text,
    });
    bucket = [];
    bucketHeight = 0;
    sectionPage += 1;
  };

  for (const block of blocks) {
    const text = cleanText(block);
    if (!text && !/<img|<svg|<table/i.test(block)) {
      continue;
    }

    const blockHeight = estimateEpubBlockHeight(block);
    if (blockHeight > EPUB_PAGE_BODY_HEIGHT_TARGET && text) {
      if (bucket.length > 0) flush();
      for (const chunk of chunkText(text, getEpubChunkSizeForText(text))) {
        bucket.push(`<p>${escapeHtml(chunk)}</p>`);
        flush();
      }
      continue;
    }

    if (
      bucket.length > 0 &&
      bucketHeight + blockHeight > EPUB_PAGE_BODY_HEIGHT_TARGET
    ) {
      flush();
    }
    bucket.push(block);
    bucketHeight += blockHeight;
  }
  flush();

  return pages.length
    ? pages
    : [
        {
          index: input.pageStartIndex,
          title: input.title,
          html: input.html,
          text: cleanText(input.html),
        },
      ];
}

function estimateEpubBlockHeight(block: string) {
  const text = cleanText(block);
  const tag = block.match(/^<([a-z0-9]+)/i)?.[1]?.toLowerCase() ?? "p";

  if (/<(?:img|svg)\b/i.test(block)) return 360;
  if (/<table\b/i.test(block)) {
    return Math.max(180, estimateTextLines(text) * EPUB_BODY_LINE_HEIGHT + 72);
  }
  if (tag === "hr" || tag === "br") return EPUB_BODY_LINE_HEIGHT;
  if (/^h[1-6]$/.test(tag)) {
    return estimateTextLines(text, 1.15) * EPUB_BODY_LINE_HEIGHT + 20;
  }
  if (tag === "pre") {
    return (
      Math.max(
        EPUB_BODY_LINE_HEIGHT,
        text.split(/\n/).length * EPUB_BODY_LINE_HEIGHT,
      ) + 24
    );
  }
  if (tag === "ul" || tag === "ol") {
    return estimateTextLines(text, 0.92) * EPUB_BODY_LINE_HEIGHT + EPUB_PARAGRAPH_GAP;
  }

  return estimateTextLines(text) * EPUB_BODY_LINE_HEIGHT + EPUB_PARAGRAPH_GAP;
}

function estimateTextLines(text: string, widthFactor = 1) {
  const visualUnits = getTextVisualUnits(text);
  const unitsPerLine = (EPUB_PAGE_CONTENT_WIDTH / EPUB_BODY_FONT_SIZE) * widthFactor;
  return Math.max(1, Math.ceil(visualUnits / unitsPerLine));
}

function getTextVisualUnits(text: string) {
  let units = 0;
  for (const char of text) {
    if (/[\u3400-\u9fff]/.test(char)) {
      units += 1;
    } else if (/\s/.test(char)) {
      units += 0.32;
    } else if (/[A-Za-z0-9]/.test(char)) {
      units += 0.58;
    } else {
      units += 0.72;
    }
  }
  return units;
}

function getEpubChunkSizeForText(text: string) {
  const visualUnits = Math.max(getTextVisualUnits(text), 1);
  const averageUnitsPerChar = visualUnits / Math.max(text.length, 1);
  const maxVisualUnits =
    ((EPUB_PAGE_BODY_HEIGHT_TARGET - EPUB_PARAGRAPH_GAP) /
      EPUB_BODY_LINE_HEIGHT) *
    (EPUB_PAGE_CONTENT_WIDTH / EPUB_BODY_FONT_SIZE);

  return Math.max(120, Math.floor((maxVisualUnits / averageUnitsPerChar) * 0.9));
}

function splitEpubBlocks(html: string) {
  const blocks: string[] = [];
  const blockRe =
    /<(?:p|div|section|article|header|footer|blockquote|pre|ul|ol|table|figure|h[1-6])\b[\s\S]*?<\/(?:p|div|section|article|header|footer|blockquote|pre|ul|ol|table|figure|h[1-6])>|<(?:img|hr|br)\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRe.exec(html)) !== null) {
    blocks.push(match[0]);
  }

  if (blocks.length > 0) return blocks;

  const text = cleanText(html);
  return text
    ? text
        .split(/(?<=。|！|？|\.)\s+/)
        .map((item) => `<p>${escapeHtml(item)}</p>`)
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

function getOpfInfo(zip: AdmZip) {
  const container = zip.getEntry("META-INF/container.xml");
  if (!container) return null;
  const containerXml = container.getData().toString("utf8");
  const opfPath = containerXml.match(/full-path="([^"]+\.opf)"/i)?.[1];
  if (!opfPath) return null;
  const opf = zip.getEntry(opfPath);
  if (!opf) return null;
  return {
    opfXml: opf.getData().toString("utf8"),
    opfBase: path.posix.dirname(opfPath),
  };
}

function parseManifest(opfXml: string, opfBase: string) {
  const manifest = new Map<string, string>();
  for (const match of opfXml.matchAll(/<item\b([^>]*?)\/?>/gi)) {
    const attrs = match[1];
    const id = attrs.match(/\bid="([^"]+)"/i)?.[1];
    const href = attrs.match(/\bhref="([^"]+)"/i)?.[1];
    const mediaType = attrs.match(/\bmedia-type="([^"]+)"/i)?.[1] ?? "";
    if (id && href && /xhtml|html/i.test(mediaType)) {
      manifest.set(id, path.posix.normalize(`${opfBase}/${decodeURIComponent(href)}`));
    }
  }
  return manifest;
}

function rewriteEpubHtml(assetId: string, html: string, href: string) {
  const base = path.posix.dirname(href);
  const rewritten = html.replace(
    /\s((?:xlink:)?(?:src|href))=["']([^"']+)["']/gi,
    (match, attr, value) => {
      if (/^(https?:|data:|#|mailto:)/i.test(value)) return match;
      const resolved = path.posix.normalize(`${base}/${decodeURIComponent(value)}`);
      return ` ${attr}="/api/reading/assets/${assetId}/epub-asset?path=${encodeURIComponent(resolved)}"`;
    },
  );

  return sanitizeReadingHtml(rewritten);
}

function cleanText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
