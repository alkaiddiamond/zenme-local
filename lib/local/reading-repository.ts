import AdmZip from "adm-zip";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getProjectsDir, getZenmeDataDir } from "@/lib/local/data-dir";
import {
  assertSafePathSegment,
  createSafeFileName,
  resolveInside,
} from "@/lib/local/path-safety";
import {
  parseEpubSections,
  readEpubTitle,
} from "@/lib/reading/parsers/epub-parser";
import { parseTxtSections } from "@/lib/reading/parsers/txt-parser";
import {
  normalizeReadingContentScale,
  normalizeReadingScrollRatio,
  normalizeReadingSectionIndex,
} from "@/lib/reading/progress-policy";
import type {
  ReadingAnnotationColor,
  ReadingAnnotationType,
  ReadingAsset,
  ReadingFormat,
  ReadingNote,
  ReadingNoteCreate,
  ReadingProgress,
  ReadingSection,
} from "@/lib/reading/types";
import {
  normalizeColor,
  normalizeType,
} from "@/lib/reading/repositories/rows";

export function detectLocalReadingFormat(fileName: string): ReadingFormat | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".epub") return "epub";
  if (ext === ".pdf") return "pdf";
  if (ext === ".txt") return "txt";
  return null;
}

export async function createLocalReadingAsset(input: {
  bytes: Buffer;
  coverBytes?: Buffer;
  coverMimeType?: string;
  fileName: string;
  mimeType?: string;
  nodeId?: string;
  projectId: string;
}, dataDir = getZenmeDataDir()): Promise<ReadingAsset> {
  assertSafePathSegment(input.projectId, "projectId");
  const format = detectLocalReadingFormat(input.fileName);
  if (!format) {
    throw new Error("不支持的阅读文件类型");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const assetDir = getReadingAssetDir(input.projectId, id, dataDir);
  const originalRelativePath = path.join("original", createSafeFileName(input.fileName));
  const originalPath = resolveInside(assetDir, originalRelativePath);
  await writeBinaryFileAtomic(originalPath, input.bytes);

  let coverPath: string | null = null;
  try {
    if (input.coverBytes?.length) {
      coverPath = "cover.webp";
      await writeBinaryFileAtomic(resolveInside(assetDir, coverPath), input.coverBytes);
    }

    const title = readLocalTitle(input.bytes, input.fileName, format);
    const asset: ReadingAsset = {
      id,
      ownerId: "local",
      projectId: input.projectId,
      nodeId: input.nodeId ?? null,
      title,
      author: null,
      format,
      fileName: input.fileName,
      filePath: originalRelativePath.replaceAll("\\", "/"),
      storagePath: originalRelativePath.replaceAll("\\", "/"),
      coverPath,
      createdAt: now,
      updatedAt: now,
    };
    const sections = createSectionsForAsset(asset, input.bytes);

    await writeJsonFile(resolveInside(assetDir, "asset.json"), asset);
    await writeJsonFile(resolveInside(assetDir, "sections.json"), sections);
    await writeJsonFile(resolveInside(assetDir, "notes.json"), [] satisfies ReadingNote[]);
    return asset;
  } catch (error) {
    await fs.rm(assetDir, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
}

export async function getLocalReadingAsset(
  assetId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) return null;
  return readAssetJson(location.assetDir);
}

export async function getLocalReadingAssetFile(
  assetId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) return null;
  const asset = await readAssetJson(location.assetDir);
  const bytes = await fs.readFile(resolveInside(location.assetDir, asset.filePath));
  return {
    bytes,
    fileName: asset.fileName,
    format: asset.format,
    mimeType: getReadingFormatMimeType(asset.format),
  };
}

export async function getLocalReadingAssetCover(
  assetId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) return null;
  const asset = await readAssetJson(location.assetDir);
  if (!asset.coverPath) return null;
  return {
    bytes: await fs.readFile(resolveInside(location.assetDir, asset.coverPath)),
    mimeType: getStoragePathMimeType(asset.coverPath),
  };
}

