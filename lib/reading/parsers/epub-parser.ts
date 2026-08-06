import AdmZip from "adm-zip";
import path from "path";

import type { ReadingSection } from "@/lib/reading/types";
import { sanitizeReadingHtml } from "@/lib/reading/html-sanitize";
import { paginateFixedReadingHtml } from "./fixed-page-paginator";

export function readEpubTitle(bytes: Buffer): string | null {
  try {
    const zip = new AdmZip(bytes);
    const opfInfo = getOpfInfo(zip);
    if (!opfInfo) return null;

    return (
      cleanText(
        opfInfo.opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ??
          "",
      ) || null
    );
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
    const sectionPages = paginateFixedReadingHtml({
      html,
      pageStartIndex: pages.length,
      title,
    });
    pages.push(...sectionPages);
  });

  return pages.length
    ? pages
    : [{ index: 0, title: "正文", html: "", text: "" }];
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
      manifest.set(
        id,
        path.posix.normalize(`${opfBase}/${decodeURIComponent(href)}`),
      );
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
      const resolved = path.posix.normalize(
        `${base}/${decodeURIComponent(value)}`,
      );
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
