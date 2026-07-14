import fs from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import {
  assertSafePathSegment,
  createSafeFileName,
  resolveInside,
} from "@/lib/local/path-safety";

export type LocalProjectFileRecord = {
  id: string;
  projectId: string;
  originalPath: string;
  previewPath: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
};

type ProjectFilesIndex = {
  version: 1;
  files: LocalProjectFileRecord[];
};

export async function listLocalProjectFiles(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  return (await readProjectFilesIndex(projectId, dataDir)).files.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function importLocalProjectFile(input: {
  bytes: Buffer;
  fileName: string;
  mimeType?: string | null;
  previewBytes?: Buffer;
  previewMimeType?: string | null;
  projectId: string;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  const projectDir = getProjectDir(input.projectId, dataDir);
  const fileId = crypto.randomUUID();
  const safeName = createSafeFileName(input.fileName);
  const originalRelativePath = path.join("files", "original", `${fileId}-${safeName}`);
  const originalPath = resolveInside(projectDir, originalRelativePath);

  await writeBinaryFileAtomic(originalPath, input.bytes);

  let previewPath: string | null = null;
  try {
    if (input.previewBytes) {
      const previewRelativePath = path.join("files", "preview", `${fileId}.webp`);
      await writeBinaryFileAtomic(resolveInside(projectDir, previewRelativePath), input.previewBytes);
      previewPath = previewRelativePath.replaceAll("\\", "/");
    }

    const now = new Date().toISOString();
    const record: LocalProjectFileRecord = {
      id: fileId,
      projectId: input.projectId,
      originalPath: originalRelativePath.replaceAll("\\", "/"),
      previewPath,
      fileName: input.fileName,
      mimeType: input.mimeType || null,
      sizeBytes: input.bytes.length,
      createdAt: now,
    };
    const index = await readProjectFilesIndex(input.projectId, dataDir);
    index.files = [record, ...index.files.filter((file) => file.id !== fileId)];
    await writeProjectFilesIndex(input.projectId, index, dataDir);
    return record;
  } catch (error) {
    await fs.rm(originalPath, { force: true }).catch(() => undefined);
    if (previewPath) {
      await fs.rm(resolveInside(projectDir, previewPath), { force: true }).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

export async function getLocalProjectFile(input: {
  fileId: string;
  projectId: string;
  variant: "original" | "preview";
}, dataDir = getZenmeDataDir()) {
  const source = await getLocalProjectFileSource(input, dataDir);
  if (!source) {
    return null;
  }

  const bytes = await fs.readFile(source.absolutePath);
  return {
    bytes,
    fileName: source.fileName,
    mimeType: source.mimeType,
    record: source.record,
  };
}

export async function getLocalProjectFileSource(input: {
  fileId: string;
  projectId: string;
  variant: "original" | "preview";
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  assertSafePathSegment(input.fileId, "fileId");
  const index = await readProjectFilesIndex(input.projectId, dataDir);
  const record = index.files.find((file) => file.id === input.fileId);
  if (!record) {
    return null;
  }

  const relativePath =
    input.variant === "preview" ? record.previewPath : record.originalPath;
  if (!relativePath) {
    return null;
  }

  const absolutePath = resolveInside(getProjectDir(input.projectId, dataDir), relativePath);
  return {
    absolutePath,
    fileName: record.fileName,
    mimeType:
      input.variant === "preview"
        ? "image/webp"
        : record.mimeType || "application/octet-stream",
    record,
  };
}

export async function deleteLocalProjectFile(input: {
  fileId: string;
  projectId: string;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  assertSafePathSegment(input.fileId, "fileId");
  const projectDir = getProjectDir(input.projectId, dataDir);
  const index = await readProjectFilesIndex(input.projectId, dataDir);
  const record = index.files.find((file) => file.id === input.fileId);
  if (!record) {
    return;
  }

  await fs.rm(resolveInside(projectDir, record.originalPath), { force: true });
  if (record.previewPath) {
    await fs.rm(resolveInside(projectDir, record.previewPath), { force: true });
  }

  await writeProjectFilesIndex(
    input.projectId,
    {
      version: 1,
      files: index.files.filter((file) => file.id !== input.fileId),
    },
    dataDir,
  );
}

async function readProjectFilesIndex(projectId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  return readJsonFile<ProjectFilesIndex>(
    resolveInside(getProjectDir(projectId, dataDir), "files", "index.json"),
    {
      defaultValue: { version: 1, files: [] },
      normalize: normalizeProjectFilesIndex,
    },
  );
}

async function writeProjectFilesIndex(
  projectId: string,
  index: ProjectFilesIndex,
  dataDir: string,
) {
  await writeJsonFile(
    resolveInside(getProjectDir(projectId, dataDir), "files", "index.json"),
    index,
  );
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

function normalizeProjectFilesIndex(value: unknown): ProjectFilesIndex | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const index = value as Partial<ProjectFilesIndex>;
  if (index.version !== 1 || !Array.isArray(index.files)) {
    return null;
  }

  const files = index.files
    .map((file) => normalizeProjectFileRecord(file))
    .filter((file): file is LocalProjectFileRecord => Boolean(file));

  return { version: 1, files };
}

function normalizeProjectFileRecord(value: unknown): LocalProjectFileRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const file = value as Partial<LocalProjectFileRecord>;
  if (
    typeof file.id !== "string" ||
    typeof file.projectId !== "string" ||
    typeof file.originalPath !== "string" ||
    typeof file.fileName !== "string" ||
    typeof file.sizeBytes !== "number" ||
    typeof file.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: file.id,
    projectId: file.projectId,
    originalPath: file.originalPath,
    previewPath: typeof file.previewPath === "string" ? file.previewPath : null,
    fileName: file.fileName,
    mimeType: typeof file.mimeType === "string" ? file.mimeType : null,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
  };
}
