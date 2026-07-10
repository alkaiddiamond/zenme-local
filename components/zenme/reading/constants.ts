import type { ReadingAnnotationColor } from "@/lib/reading/types";

export const TOC_COLLAPSED_WIDTH = 44;
export const TOC_DEFAULT_WIDTH_NODE = 180;
export const TOC_DEFAULT_WIDTH_MODAL = 240;
export const TOC_MAX_WIDTH = 320;
export const TOC_MIN_WIDTH = 120;
export const NOTES_DEFAULT_WIDTH_NODE = 260;
export const NOTES_DEFAULT_WIDTH_MODAL = 320;
export const NOTES_MAX_WIDTH = 700;
export const NOTES_MIN_WIDTH = 220;

export const HIGHLIGHT_STYLES: Record<ReadingAnnotationColor, string> = {
  yellow: "rgba(250, 204, 21, 0.38)",
  red: "rgba(248, 113, 113, 0.32)",
  blue: "rgba(96, 165, 250, 0.32)",
  green: "rgba(74, 222, 128, 0.32)",
  purple: "rgba(168, 85, 247, 0.28)",
};

export const HIGHLIGHT_OPTIONS: Array<{
  color: ReadingAnnotationColor;
  label: string;
}> = [
  { color: "yellow", label: "黄" },
  { color: "blue", label: "蓝" },
  { color: "green", label: "绿" },
  { color: "purple", label: "紫" },
  { color: "red", label: "红" },
];

export const ANNOTATION_PALETTE_HEIGHT = 38;
export const ANNOTATION_PALETTE_WIDTH = 180;
export const ANNOTATION_PALETTE_GAP = 12;
export const ANNOTATION_PALETTE_MARGIN = 12;

export const EPUB_PAGE_WIDTH = 600;
export const EPUB_PAGE_HEIGHT = 900;
export const EPUB_PAGE_GAP = 24;
export const PDF_PAGE_BASE_WIDTH = EPUB_PAGE_WIDTH;
export const EPUB_VIRTUAL_BUFFER = 4;

export const READING_PAGE_FRAME_PADDING = 12;
export const READING_PAGE_FRAME_CLASSNAME =
  "mx-auto rounded-md border border-zinc-200 bg-white p-3 shadow-sm";
export const READING_PAGE_PLACEHOLDER_CLASSNAME =
  "rounded-md border border-zinc-200 bg-white shadow-sm";
export const READING_PAGE_HEADER_CLASSNAME =
  "relative mb-2 border-b border-zinc-100 px-1 pb-2 text-center text-xs text-zinc-400";
export const READING_PAGE_HEADER_WITH_TITLE_CLASSNAME =
  "relative mb-2 flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-1 pb-2 text-xs text-zinc-400";
export const READING_PAGE_FOOTER_CLASSNAME =
  "flex shrink-0 items-center border-t border-zinc-100 px-1 text-zinc-400";

export const CONTENT_SCALE_MIN = 0.75;
export const CONTENT_SCALE_MAX = 1.8;
export const CONTENT_SCALE_STEP = 0.1;
