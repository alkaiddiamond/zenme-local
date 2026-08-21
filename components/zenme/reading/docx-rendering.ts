import type { MutableRefObject } from "react";
import type { Options } from "docx-preview";
import type { ReadingSection } from "@/lib/reading/types";

export const DOCX_PAGE_SELECTOR = "section.zenme-docx";

export const DOCX_RENDER_OPTIONS = {
  breakPages: true,
  className: "zenme-docx",
  debug: false,
  experimental: true,
  hideWrapperOnPrint: false,
  ignoreFonts: false,
  ignoreHeight: false,
  ignoreLastRenderedPageBreak: false,
  ignoreWidth: false,
  inWrapper: true,
  renderAltChunks: true,
  renderChanges: false,
  renderComments: false,
  renderEndnotes: true,
  renderFooters: true,
  renderFootnotes: true,
  renderHeaders: true,
  trimXmlDeclaration: true,
  useBase64URL: true,
} satisfies Partial<Options>;

export function indexRenderedDocxPages(
  container: Pick<HTMLElement, "querySelectorAll">,
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>,
) {
  const pages = Array.from(
    container.querySelectorAll<HTMLElement>(DOCX_PAGE_SELECTOR),
  );
  const nextRefs: Record<number, HTMLElement | null> = {};

  pages.forEach((page, index) => {
    page.dataset.readingSectionIndex = String(index);
    page.classList.add("reading-prose", "zenme-docx-page");
    nextRefs[index] = page;
  });
  pageRefs.current = nextRefs;
  return pages.length;
}

export async function paginateRenderedDocx(input: {
  container: HTMLElement;
  pageRefs: MutableRefObject<Record<number, HTMLElement | null>>;
  sections: ReadingSection[];
}) {
  await waitForDocxResources(input.container);
  const originalPages = Array.from(
    input.container.querySelectorAll<HTMLElement>(DOCX_PAGE_SELECTOR),
  );

  for (const page of originalPages) {
    paginateOverflowingPage(page);
  }

  const pageCount = indexRenderedDocxPages(input.container, input.pageRefs);
  const pages = Array.from(
    input.container.querySelectorAll<HTMLElement>(DOCX_PAGE_SELECTOR),
  );
  return {
    outline: buildDocxOutline(pages, input.sections),
    pageCount,
  };
}

export function buildDocxOutline(
  pages: ArrayLike<Pick<HTMLElement, "textContent">>,
  sections: ReadingSection[],
) {
  const pageTexts = Array.from(pages, (page) => normalizeOutlineText(page.textContent));
  const titles = Array.from(
    new Set(
      sections
        .map((section) => section.title.replace(/\s·\s\d+$/, "").trim())
        .filter((title) => title && title !== "正文"),
    ),
  );
  const outline: Array<{ index: number; title: string }> = [];
  let searchFrom = 0;

  for (const title of titles) {
    const normalizedTitle = normalizeOutlineText(title);
    const pageIndex = pageTexts.findIndex(
      (text, index) => index >= searchFrom && text.includes(normalizedTitle),
    );
    if (pageIndex < 0) continue;
    outline.push({ index: pageIndex, title });
    searchFrom = pageIndex;
  }
  return outline;
}

function paginateOverflowingPage(sourcePage: HTMLElement) {
  const pageHeight = Number.parseFloat(getComputedStyle(sourcePage).minHeight);
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) return;
  sourcePage.style.height = `${pageHeight}px`;
  sourcePage.style.minHeight = `${pageHeight}px`;
  if (pageFits(sourcePage)) return;

  const sourceArticles = Array.from(
    sourcePage.querySelectorAll<HTMLElement>(":scope > article"),
  );
  const articleTemplate = sourceArticles[0];
  const parent = sourcePage.parentElement;
  if (!articleTemplate || !parent) return;

  const blocks = sourceArticles.flatMap((article) =>
    Array.from(article.childNodes),
  );
  const directChildren = Array.from(sourcePage.children) as HTMLElement[];
  const headers = directChildren.filter((child) => child.tagName === "HEADER");
  const footers = directChildren.filter((child) => child.tagName === "FOOTER");
  const extras = directChildren.filter(
    (child) => !["ARTICLE", "HEADER", "FOOTER"].includes(child.tagName),
  );
  const createdPages: HTMLElement[] = [];

  const createPage = () => {
    const page = sourcePage.cloneNode(false) as HTMLElement;
    page.style.height = `${pageHeight}px`;
    page.style.minHeight = `${pageHeight}px`;
    for (const header of headers) page.append(header.cloneNode(true));
    const article = articleTemplate.cloneNode(false) as HTMLElement;
    page.append(article);
    for (const footer of footers) page.append(footer.cloneNode(true));
    parent.insertBefore(page, sourcePage);
    createdPages.push(page);
    return { article, page };
  };

  let current = createPage();
  for (const block of blocks) {
    let pending: Node | null = block;
    while (pending) {
      current.article.append(pending);
      if (pageFits(current.page)) break;
      current.article.removeChild(pending);

      if (current.article.childNodes.length > 0) {
        current = createPage();
        continue;
      }

      const split = splitBlockToFit(pending, current.article, current.page);
      if (!split) {
        current.article.append(pending);
        break;
      }
      current.article.append(split.prefix);
      pending = split.suffix;
      if (pending) current = createPage();
    }
  }

  const lastPage = createdPages[createdPages.length - 1];
  const lastFooter = lastPage?.querySelector(":scope > footer");
  for (const extra of extras) {
    lastPage?.insertBefore(extra.cloneNode(true), lastFooter ?? null);
  }
  sourcePage.remove();
}

