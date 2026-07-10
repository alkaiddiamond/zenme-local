import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReadingFormat } from "@/lib/reading/types";
import {
  createReadingCoverStoragePath,
  createReadingOriginalStoragePath,
} from "@/lib/reading/storage-paths";

export const PROJECT_ASSETS_BUCKET = "project-assets";

export async function uploadReadingOriginalFile(input: {
  assetId: string;
  bytes: Buffer;
  fileName: string;
  format: ReadingFormat;
  mimeType?: string;
  ownerId: string;
  projectId: string;
  supabase: SupabaseClient;
}) {
  const storagePath = createReadingOriginalStoragePath({
    assetId: input.assetId,
    fileName: input.fileName,
    format: input.format,
    ownerId: input.ownerId,
    projectId: input.projectId,
  });
  const { error } = await input.supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return storagePath;
}

export async function uploadReadingCoverFile(input: {
  assetId: string;
  bytes: Buffer;
  coverMimeType?: string;
  ownerId: string;
  projectId: string;
  supabase: SupabaseClient;
}) {
  const extension = getImageExtension(input.coverMimeType || "image/webp");
  const coverPath = createReadingCoverStoragePath({
    assetId: input.assetId,
    extension,
    ownerId: input.ownerId,
    projectId: input.projectId,
  });
  const { error } = await input.supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .upload(coverPath, input.bytes, {
      contentType: input.coverMimeType || "image/webp",
      upsert: true,
    });

  if (error) {
    throw error;
  }

  return coverPath;
}

export async function removeReadingFiles(
  supabase: SupabaseClient,
  paths: Array<string | null | undefined>,
) {
  const removablePaths = paths.filter((item): item is string => Boolean(item));
  if (removablePaths.length === 0) return;

  const { error } = await supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .remove(removablePaths);

  if (error) {
    throw error;
  }
}

export async function downloadReadingFileBuffer(
  supabase: SupabaseClient,
  storagePath: string,
) {
  const { data, error } = await supabase.storage
    .from(PROJECT_ASSETS_BUCKET)
    .download(storagePath);

  if (error) {
    throw error;
  }

  return Buffer.from(await data.arrayBuffer());
}

export function getReadingFormatMimeType(format: ReadingFormat) {
  if (format === "epub") return "application/epub+zip";
  if (format === "pdf") return "application/pdf";
  return "text/plain; charset=utf-8";
}

export function getStoragePathMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".css") return "text/css";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webp") return "image/webp";
  if (ext === ".woff") return "font/woff";
  if (ext === ".woff2") return "font/woff2";
  if (ext === ".ttf") return "font/ttf";
  if (ext === ".otf") return "font/otf";
  return "application/octet-stream";
}

function getImageExtension(mimeType: string) {
  if (/png/i.test(mimeType)) return ".png";
  if (/jpe?g/i.test(mimeType)) return ".jpg";
  if (/gif/i.test(mimeType)) return ".gif";
  if (/webp/i.test(mimeType)) return ".webp";
  return ".img";
}
