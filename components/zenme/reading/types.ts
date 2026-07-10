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
  getPage: (pageNumber: number) => Promise<PdfPageProxyLike>;
  numPages: number;
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