export async function getLocalReadingEpubAsset(input: {
  assetId: string;
  assetPath: string;
}, dataDir = getZenmeDataDir()) {
  const file = await getLocalReadingAssetFile(input.assetId, dataDir);
  if (!file || file.format !== "epub") return null;
  if (path.isAbsolute(input.assetPath) || input.assetPath.includes("..")) {
    return null;
  }

  const zip = new AdmZip(file.bytes);
  const entry = zip.getEntry(input.assetPath);
  if (!entry) return null;
  return {
    bytes: entry.getData(),
    mimeType: getStoragePathMimeType(input.assetPath),
  };
}

export async function getLocalReadingSections(
  assetId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) throw new Error("阅读资料不存在");
  return readJsonFile<ReadingSection[]>(
    resolveInside(location.assetDir, "sections.json"),
    {
      defaultValue: [],
      normalize: normalizeSections,
    },
  );
}

export async function listLocalReadingNotes(
  assetId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) return [];
  return readNotes(location.assetDir);
}

export async function createLocalReadingNote(
  input: ReadingNoteCreate,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(input.assetId, dataDir);
  if (!location) throw new Error("阅读资料不存在");
  const asset = await readAssetJson(location.assetDir);
  if (asset.projectId !== input.projectId) {
    throw new Error("项目与阅读资料不匹配");
  }

  const notes = await readNotes(location.assetDir);
  const now = new Date().toISOString();
  const note: ReadingNote = {
    id: crypto.randomUUID(),
    assetId: input.assetId,
    ownerId: "local",
    projectId: input.projectId,
    selectedText: input.selectedText,
    comment: input.comment ?? "",
    sectionIndex: input.sectionIndex,
    chapterTitle: input.chapterTitle ?? null,
    color: normalizeColor(input.color),
    type: normalizeType(input.type),
    offset: input.offset ?? null,
    length: input.length ?? null,
    rect: input.rect ?? null,
    sortOrder: notes.length ? Math.max(...notes.map((item) => item.sortOrder)) + 1 : 0,
    createdAt: now,
    updatedAt: now,
  };
  await writeNotes(location.assetDir, [...notes, note]);
  return note;
}

export async function reorderLocalReadingNotes(
  assetId: string,
  noteIds: string[],
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) throw new Error("阅读资料不存在");
  const notes = await readNotes(location.assetDir);
  const existing = new Map(notes.map((note) => [note.id, note]));
  const orderedIds = [
    ...noteIds.filter((noteId) => existing.has(noteId)),
    ...notes.map((note) => note.id).filter((noteId) => !noteIds.includes(noteId)),
  ];
  const reordered = orderedIds.map((noteId, index) => ({
    ...existing.get(noteId)!,
    sortOrder: index,
  }));
  await writeNotes(location.assetDir, reordered);
  return reordered;
}

export async function findLocalReadingNote(
  noteId: string,
  dataDir = getZenmeDataDir(),
) {
  assertSafePathSegment(noteId, "noteId");
  for (const location of await listReadingAssetLocations(dataDir)) {
    const notes = await readNotes(location.assetDir);
    const note = notes.find((item) => item.id === noteId);
    if (note) return { note, assetDir: location.assetDir };
  }
  return null;
}