function splitBlockToFit(block: Node, article: HTMLElement, page: HTMLElement) {
  if (!(block instanceof HTMLElement)) return null;
  const textNodes = collectTextNodes(block);
  const totalLength = textNodes.reduce((total, node) => total + node.data.length, 0);
  if (totalLength < 2) return null;

  let low = 1;
  let high = totalLength - 1;
  let best = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = cloneTextSlice(block, textNodes, 0, middle);
    article.append(candidate);
    const fits = pageFits(page);
    candidate.remove();
    if (fits) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (best === 0) return null;

  const text = block.textContent ?? "";
  const wordBreak = text.lastIndexOf(" ", best);
  if (wordBreak > Math.floor(best * 0.7)) best = wordBreak + 1;
  const prefix = cloneTextSlice(block, textNodes, 0, best);
  const suffix = cloneTextSlice(block, textNodes, best, totalLength);
  stripDuplicateIds(prefix);
  stripDuplicateIds(suffix);
  return { prefix, suffix: suffix.textContent || suffix.children.length ? suffix : null };
}

function cloneTextSlice(
  block: HTMLElement,
  textNodes: Text[],
  start: number,
  end: number,
) {
  const range = document.createRange();
  setRangeBoundary(range, block, textNodes, start, true);
  setRangeBoundary(range, block, textNodes, end, false);
  const clone = block.cloneNode(false) as HTMLElement;
  clone.append(range.cloneContents());
  return clone;
}

function setRangeBoundary(
  range: Range,
  block: HTMLElement,
  textNodes: Text[],
  offset: number,
  isStart: boolean,
) {
  let remaining = offset;
  for (const node of textNodes) {
    if (remaining <= node.data.length) {
      if (isStart) range.setStart(node, remaining);
      else range.setEnd(node, remaining);
      return;
    }
    remaining -= node.data.length;
  }
  if (isStart) range.setStart(block, block.childNodes.length);
  else range.setEnd(block, block.childNodes.length);
}

function collectTextNodes(element: HTMLElement) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function stripDuplicateIds(element: HTMLElement) {
  element.removeAttribute("id");
  for (const child of element.querySelectorAll("[id]")) child.removeAttribute("id");
}

function pageFits(page: HTMLElement) {
  if (page.scrollHeight > page.clientHeight + 1) return false;
  const pageRect = page.getBoundingClientRect();
  const pageStyle = getComputedStyle(page);
  const paddingBottom = Number.parseFloat(pageStyle.paddingBottom) || 0;
  const footer = page.querySelector<HTMLElement>(":scope > footer");
  const contentBottom = Math.min(
    pageRect.bottom - paddingBottom,
    footer?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
  );
  return Array.from(
    page.querySelectorAll<HTMLElement>(":scope > article"),
  ).every(
    (article) =>
      article.scrollHeight <= article.clientHeight + 1 &&
      article.getBoundingClientRect().bottom <= contentBottom + 1,
  );
}

async function waitForDocxResources(container: HTMLElement) {
  await document.fonts?.ready;
  await Promise.all(
    Array.from(container.querySelectorAll("img"), (image) =>
      image.decode?.().catch(() => undefined),
    ),
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function normalizeOutlineText(value: string | null) {
  return (value ?? "").replace(/\s+/g, "").trim();
}
