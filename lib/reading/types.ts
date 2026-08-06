export type ReadingFormat = "epub" | "markdown" | "pdf" | "txt";
export type ReadingAnnotationColor = "yellow" | "red" | "blue" | "green" | "purple";
export type ReadingAnnotationType = "highlight" | "underline" | "note" | "region";

export type ReadingAsset = {
  id: string;
  ownerId: string;
  projectId: string;
  nodeId?: string | null;
  title: string;
  author?: string | null;
  format: ReadingFormat;
  fileName: string;
  filePath: string;
  storagePath?: string | null;
  coverPath?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReadingSection = {
  index: number;
  title: string;
  html: string;
  text: string;
  paginationVersion?: number;
};

export type ReadingTextRange = {
  sectionIndex: number;
  offset: number;
  length: number;
};

export type ReadingNote = {
  id: string;
  assetId: string;
  ownerId: string;
  projectId: string;
  selectedText: string;
  comment: string;
  sectionIndex: number;
  chapterTitle?: string | null;
  color: ReadingAnnotationColor;
  type: ReadingAnnotationType;
  offset?: number | null;
  length?: number | null;
  ranges?: ReadingTextRange[] | null;
  rect?: { x: number; y: number; w: number; h: number } | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ReadingNoteCreate = {
  assetId: string;
  ownerId: string;
  projectId: string;
  selectedText: string;
  comment?: string;
  sectionIndex: number;
  chapterTitle?: string | null;
  color?: ReadingAnnotationColor;
  type?: ReadingAnnotationType;
  offset?: number | null;
  length?: number | null;
  ranges?: ReadingTextRange[] | null;
  rect?: { x: number; y: number; w: number; h: number } | null;
};

export type ReadingProgress = {
  assetId: string;
  ownerId?: string;
  contentScale: number;
  notesScrollTop?: number;
  sectionIndex: number;
  scrollRatio: number;
  updatedAt: string;
};
