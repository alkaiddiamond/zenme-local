import type {
  ReadingAnnotationColor,
  ReadingNote,
  ReadingSection,
} from "@/lib/reading/types";
import { sanitizeReadingHtml } from "@/lib/reading/html-sanitize";

import {
  ANNOTATION_PALETTE_GAP,
  ANNOTATION_PALETTE_HEIGHT,
  ANNOTATION_PALETTE_MARGIN,
  ANNOTATION_PALETTE_WIDTH,
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  EPUB_PAGE_GAP,
  EPUB_PAGE_HEIGHT,
  HIGHLIGHT_STYLES,
} from "./constants";
import type { TextSelection } from "./types";

export function clampContentScale(value: number) {
  return Math.min(CONTENT_SCALE_MAX, Math.max(CONTENT_SCALE_MIN, value));
}

export function getEpubPageSlotHeight(scale: number) {
  return EPUB_PAGE_HEIGHT * scale + EPUB_PAGE_GAP;
}

export function scrollToEpubSection(
  container: HTMLElement | null,
  sectionIndex: number,
  scale: number,
  behavior: ScrollBehavior,
) {
  container?.scrollTo({
    behavior,
    top: sectionIndex * getEpubPageSlotHeight(scale),
  });
}

export function scrollElementIntoContainer(input: {
  behavior?: ScrollBehavior;
  block?: "center" | "start";
  container: HTMLElement | null;
  target: HTMLElement | null | undefined;
}) {
  const { behavior = "auto", block = "start", container, target } = input;
  if (!container || !target) {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const blockOffset =
    block === "center"
      ? Math.max(0, (container.clientHeight - targetRect.height) / 2)
      : 0;
  const top = container.scrollTop + targetRect.top - containerRect.top - blockOffset;

  container.scrollTo({
    behavior,
    top: Math.max(0, top),
  });
  return true;
}

export function scrollToReadingTarget(input: {
  behavior: ScrollBehavior;
  container?: HTMLElement | null;
  fallbackSection: HTMLElement | null | undefined;
  selector: string;
  workspace: HTMLElement | null;
}) {
  const target = input.workspace?.querySelector(input.selector) as
    | HTMLElement
    | null
    | undefined;
  if (
    scrollElementIntoContainer({
      behavior: input.behavior,
      block: "center",
      container: input.container ?? null,
      target,
    })
  ) {
    return true;
  }

  if (target) {
    target.scrollIntoView({ behavior: input.behavior, block: "center" });
    return true;
  }

  if (
    scrollElementIntoContainer({
      behavior: input.behavior,
      container: input.container ?? null,
      target: input.fallbackSection,
    })
  ) {
    return false;
  }

  input.fallbackSection?.scrollIntoView({
    behavior: input.behavior,
    block: "start",
  });
  return false;
}

export function isChineseReadingText(text: string) {
  const chineseCount = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const letterCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const meaningfulCount = chineseCount + letterCount;

  return (
    chineseCount >= 40 && chineseCount / Math.max(meaningfulCount, 1) >= 0.35
  );
}

export function reorderReadingNoteList(
  notes: ReadingNote[],
  sourceId: string,
  targetId: string,
  placement: "before" | "after",
) {
  if (sourceId === targetId) {
    return notes;
  }

  const moved = notes.find((note) => note.id === sourceId);
  if (!moved || !notes.some((note) => note.id === targetId)) {
    return notes;
  }

  const nextNotes = notes.filter((note) => note.id !== sourceId);
  const targetIndex = nextNotes.findIndex((note) => note.id === targetId);
  if (targetIndex < 0) {
    return notes;
  }

  const insertIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  nextNotes.splice(insertIndex, 0, moved);
  return nextNotes.map((note, index) => ({ ...note, sortOrder: index }));
}

export function normalizeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

export function formatNoteTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function readSelection(
  annotationLayer: HTMLElement | null,
): TextSelection | null {
  const browserSelection = window.getSelection();
  if (!annotationLayer || !browserSelection || browserSelection.isCollapsed) {
    return null;
  }

  const text = browserSelection.toString().trim();
  if (!text) {
    return null;
  }

  const range = browserSelection.getRangeAt(0);
  const sectionElement = closestElement(range.commonAncestorContainer)?.closest(
    "[data-reading-section-index]",
  ) as HTMLElement | null;
  const proseElement = sectionElement?.querySelector(
    ".reading-prose",
  ) as HTMLElement | null;
  if (
    !sectionElement ||
    !proseElement ||
    !proseElement.contains(range.commonAncestorContainer)
  ) {
    return null;
  }

  const preRange = document.createRange();
  preRange.selectNodeContents(proseElement);
  preRange.setEnd(range.startContainer, range.startOffset);
  const offset = preRange.toString().length;
  const length = range.toString().length;
  const sectionRect = sectionElement.getBoundingClientRect();
  const annotationLayerRect = annotationLayer.getBoundingClientRect();
  const selectionRects = Array.from(range.getClientRects()).filter(
    (rect) =>
      rect.width > 1 &&
      rect.height > 1 &&
      rect.right > sectionRect.left &&
      rect.left < sectionRect.right &&
      rect.bottom > sectionRect.top &&
      rect.top < sectionRect.bottom,
  );

  if (selectionRects.length === 0) {
    return null;
  }

  const previewRects = selectionRects.map((rect) => ({
    x: Math.min(
      1,
      Math.max(0, (rect.left - sectionRect.left) / sectionRect.width),
    ),
    y: Math.min(
      1,
      Math.max(0, (rect.top - sectionRect.top) / sectionRect.height),
    ),
    w: Math.min(1, Math.max(0, rect.width / sectionRect.width)),
    h: Math.min(1, Math.max(0, rect.height / sectionRect.height)),
  }));
  const firstRect = selectionRects[0];
  const selectionBounds = selectionRects.reduce(
    (bounds, rect) => ({
      left: Math.min(bounds.left, rect.left),
      top: Math.min(bounds.top, rect.top),
      right: Math.max(bounds.right, rect.right),
      bottom: Math.max(bounds.bottom, rect.bottom),
    }),
    {
      left: firstRect.left,
      top: firstRect.top,
      right: firstRect.right,
      bottom: firstRect.bottom,
    },
  );

  return {
    text,
    sectionIndex: Number(sectionElement.dataset.readingSectionIndex ?? 0),
    offset,
    length,
    rects: previewRects,
    ...getAnnotationPalettePosition({
      containerRect: annotationLayerRect,
      selectionBounds,
    }),
  };
}

export function getAnnotationPalettePosition(input: {
  containerRect: Pick<DOMRect, "height" | "left" | "top" | "width">;
  selectionBounds: Pick<DOMRect, "bottom" | "left" | "right" | "top">;
}) {
  const { containerRect, selectionBounds } = input;
  const selectionCenter =
    selectionBounds.left + (selectionBounds.right - selectionBounds.left) / 2;
  const minX = ANNOTATION_PALETTE_MARGIN;
  const maxX = Math.max(
    ANNOTATION_PALETTE_MARGIN,
    containerRect.width - ANNOTATION_PALETTE_WIDTH - ANNOTATION_PALETTE_MARGIN,
  );
  const x = Math.min(
    Math.max(
      minX,
      selectionCenter - containerRect.left - ANNOTATION_PALETTE_WIDTH / 2,
    ),
    maxX,
  );

  const topY =
    selectionBounds.top -
    containerRect.top -
    ANNOTATION_PALETTE_HEIGHT -
    ANNOTATION_PALETTE_GAP;
  const bottomY =
    selectionBounds.bottom - containerRect.top + ANNOTATION_PALETTE_GAP;
  const maxY = Math.max(
    ANNOTATION_PALETTE_MARGIN,
    containerRect.height -
      ANNOTATION_PALETTE_HEIGHT -
      ANNOTATION_PALETTE_MARGIN,
  );
  const y =
    topY >= ANNOTATION_PALETTE_MARGIN
      ? topY
      : Math.min(Math.max(bottomY, ANNOTATION_PALETTE_MARGIN), maxY);

  return { x, y };
}

function closestElement(node: Node) {
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;
}

export function renderHighlightedSectionHtml(
  section: ReadingSection,
  notes: ReadingNote[],
  focusedNoteId: string | null,
) {
  const html = sanitizeReadingHtml(
    section.html || `<p>${escapeHtml(section.text)}</p>`,
  );
  const targets = notes
    .filter(
      (note) =>
        note.sectionIndex === section.index &&
        note.type !== "region" &&
        typeof note.offset === "number" &&
        typeof note.length === "number" &&
        note.length > 0,
    )
    .sort((a, b) => (b.offset ?? 0) - (a.offset ?? 0));

  if (targets.length === 0 || typeof DOMParser === "undefined") {
    return sanitizeReadingHtml(html);
  }

  const doc = new DOMParser().parseFromString(
    `<div>${html}</div>`,
    "text/html",
  );
  const root = doc.body.firstElementChild;
  if (!root) {
    return sanitizeReadingHtml(html);
  }

  for (const note of targets) {
    wrapTextRange(doc, root, {
      color: note.color,
      focused: focusedNoteId === note.id,
      id: note.id,
      length: note.length ?? 0,
      offset: note.offset ?? 0,
    });
  }

  return sanitizeReadingHtml(root.innerHTML);
}

function wrapTextRange(
  doc: Document,
  root: Element,
  target: {
    color: ReadingAnnotationColor;
    focused: boolean;
    id: string;
    length: number;
    offset: number;
  },
) {
  const textNodes: Text[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  let cursor = 0;
  const end = target.offset + target.length;
  for (const textNode of textNodes) {
    const nodeLength = textNode.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + nodeLength;
    cursor = nodeEnd;

    if (nodeEnd <= target.offset || nodeStart >= end) {
      continue;
    }

    const startInNode = Math.max(0, target.offset - nodeStart);
    const endInNode = Math.min(nodeLength, end - nodeStart);
    const selectedNode = textNode.splitText(startInNode);
    selectedNode.splitText(endInNode - startInNode);

    const span = doc.createElement("span");
    span.className = `zenme-reading-highlight${
      target.focused ? " zenme-note-focus-ring" : ""
    }`;
    span.setAttribute("data-reading-highlight", target.color);
    span.setAttribute("data-reading-highlight-note", target.id);
    span.style.background = HIGHLIGHT_STYLES[target.color];
    span.style.borderRadius = "3px";
    span.style.boxDecorationBreak = "clone";
    span.style.setProperty("-webkit-box-decoration-break", "clone");
    selectedNode.parentNode?.insertBefore(span, selectedNode);
    span.appendChild(selectedNode);
  }
}