export async function updateLocalReadingNote(
  noteId: string,
  input: {
    color?: ReadingAnnotationColor;
    comment?: string;
    selectedText?: string;
    type?: ReadingAnnotationType;
  },
  dataDir = getZenmeDataDir(),
) {
  const location = await findLocalReadingNote(noteId, dataDir);
  if (!location) return null;
  const notes = await readNotes(location.assetDir);
  const updatedAt = new Date().toISOString();
  const updated = notes.map((note) =>
    note.id === noteId
      ? {
          ...note,
          ...(input.selectedText !== undefined ? { selectedText: input.selectedText } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
          ...(input.color !== undefined ? { color: normalizeColor(input.color) } : {}),
          ...(input.type !== undefined ? { type: normalizeType(input.type) } : {}),
          updatedAt,
        }
      : note,
  );
  await writeNotes(location.assetDir, updated);
  return updated.find((note) => note.id === noteId) ?? null;
}

export async function deleteLocalReadingNote(
  noteId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findLocalReadingNote(noteId, dataDir);
  if (!location) return false;
  const notes = await readNotes(location.assetDir);
  await writeNotes(
    location.assetDir,
    notes.filter((note) => note.id !== noteId),
  );
  return true;
}

export async function getLocalReadingProgress(
  assetId: string,
  dataDir = getZenmeDataDir(),
) {
  const location = await findReadingAssetLocation(assetId, dataDir);
  if (!location) return null;
  return readJsonFile<ReadingProgress | null>(
    resolveInside(location.assetDir, "progress.json"),
    {
      defaultValue: null,
      normalize: normalizeProgress,
    },
  );
}

export async function saveLocalReadingProgress(input: {
  assetId: string;
  contentScale: number;
  projectId: string;
  scrollRatio: number;
  sectionIndex: number;
}, dataDir = getZenmeDataDir()) {
  const location = await findReadingAssetLocation(input.assetId, dataDir);
  if (!location) throw new Error("阅读资料不存在");
  const asset = await readAssetJson(location.assetDir);
  if (asset.projectId !== input.projectId) {
    throw new Error("项目与阅读资料不匹配");
  }
  const progress: ReadingProgress = {
    assetId: input.assetId,
    ownerId: "local",
    contentScale: normalizeReadingContentScale(input.contentScale),
    sectionIndex: normalizeReadingSectionIndex(input.sectionIndex),
    scrollRatio: normalizeReadingScrollRatio(input.scrollRatio),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFile(resolveInside(location.assetDir, "progress.json"), progress);
  return progress;
}

export async function requireLocalReadingAsset(assetId: string) {
  const asset = await getLocalReadingAsset(assetId);
  if (!asset) {
    throw new Error("阅读资料不存在");
  }
  return asset;
}

function getReadingAssetDir(projectId: string, assetId: string, dataDir: string) {
  assertSafePathSegment(assetId, "assetId");
  return resolveInside(getProjectDir(projectId, dataDir), "reading", assetId);
}

async function findReadingAssetLocation(assetId: string, dataDir: string) {
  assertSafePathSegment(assetId, "assetId");
  const locations = await listReadingAssetLocations(dataDir);
  return locations.find((location) => location.assetId === assetId) ?? null;
}

async function listReadingAssetLocations(dataDir: string) {
  const projectsDir = getProjectsDir(dataDir);
  const locations: Array<{ assetDir: string; assetId: string; projectId: string }> = [];
  let projects: Array<import("node:fs").Dirent>;
  try {
    projects = await fs.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return locations;
  }

  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const readingDir = resolveInside(projectsDir, project.name, "reading");
    let assets: Array<import("node:fs").Dirent>;
    try {
      assets = await fs.readdir(readingDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const asset of assets) {
      if (!asset.isDirectory()) continue;
      locations.push({
        assetDir: resolveInside(readingDir, asset.name),
        assetId: asset.name,
        projectId: project.name,
      });
    }
  }
  return locations;
}

async function readAssetJson(assetDir: string) {
  const asset = await readJsonFile<ReadingAsset | null>(
    resolveInside(assetDir, "asset.json"),
    {
      defaultValue: null,
      normalize: normalizeAsset,
    },
  );
  if (!asset) throw new Error("阅读资料不存在");
  return asset;
}

async function readNotes(assetDir: string) {
  return readJsonFile<ReadingNote[]>(resolveInside(assetDir, "notes.json"), {
    defaultValue: [],
    normalize: normalizeNotes,
  });
}

async function writeNotes(assetDir: string, notes: ReadingNote[]) {
  const sorted = [...notes].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt),
  );
  await writeJsonFile(resolveInside(assetDir, "notes.json"), sorted);
}

