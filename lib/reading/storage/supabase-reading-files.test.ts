import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  downloadReadingFileBuffer,
  getReadingFormatMimeType,
  getStoragePathMimeType,
  PROJECT_ASSETS_BUCKET,
  removeReadingFiles,
  uploadReadingCoverFile,
  uploadReadingOriginalFile,
} from "./supabase-reading-files";

function createStorageMock(overrides?: {
  downloadData?: { arrayBuffer: () => Promise<ArrayBuffer> };
  downloadError?: Error;
  removeError?: Error;
  uploadError?: Error;
}) {
  const upload = vi.fn().mockResolvedValue({ error: overrides?.uploadError ?? null });
  const remove = vi.fn().mockResolvedValue({ error: overrides?.removeError ?? null });
  const download = vi.fn().mockResolvedValue({
    data:
      overrides?.downloadData ??
      {
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
      },
    error: overrides?.downloadError ?? null,
  });
  const from = vi.fn().mockReturnValue({ download, remove, upload });
  const supabase = { storage: { from } } as unknown as SupabaseClient;

  return { download, from, remove, supabase, upload };
}

const ids = {
  assetId: "46420b32-dd19-4801-ad06-44b2c0c3eb0c",
  ownerId: "e42f7dfb-72cc-4042-aa20-731adc4263ba",
  projectId: "bebae9e5-24db-45a9-88aa-43dc79816c5a",
};

describe("supabase reading file storage", () => {
  it("uploads original files with storage-safe paths", async () => {
    const { from, supabase, upload } = createStorageMock();

    await expect(
      uploadReadingOriginalFile({
        ...ids,
        bytes: Buffer.from("epub"),
        fileName: "地师_徐公子胜治.epub",
        format: "epub",
        mimeType: "application/epub+zip",
        supabase,
      }),
    ).resolves.toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub",
    );
    expect(from).toHaveBeenCalledWith(PROJECT_ASSETS_BUCKET);
    expect(upload).toHaveBeenCalledWith(
      expect.not.stringContaining("地师"),
      Buffer.from("epub"),
      { contentType: "application/epub+zip", upsert: false },
    );
  });

  it("uploads covers with image extension inferred from mime type", async () => {
    const { supabase, upload } = createStorageMock();

    await expect(
      uploadReadingCoverFile({
        ...ids,
        bytes: Buffer.from("cover"),
        coverMimeType: "image/png",
        supabase,
      }),
    ).resolves.toBe(
      "e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/covers/46420b32-dd19-4801-ad06-44b2c0c3eb0c.png",
    );
    expect(upload).toHaveBeenCalledWith(expect.any(String), Buffer.from("cover"), {
      contentType: "image/png",
      upsert: true,
    });
  });

  it("downloads storage objects into buffers", async () => {
    const { download, supabase } = createStorageMock();

    await expect(downloadReadingFileBuffer(supabase, "path/to/file.txt")).resolves.toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect(download).toHaveBeenCalledWith("path/to/file.txt");
  });

  it("does not call storage remove when there are no paths", async () => {
    const { remove, supabase } = createStorageMock();

    await removeReadingFiles(supabase, [null, undefined, ""]);

    expect(remove).not.toHaveBeenCalled();
  });

  it("removes only concrete storage paths", async () => {
    const { remove, supabase } = createStorageMock();

    await removeReadingFiles(supabase, ["original.epub", null, "cover.webp"]);

    expect(remove).toHaveBeenCalledWith(["original.epub", "cover.webp"]);
  });

  it("maps reading format and storage path mime types", () => {
    expect(getReadingFormatMimeType("epub")).toBe("application/epub+zip");
    expect(getReadingFormatMimeType("pdf")).toBe("application/pdf");
    expect(getReadingFormatMimeType("txt")).toBe("text/plain; charset=utf-8");
    expect(getStoragePathMimeType("OPS/style.css")).toBe("text/css");
    expect(getStoragePathMimeType("OPS/font.woff2")).toBe("font/woff2");
    expect(getStoragePathMimeType("OPS/file.bin")).toBe("application/octet-stream");
  });
});
