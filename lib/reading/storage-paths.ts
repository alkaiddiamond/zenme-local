import path from "path";

import type { ReadingFormat } from "@/lib/reading/types";

const STORAGE_EXTENSION_BY_FORMAT: Record<ReadingFormat, string> = {
  epub: ".epub",
  markdown: ".md",
  pdf: ".pdf",
  txt: ".txt",
};

const STORAGE_PATH_SAFE_EXTENSION = /^\.[a-z0-9]+$/;

export function createReadingOriginalStoragePath(input: {
  assetId: string;
  fileName: string;
  format: ReadingFormat;
  ownerId: string;
  projectId: string;
}) {
  const ext = getSafeStorageExtension(input.fileName, input.format);
  return `${input.ownerId}/${input.projectId}/reading/original/${input.assetId}${ext}`;
}

export function createReadingCoverStoragePath(input: {
  assetId: string;
  extension: string;
  ownerId: string;
  projectId: string;
}) {
  return `${input.ownerId}/${input.projectId}/reading/covers/${input.assetId}${input.extension}`;
}

function getSafeStorageExtension(fileName: string, format: ReadingFormat) {
  const ext = path.extname(fileName).toLowerCase();
  if (STORAGE_PATH_SAFE_EXTENSION.test(ext)) {
    return ext;
  }

  return STORAGE_EXTENSION_BY_FORMAT[format];
}
