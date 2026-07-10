import AdmZip from "adm-zip";
import crypto from "crypto";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  parseEpubSections,
  readEpubTitle,
} from "@/lib/reading/parsers/epub-parser";
import { parseTxtSections } from "@/lib/reading/parsers/txt-parser";
import {
  downloadReadingFileBuffer,
  getReadingFormatMimeType,
  getStoragePathMimeType,
  removeReadingFiles,
  uploadReadingCoverFile,
  uploadReadingOriginalFile,
} from "@/lib/reading/storage/supabase-reading-files";
import type { ReadingAsset, ReadingFormat, ReadingSection } from "@/lib/reading/types";

import { assetSelectColumns, type ReadingAssetRow, rowToAsset } from "./rows";

export function detectReadingFormat(fileName: string): ReadingFormat | null {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".epub") return "epub";
  if (ext === ".pdf") return "pdf";
  if (ext === ".txt") return "txt";
  return null;
}

export async function createReadingAsset(input: {
  coverBytes?: Buffer;
  coverMimeType?: string;
  fileName: string;
  mimeType?: string;
  nodeId?: string;
  ownerId: string;
  projectId: string;
  supabase: SupabaseClient;
  bytes: Buffer;
}): Promise<ReadingAsset> {
  const format = detectReadingFormat(input.fileName);
  if (!format) {
    throw new Error("不支持的阅读文件类型");
  }

  const id = crypto.randomUUID();
  const storagePath = await uploadReadingOriginalFile({
    assetId: id,
    bytes: input.bytes,
    fileName: input.fileName,
    format,
    mimeType: input.mimeType,
    ownerId: input.ownerId,
    projectId: input.projectId,
    supabase: input.supabase,
  });

  let coverPath: string | null = null;

  try {
    coverPath = input.coverBytes?.length
      ? await uploadReadingCoverFile({
          assetId: id,
          bytes: input.coverBytes,
          coverMimeType: input.coverMimeType,
          ownerId: input.ownerId,
          projectId: input.projectId,
          supabase: input.supabase,
        })
      : null;

    const title = readTitle(input.bytes, input.fileName, format);
    const { data, error } = await input.supabase
      .from("reading_assets")
      .insert({
        id,
        cover_path: coverPath,
        file_name: input.fileName,
        format,
        mime_type: input.mimeType || null,
        node_id: input.nodeId ?? null,
        owner_id: input.ownerId,
        project_id: input.projectId,
        size_bytes: input.bytes.length,
        storage_path: storagePath,
        title,
      })
      .select(assetSelectColumns)
      .single();

    if (error) {
      throw error;
    }

    return rowToAsset(data as ReadingAssetRow);
  } catch (error) {
    await safeRemoveReadingFiles(input.supabase, [storagePath, coverPath]);
    throw error;
  }
}

export async function getReadingAsset(
  supabase: SupabaseClient,
  assetId: string,
): Promise<ReadingAsset | null> {
  const { data, error } = await supabase
    .from("reading_assets")
    .select(assetSelectColumns)
    .eq("id", assetId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? rowToAsset(data as ReadingAssetRow) : null;
}

export async function getReadingAssetFile(
  supabase: SupabaseClient,
  assetId: string,
) {
  const asset = await getReadingAsset(supabase, assetId);
  if (!asset?.storagePath) return null;

  const bytes = await downloadReadingFileBuffer(supabase, asset.storagePath);
  return {
    bytes,
    fileName: asset.fileName,
    format: asset.format,
    mimeType: getReadingFormatMimeType(asset.format),
  };
}

export async function getReadingAssetCover(
  supabase: SupabaseClient,
  assetId: string,
) {
  const asset = await getReadingAsset(supabase, assetId);
  if (!asset?.coverPath) return null;

  const bytes = await downloadReadingFileBuffer(supabase, asset.coverPath);
  return {
    bytes,
    mimeType: getStoragePathMimeType(asset.coverPath),
  };
}

export async function getReadingEpubAsset(input: {
  assetId: string;
  assetPath: string;
  supabase: SupabaseClient;
}) {
  const file = await getReadingAssetFile(input.supabase, input.assetId);
  if (!file || file.format !== "epub") return null;

  const zip = new AdmZip(file.bytes);
  const entry = zip.getEntry(input.assetPath);
  if (!entry) return null;

  return {
    bytes: entry.getData(),
    mimeType: getStoragePathMimeType(input.assetPath),
  };
}

export async function getReadingSections(
  supabase: SupabaseClient,
  assetId: string,
): Promise<ReadingSection[]> {
  const asset = await getReadingAsset(supabase, assetId);
  if (!asset?.storagePath) {
    throw new Error("阅读资料不存在");
  }

  if (asset.format === "pdf") {
    return [{ index: 0, title: asset.title, html: "", text: "" }];
  }

  const bytes = await downloadReadingFileBuffer(supabase, asset.storagePath);
  if (asset.format === "txt") {
    return parseTxtSections(bytes.toString("utf8"));
  }

  return parseEpubSections(asset.id, bytes);
}

function readTitle(bytes: Buffer, fileName: string, format: ReadingFormat) {
  if (format !== "epub") {
    return path.basename(fileName, path.extname(fileName));
  }

  return readEpubTitle(bytes) || path.basename(fileName, path.extname(fileName));
}

async function safeRemoveReadingFiles(
  supabase: SupabaseClient,
  paths: Array<string | null | undefined>,
) {
  try {
    await removeReadingFiles(supabase, paths);
  } catch {
    // Preserve the original upload or metadata error.
  }
}