async function writeBinaryFileAtomic(filePath: string, bytes: Buffer) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const handle = await fs.open(tmpPath, "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmpPath, filePath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function createSectionsForAsset(asset: ReadingAsset, bytes: Buffer) {
  if (asset.format === "pdf") {
    return [{ index: 0, title: asset.title, html: "", text: "" }];
  }
  if (asset.format === "txt") {
    return parseTxtSections(bytes.toString("utf8"));
  }
  return parseEpubSections(asset.id, bytes);
}

function readLocalTitle(bytes: Buffer, fileName: string, format: ReadingFormat) {
  if (format !== "epub") {
    return path.basename(fileName, path.extname(fileName));
  }
  return readEpubTitle(bytes) || path.basename(fileName, path.extname(fileName));
}

function getReadingFormatMimeType(format: ReadingFormat) {
  if (format === "epub") return "application/epub+zip";
  if (format === "pdf") return "application/pdf";
  return "text/plain; charset=utf-8";
}

function getStoragePathMimeType(storagePath: string) {
  const ext = path.extname(storagePath).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".html" || ext === ".xhtml") return "text/html; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function normalizeAsset(value: unknown): ReadingAsset | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const asset = value as Partial<ReadingAsset>;
  if (
    typeof asset.id !== "string" ||
    typeof asset.ownerId !== "string" ||
    typeof asset.projectId !== "string" ||
    typeof asset.title !== "string" ||
    !isReadingFormat(asset.format) ||
    typeof asset.fileName !== "string" ||
    typeof asset.filePath !== "string" ||
    typeof asset.createdAt !== "string" ||
    typeof asset.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    id: asset.id,
    ownerId: asset.ownerId,
    projectId: asset.projectId,
    nodeId: typeof asset.nodeId === "string" ? asset.nodeId : null,
    title: asset.title,
    author: typeof asset.author === "string" ? asset.author : null,
    format: asset.format,
    fileName: asset.fileName,
    filePath: asset.filePath,
    storagePath: typeof asset.storagePath === "string" ? asset.storagePath : asset.filePath,
    coverPath: typeof asset.coverPath === "string" ? asset.coverPath : null,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function normalizeSections(value: unknown): ReadingSection[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((section): section is ReadingSection => {
    const item = section as Partial<ReadingSection>;
    return (
      typeof item.index === "number" &&
      typeof item.title === "string" &&
      typeof item.html === "string" &&
      typeof item.text === "string"
    );
  });
}

function normalizeNotes(value: unknown): ReadingNote[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((note): note is ReadingNote => {
    const item = note as Partial<ReadingNote>;
    return (
      typeof item.id === "string" &&
      typeof item.assetId === "string" &&
      typeof item.ownerId === "string" &&
      typeof item.projectId === "string" &&
      typeof item.selectedText === "string" &&
      typeof item.comment === "string" &&
      typeof item.sectionIndex === "number" &&
      typeof item.sortOrder === "number" &&
      typeof item.createdAt === "string" &&
      typeof item.updatedAt === "string"
    );
  }).map((note) => ({
    ...note,
    color: normalizeColor(note.color),
    type: normalizeType(note.type),
  }));
}

function normalizeProgress(value: unknown): ReadingProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const progress = value as Partial<ReadingProgress>;
  if (
    typeof progress.assetId !== "string" ||
    typeof progress.contentScale !== "number" ||
    typeof progress.sectionIndex !== "number" ||
    typeof progress.scrollRatio !== "number" ||
    typeof progress.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    assetId: progress.assetId,
    ownerId: typeof progress.ownerId === "string" ? progress.ownerId : "local",
    contentScale: normalizeReadingContentScale(progress.contentScale),
    sectionIndex: normalizeReadingSectionIndex(progress.sectionIndex),
    scrollRatio: normalizeReadingScrollRatio(progress.scrollRatio),
    updatedAt: progress.updatedAt,
  };
}

function isReadingFormat(value: unknown): value is ReadingFormat {
  return value === "epub" || value === "pdf" || value === "txt";
}

