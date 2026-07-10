import type {
  ReadingAnnotationColor,
  ReadingAnnotationType,
  ReadingAsset,
  ReadingFormat,
  ReadingNote,
  ReadingProgress,
} from "@/lib/reading/types";
import {
  normalizeReadingContentScale,
  normalizeReadingScrollRatio,
  normalizeReadingSectionIndex,
} from "@/lib/reading/progress-policy";

export type ReadingAssetRow = {
  author: string | null;
  cover_path: string | null;
  created_at: string;
  file_name: string;
  format: string;
  id: string;
  mime_type: string | null;
  node_id: string | null;
  owner_id: string;
  project_id: string;
  size_bytes: number | null;
  storage_path: string;
  title: string;
  updated_at: string;
};

export type ReadingNoteRow = {
  asset_id: string;
  chapter_title: string | null;
  color: string;
  comment: string;
  created_at: string;
  id: string;
  length: number | null;
  offset: number | null;
  owner_id: string;
  project_id: string;
  rect: { x: number; y: number; w: number; h: number } | null;
  section_index: number;
  selected_text: string;
  sort_order: number | null;
  type: string;
  updated_at: string;
};

export type ReadingProgressRow = {
  asset_id: string;
  content_scale: number;
  owner_id: string;
  project_id: string;
  scroll_ratio: number;
  section_index: number;
  updated_at: string;
};

export const assetSelectColumns =
  "id,owner_id,project_id,node_id,title,author,format,file_name,storage_path,cover_path,mime_type,size_bytes,created_at,updated_at";
export const noteSelectColumns =
  "id,asset_id,owner_id,project_id,selected_text,comment,section_index,chapter_title,color,type,offset,length,rect,sort_order,created_at,updated_at";
export const progressSelectColumns =
  "asset_id,owner_id,project_id,section_index,content_scale,scroll_ratio,updated_at";

export function rowToAsset(row: ReadingAssetRow): ReadingAsset {
  return {
    id: row.id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    nodeId: row.node_id,
    title: row.title,
    author: row.author,
    format: row.format as ReadingFormat,
    fileName: row.file_name,
    filePath: row.storage_path,
    storagePath: row.storage_path,
    coverPath: row.cover_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToNote(row: ReadingNoteRow): ReadingNote {
  return {
    id: row.id,
    assetId: row.asset_id,
    ownerId: row.owner_id,
    projectId: row.project_id,
    selectedText: row.selected_text,
    comment: row.comment,
    sectionIndex: row.section_index,
    chapterTitle: row.chapter_title,
    color: normalizeColor(row.color),
    type: normalizeType(row.type),
    offset: row.offset,
    length: row.length,
    rect: row.rect,
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function rowToProgress(row: ReadingProgressRow): ReadingProgress {
  return {
    assetId: row.asset_id,
    ownerId: row.owner_id,
    contentScale: normalizeReadingContentScale(row.content_scale),
    sectionIndex: normalizeReadingSectionIndex(row.section_index),
    scrollRatio: normalizeReadingScrollRatio(row.scroll_ratio),
    updatedAt: row.updated_at,
  };
}

export function normalizeColor(value: unknown): ReadingAnnotationColor {
  if (
    value === "yellow" ||
    value === "red" ||
    value === "blue" ||
    value === "green" ||
    value === "purple"
  ) {
    return value;
  }
  return "yellow";
}

export function normalizeType(value: unknown): ReadingAnnotationType {
  if (
    value === "highlight" ||
    value === "underline" ||
    value === "note" ||
    value === "region"
  ) {
    return value;
  }
  return "highlight";
}
