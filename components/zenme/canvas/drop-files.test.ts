import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  referenceProjectFileInApi,
  uploadProjectFileToApi,
} from "@/lib/zenme-api";

import {
  createDroppedFileCanvasNodes,
  getDroppedFiles,
} from "./drop-files";
import { registerReadingAsset } from "./reading-assets";

vi.mock("@/lib/zenme-api", () => ({
  referenceProjectFileInApi: vi.fn(),
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
const referenceProjectFileMock = vi.mocked(referenceProjectFileInApi);
const registerReadingAssetMock = vi.mocked(registerReadingAsset);

describe("dropped file canvas nodes", () => {
  beforeEach(() => {
    uploadProjectFileMock.mockReset();
    referenceProjectFileMock.mockReset();
    registerReadingAssetMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("reads external TXT files from data-transfer items when files is empty", () => {
    const textFile = new File(["正文"], "长文.txt", {
      lastModified: 1,
      type: "text/plain",
    });

    expect(
      getDroppedFiles({
        files: [] as unknown as FileList,
        items: [
          {
            getAsFile: () => textFile,
            kind: "file",
            type: "text/plain",
          },
          {
            getAsFile: () => null,
            kind: "string",
            type: "text/plain",
          },
        ] as unknown as DataTransferItemList,
      }),
    ).toEqual([textFile]);
  });

  it("deduplicates files mirrored by data-transfer items and files", () => {
    const textFile = new File(["正文"], "长文.txt", {
      lastModified: 1,
      type: "text/plain",
    });

    expect(
      getDroppedFiles({
        files: [textFile] as unknown as FileList,
        items: [
          {
            getAsFile: () => textFile,
            kind: "file",
            type: "text/plain",
          },
        ] as unknown as DataTransferItemList,
      }),
    ).toEqual([textFile]);
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

  it("references desktop audio files without uploading a duplicate", async () => {
    const file = new File(["audio"], "张悬 - 喜欢.ogg", {
      type: "audio/ogg",
    });
    vi.stubGlobal("window", {
      zenmeDesktop: {
        getPathForFile: () => "G:\\Music\\张悬 - 喜欢.ogg",
      },
    });
    referenceProjectFileMock.mockResolvedValueOnce({
      externalPath: "G:\\Music\\张悬 - 喜欢.ogg",
      fileId: "external-audio-1",
      originalPath: "",
      originalUrl: "/api/projects/project-1/files/external-audio-1",
      previewPath: null,
    });

    await expect(
      createDroppedFileCanvasNodes({
        files: [file],
        onReadingError: vi.fn(),
        position: { x: 20, y: 30 },
        projectId: "project-1",
      }),
    ).resolves.toMatchObject([
      {
        type: "music",
        data: {
          fileId: "external-audio-1",
          kind: "music",
          originalUrl: "/api/projects/project-1/files/external-audio-1",
          uploadStatus: "uploaded",
        },
      },
    ]);
    expect(referenceProjectFileMock).toHaveBeenCalledWith({
      externalPath: "G:\\Music\\张悬 - 喜欢.ogg",
      fileName: "张悬 - 喜欢.ogg",
      mimeType: "audio/ogg",
      projectId: "project-1",
    });
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
  });

  it("creates one referenced folder node when a system directory is dropped", async () => {
    const directory = new File([], "我的音乐", { type: "" });
    vi.stubGlobal("window", {
      zenmeDesktop: {
        inspectMusicFolderForFile: async () => ({
          files: [
            { name: "第一首.ogg", path: "G:\\Music\\第一首.ogg", size: 10, type: "audio/ogg" },
            { name: "第二首.mp3", path: "G:\\Music\\第二首.mp3", size: 20, type: "audio/mpeg" },
          ],
          name: "我的音乐",
          path: "G:\\Music",
        }),
      },
    });
    referenceProjectFileMock
      .mockResolvedValueOnce({
        externalPath: "G:\\Music\\第一首.ogg",
        fileId: "file-1",
        originalPath: "",
        originalUrl: "/api/projects/project-1/files/file-1",
        previewPath: null,
      })
      .mockResolvedValueOnce({
        externalPath: "G:\\Music\\第二首.mp3",
        fileId: "file-2",
        originalPath: "",
        originalUrl: "/api/projects/project-1/files/file-2",
        previewPath: null,
      });

    await expect(createDroppedFileCanvasNodes({
      files: [directory],
      onReadingError: vi.fn(),
      position: { x: 20, y: 30 },
      projectId: "project-1",
    })).resolves.toMatchObject([{
      type: "musicFolder",
      data: {
        kind: "musicFolder",
        musicFolderMode: "system",
        musicFolderPath: "G:\\Music",
        musicFolderSources: [
          { fileId: "file-1", title: "第一首.ogg" },
          { fileId: "file-2", title: "第二首.mp3" },
        ],
        title: "我的音乐",
      },
    }]);
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
  });

  it("does not silently turn a system directory into a generic file when the folder bridge needs a restart", async () => {
    const onReadingError = vi.fn();
    const directory = new File([], "音乐", { type: "" });
    vi.stubGlobal("window", {
      zenmeDesktop: {
        getPathForFile: () => "G:\\Music",
      },
    });

    await expect(createDroppedFileCanvasNodes({
      files: [directory],
      onReadingError,
      position: { x: 20, y: 30 },
      projectId: "project-1",
    })).resolves.toEqual([]);
    expect(onReadingError).toHaveBeenCalledWith(
      "系统文件夹能力尚未加载，请完全重启桌面开发模式后重新拖入",
    );
    expect(referenceProjectFileMock).not.toHaveBeenCalled();
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
  });

  it("does not silently copy desktop audio when the path bridge needs a restart", async () => {
    const onReadingError = vi.fn();
    const file = new File(["audio"], "song.ogg", { type: "audio/ogg" });
    vi.stubGlobal("window", { zenmeDesktop: {} });

    await expect(
      createDroppedFileCanvasNodes({
        files: [file],
        onReadingError,
        position: { x: 0, y: 0 },
        projectId: "project-1",
      }),
    ).resolves.toMatchObject([
      {
        data: {
          fileId: undefined,
          kind: "music",
          uploadStatus: "failed",
        },
      },
    ]);
    expect(onReadingError).toHaveBeenCalledWith(
      "桌面文件路径能力尚未加载，请完全重启桌面开发模式后重试",
    );
    expect(referenceProjectFileMock).not.toHaveBeenCalled();
    expect(uploadProjectFileMock).not.toHaveBeenCalled();
  });
});
