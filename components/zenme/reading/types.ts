import type {
  ReadingAsset,
  ReadingNote,
  ReadingProgress,
  ReadingSection,
} from "@/lib/reading/types";

export type ReadingPayload = {
  asset: ReadingAsset;
  sections: ReadingSection[];
  notes: ReadingNote[];
  progress: ReadingProgress | null;
};

export type TextSelection = {
  text: string;
  sectionIndex: number;
  offset: number;
  length: number;
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  ranges: Array<{
    sectionIndex: number;
    offset: number;
    length: number;
    rects: Array<{ x: number; y: number; w: number; h: number }>;
  }>;
  x: number;
  y: number;
};

export type PdfAnnotationDraft = {
  imageDataUrl?: string;
  kind: "region" | "text";
  ocrFailed?: boolean;
  pageIndex: number;
  rect: { x: number; y: number; w: number; h: number };
  rects?: Array<{ x: number; y: number; w: number; h: number }>;
  selectedText?: string;
  x: number;
  y: number;
};

export type NoteDropIndicator = {
  targetId: string;
  placement: "before" | "after";
} | null;

export type PdfDocumentProxyLike = {
  destroy?: () => Promise<void> | void;
  getDestination: (id: string) => Promise<unknown[] | null>;
  getOutline: () => Promise<PdfOutlineItem[] | null>;
  getPage: (pageNumber: number) => Promise<PdfPageProxyLike>;
  getPageIndex: (pageReference: unknown) => Promise<number>;
  numPages: number;
};

export type PdfOutlineItem = {
  dest: string | unknown[] | null;
  items: PdfOutlineItem[];
  title: string;
};

export type PdfOutlineSection = {
  index: number;
  title: string;
};

export type PdfPageProxyLike = {
  getTextContent: () => Promise<unknown>;
  getViewport: (input: { scale: number }) => { height: number; width: number };
  render: (input: {
    canvas?: HTMLCanvasElement;
    canvasContext: CanvasRenderingContext2D;
    viewport: { height: number; width: number };
  }) => { cancel: () => void; promise: Promise<void> };
};
