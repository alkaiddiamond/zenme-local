import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadProjectFileToApi } from "@/lib/zenme-api";

import { createDroppedFileCanvasNodes } from "./drop-files";
import { registerReadingAsset } from "./reading-assets";

vi.mock("@/lib/zenme-api", () => ({
  uploadProjectFileToApi: vi.fn(),
}));

vi.mock("./reading-assets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reading-assets")>();
  return {
    ...actual,
    createBookCoverPreview: vi.fn().mockResolvedValue(undefined),
    registerReadingAsset: vi.fn(),
  };
});

const uploadProjectFileMock = vi.mocked(uploadProjectFileToApi);
const registerReadingAssetMock = vi.mocked(registerReadingAsset);

describe("dropped file canvas nodes", () => {
  beforeEach(() => {
    uploadProjectFileMock.mockReset();
    registerReadingAssetMock.mockReset();
  });

  it("keeps book nodes when reading registration fails", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:local-book");
    const onReadingError = vi.fn();
    const file = new File(["book"], "地师.epub", {
      type: "application/epub+zip",
    });
    uploadProjectFileMock.mockResolvedValueOnce({
      fileId: "file-1",
      originalPath: "user/project/original/file.epub",
      originalUrl: "https://signed.example.test/book",
      previewPath: null,
    });
    registerReadingAssetMock.mockRejectedValueOnce(
      new Error("Invalid key: old/path/地师.epub"),
    );

    try {
      await expect(
        createDroppedFileCanvasNodes({
          files: [file],
          onReadingError,
          position: { x: 100, y: 200 },
          projectId: "project-1",
        }),
      ).resolves.toMatchObject([
        {
          position: { x: 100, y: 200 },
          type: "book",
          data: {
            fileId: "file-1",
            fileName: "地师.epub",
            kind: "book",
            originalUrl: "https://signed.example.test/book",
            readingError: "阅读资料存储路径无效，请重新上传文件",
            title: "地师.epub",
            uploadStatus: "uploaded",
          },
        },
      ]);
    } finally {
      createObjectUrl.mockRestore();
    }

    expect(registerReadingAssetMock).toHaveBeenCalledWith({
      cover: undefined,
      file,
      fileName: "地师.epub",
      nodeId: expect.any(String),
      projectId: "project-1",
    });
    expect(onReadingError).toHaveBeenCalledWith(
      "阅读资料登记失败：阅读资料存储路径无效，请重新上传文件",
    );
  });

  it("keeps ordinary reading registration errors visible on book nodes", async () => {
    const createObjectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:local-book");
    const onReadingError = vi.fn();
    const file = new File(["book"], "notes.epub", {
      type: "application/epub+zip",
    });
    uploadProjectFileMock.mockResolvedValueOnce({
      fileId: "file-1",
      originalPath: "user/project/original/file.txt",
      originalUrl: "https://signed.example.test/book",
      previewPath: null,
    });
    registerReadingAssetMock.mockRejectedValueOnce(
      new Error("不支持的阅读文件类型"),
    );

    try {
      await expect(
        createDroppedFileCanvasNodes({
          files: [file],
          onReadingError,
          position: { x: 100, y: 200 },
          projectId: "project-1",
        }),
      ).resolves.toMatchObject([
        {
          type: "book",
          data: {
            fileName: "notes.epub",
            readingError: "不支持的阅读文件类型",
          },
        },
      ]);
    } finally {
      createObjectUrl.mockRestore();
    }

    expect(registerReadingAssetMock).toHaveBeenCalledWith({
      cover: undefined,
      file,
      fileName: "notes.epub",
      nodeId: expect.any(String),
      projectId: "project-1",
    });
    expect(onReadingError).toHaveBeenCalledWith(
      "阅读资料登记失败：不支持的阅读文件类型",
    );
  });

  it("marks non-book file nodes as failed when project upload fails", async () => {
    const onReadingError = vi.fn();
    const file = new File(["plain"], "brief.txt.backup", {
      type: "text/plain",
    });
    uploadProjectFileMock.mockRejectedValueOnce(new Error("upload failed"));

    await expect(
      createDroppedFileCanvasNodes({
        files: [file],
        onReadingError,
        position: { x: 0, y: 0 },
        projectId: "project-1",
      }),
    ).resolves.toMatchObject([
      {
        type: "file",
        data: {
          fileId: undefined,
          fileName: "brief.txt.backup",
          kind: "file",
          originalUrl: undefined,
          uploadStatus: "failed",
        },
      },
    ]);
    expect(registerReadingAssetMock).not.toHaveBeenCalled();
    expect(onReadingError).not.toHaveBeenCalled();
  });
});
