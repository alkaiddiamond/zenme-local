import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createReadingAsset } from "./assets";
import {
  removeReadingFiles,
  uploadReadingCoverFile,
  uploadReadingOriginalFile,
} from "@/lib/reading/storage/supabase-reading-files";

vi.mock("@/lib/reading/storage/supabase-reading-files", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/reading/storage/supabase-reading-files")
  >();
  return {
    ...actual,
    removeReadingFiles: vi.fn(),
    uploadReadingCoverFile: vi.fn(),
    uploadReadingOriginalFile: vi.fn(),
  };
});

const removeReadingFilesMock = vi.mocked(removeReadingFiles);
const uploadReadingCoverFileMock = vi.mocked(uploadReadingCoverFile);
const uploadReadingOriginalFileMock = vi.mocked(uploadReadingOriginalFile);

describe("reading asset repository", () => {
  beforeEach(() => {
    removeReadingFilesMock.mockReset();
    uploadReadingCoverFileMock.mockReset();
    uploadReadingOriginalFileMock.mockReset();
  });

  it("removes uploaded reading files when metadata writes fail", async () => {
    const insertError = new Error("metadata insert failed");
    const supabase = createReadingAssetSupabaseMock({ insertError });
    uploadReadingOriginalFileMock.mockResolvedValueOnce(
      "user/project/reading/original/asset.epub",
    );
    uploadReadingCoverFileMock.mockResolvedValueOnce(
      "user/project/reading/covers/asset.webp",
    );
    removeReadingFilesMock.mockResolvedValueOnce(undefined);

    await expect(
      createReadingAsset({
        bytes: Buffer.from("book"),
        coverBytes: Buffer.from("cover"),
        coverMimeType: "image/webp",
        fileName: "地师.epub",
        mimeType: "application/epub+zip",
        ownerId: "user-1",
        projectId: "project-1",
        supabase,
      }),
    ).rejects.toThrow("metadata insert failed");

    expect(removeReadingFilesMock).toHaveBeenCalledWith(supabase, [
      "user/project/reading/original/asset.epub",
      "user/project/reading/covers/asset.webp",
    ]);
  });

  it("preserves the original failure when reading file cleanup also fails", async () => {
    const coverError = new Error("cover upload failed");
    const cleanupError = new Error("cleanup failed");
    const supabase = createReadingAssetSupabaseMock();
    uploadReadingOriginalFileMock.mockResolvedValueOnce(
      "user/project/reading/original/asset.epub",
    );
    uploadReadingCoverFileMock.mockRejectedValueOnce(coverError);
    removeReadingFilesMock.mockRejectedValueOnce(cleanupError);

    await expect(
      createReadingAsset({
        bytes: Buffer.from("book"),
        coverBytes: Buffer.from("cover"),
        fileName: "地师.epub",
        ownerId: "user-1",
        projectId: "project-1",
        supabase,
      }),
    ).rejects.toThrow("cover upload failed");

    expect(removeReadingFilesMock).toHaveBeenCalledWith(supabase, [
      "user/project/reading/original/asset.epub",
      null,
    ]);
  });
});

function createReadingAssetSupabaseMock(input: { insertError?: Error } = {}) {
  const single = vi.fn().mockResolvedValue({
    data: null,
    error: input.insertError ?? null,
  });
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  return {
    from: vi.fn().mockReturnValue({ insert }),
  } as unknown as SupabaseClient;
}
