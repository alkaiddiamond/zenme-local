import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as postAiChat } from "./ai/chat/route";
import { GET as getAiModels } from "./ai/models/route";
import { POST as postReadingAssets } from "./reading/assets/route";
import { GET as getReadingAsset } from "./reading/assets/[assetId]/route";
import { GET as getReadingAssetCover } from "./reading/assets/[assetId]/cover/route";
import { GET as getReadingEpubAsset } from "./reading/assets/[assetId]/epub-asset/route";
import { GET as getReadingAssetFile } from "./reading/assets/[assetId]/file/route";
import {
  GET as getReadingAssetNotes,
  PATCH as patchReadingAssetNotes,
  POST as postReadingAssetNotes,
} from "./reading/assets/[assetId]/notes/route";
import {
  GET as getReadingAssetProgress,
  PUT as putReadingAssetProgress,
} from "./reading/assets/[assetId]/progress/route";
import {
  DELETE as deleteReadingNote,
  PATCH as patchReadingNote,
} from "./reading/notes/[noteId]/route";
import { POST as postReadingOcr } from "./reading/ocr/route";
import { ApiAuthError } from "@/lib/supabase/auth";

vi.mock("@/lib/supabase/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/auth")>();
  return {
    ...actual,
    requireProjectAccess: vi.fn(),
    requireReadingAssetAccess: vi.fn(),
    requireReadingNoteAccess: vi.fn(),
    requireUser: vi.fn(),
  };
});

vi.mock("@/lib/reading/supabase-repository", () => ({
  createReadingAsset: vi.fn(),
  createReadingNote: vi.fn(),
  deleteReadingNote: vi.fn(),
  getReadingAsset: vi.fn(),
  getReadingAssetCover: vi.fn(),
  getReadingAssetFile: vi.fn(),
  getReadingEpubAsset: vi.fn(),
  getReadingProgress: vi.fn(),
  getReadingSections: vi.fn(),
  listReadingNotes: vi.fn(),
  reorderReadingNotes: vi.fn(),
  saveReadingProgress: vi.fn(),
  updateReadingNote: vi.fn(),
}));

vi.mock("@/lib/local-model-ocr", () => ({
  recognizeLocalModelOcr: vi.fn(),
}));

vi.mock("@/lib/tencent-cloud-ocr", () => ({
  recognizeTencentCloudOcr: vi.fn(),
}));

const authModule = await import("@/lib/supabase/auth");
const readingRepository = await import("@/lib/reading/supabase-repository");
const localOcr = await import("@/lib/local-model-ocr");
const tencentOcr = await import("@/lib/tencent-cloud-ocr");

const requireUserMock = vi.mocked(authModule.requireUser);
const requireProjectAccessMock = vi.mocked(authModule.requireProjectAccess);
const requireReadingAssetAccessMock = vi.mocked(
  authModule.requireReadingAssetAccess,
);
const requireReadingNoteAccessMock = vi.mocked(
  authModule.requireReadingNoteAccess,
);
const createReadingAssetMock = vi.mocked(readingRepository.createReadingAsset);
const createReadingNoteMock = vi.mocked(readingRepository.createReadingNote);
const deleteReadingNoteMock = vi.mocked(readingRepository.deleteReadingNote);
const getReadingAssetCoverMock = vi.mocked(readingRepository.getReadingAssetCover);
const getReadingAssetFileMock = vi.mocked(readingRepository.getReadingAssetFile);
const getReadingAssetMock = vi.mocked(readingRepository.getReadingAsset);
const getReadingEpubAssetMock = vi.mocked(readingRepository.getReadingEpubAsset);
const getReadingProgressMock = vi.mocked(readingRepository.getReadingProgress);
const getReadingSectionsMock = vi.mocked(readingRepository.getReadingSections);
const listReadingNotesMock = vi.mocked(readingRepository.listReadingNotes);
const reorderReadingNotesMock = vi.mocked(readingRepository.reorderReadingNotes);
const saveReadingProgressMock = vi.mocked(readingRepository.saveReadingProgress);
const updateReadingNoteMock = vi.mocked(readingRepository.updateReadingNote);
const readingRepositoryMocks = [
  createReadingAssetMock,
  createReadingNoteMock,
  deleteReadingNoteMock,
  getReadingAssetMock,
  getReadingAssetCoverMock,
  getReadingAssetFileMock,
  getReadingEpubAssetMock,
  getReadingProgressMock,
  getReadingSectionsMock,
  listReadingNotesMock,
  reorderReadingNotesMock,
  saveReadingProgressMock,
  updateReadingNoteMock,
];
const recognizeLocalModelOcrMock = vi.mocked(localOcr.recognizeLocalModelOcr);
const recognizeTencentCloudOcrMock = vi.mocked(
  tencentOcr.recognizeTencentCloudOcr,
);

describe("protected API routes", () => {
  beforeEach(() => {
    process.env.ZENME_STORAGE_DRIVER = "supabase";
    requireUserMock.mockReset();
    requireProjectAccessMock.mockReset();
    requireReadingAssetAccessMock.mockReset();
    requireReadingNoteAccessMock.mockReset();
    readingRepositoryMocks.forEach((mock) => mock.mockReset());
    recognizeLocalModelOcrMock.mockReset();
    recognizeTencentCloudOcrMock.mockReset();
    requireUserMock.mockRejectedValue(new ApiAuthError("请先登录", 401));
    requireReadingAssetAccessMock.mockRejectedValue(
      new ApiAuthError("请先登录", 401),
    );
    requireReadingNoteAccessMock.mockRejectedValue(
      new ApiAuthError("请先登录", 401),
    );
  });

  it("rejects unauthenticated AI model listing", async () => {
    const response = await getAiModels(new Request("https://example.test"));

    await expectUnauthorized(response);
  });

  it("rejects unauthenticated AI chat before reading the provider key", async () => {
    const previousApiKey = process.env.ZHIPU_API_KEY;
    delete process.env.ZHIPU_API_KEY;

    try {
      const response = await postAiChat(
        new Request("https://example.test", {
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
          }),
          method: "POST",
        }),
      );

      await expectUnauthorized(response);
    } finally {
      process.env.ZHIPU_API_KEY = previousApiKey;
    }
  });

  it("allows local desktop AI chat without Supabase auth", async () => {
    const previousStorageDriver = process.env.ZENME_STORAGE_DRIVER;
    const previousApiKey = process.env.ZHIPU_API_KEY;
    const previousFetch = global.fetch;
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: local\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    process.env.ZENME_STORAGE_DRIVER = "local";
    process.env.ZHIPU_API_KEY = "test-key";
    global.fetch = fetchMock;

    try {
      const response = await postAiChat(
        new Request("https://example.test", {
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
            model: "glm-4.5",
          }),
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toBe("data: local\n\n");
      expect(requireUserMock).not.toHaveBeenCalled();
    } finally {
      process.env.ZENME_STORAGE_DRIVER = previousStorageDriver;
      process.env.ZHIPU_API_KEY = previousApiKey;
      global.fetch = previousFetch;
    }
  });

  it("returns the allowed AI model list for authenticated users", async () => {
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);

    const response = await getAiModels(
      new Request("https://example.test", {
        headers: { "x-forwarded-for": "203.0.113.10" },
      }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: Array<{ id: string; label: string; object: string }>;
    };
    expect(payload.data.length).toBeGreaterThan(0);
    expect(payload.data).toContainEqual({
      id: "glm-4.5",
      label: "GLM 4.5",
      object: "model",
    });
    expect(payload.data).toContainEqual({
      id: "glm-5.2",
      label: "GLM 5.2",
      object: "model",
    });
  });

  it("redacts internal AI model listing errors", async () => {
    requireUserMock.mockRejectedValueOnce(new Error("internal model secret"));

    const response = await getAiModels(new Request("https://example.test"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "模型列表加载失败",
    });
  });

  it("streams authenticated AI chat requests to the configured provider", async () => {
    const previousApiKey = process.env.ZHIPU_API_KEY;
    const previousBaseUrl = process.env.ZHIPU_BASE_URL;
    const previousFetch = global.fetch;
    const upstreamBody = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(upstreamBody, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    process.env.ZHIPU_API_KEY = "test-key";
    process.env.ZHIPU_BASE_URL = "https://provider.example.test/v4";
    global.fetch = fetchMock;

    try {
      const response = await postAiChat(
        new Request("https://example.test", {
          body: JSON.stringify({
            context: "节点上下文",
            messages: [{ role: "user", content: "hello" }],
            model: "glm-4.5",
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.11",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/event-stream; charset=utf-8",
      );
      await expect(response.text()).resolves.toBe("data: hello\n\n");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://provider.example.test/v4/chat/completions",
        expect.objectContaining({
          body: expect.any(String),
          headers: expect.objectContaining({
            Authorization: "Bearer test-key",
            "Content-Type": "application/json",
          }),
          method: "POST",
        }),
      );
      const upstreamBodyPayload = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      ) as {
        messages: Array<{ content: string; role: string }>;
        model: string;
        stream: boolean;
      };
      expect(upstreamBodyPayload).toMatchObject({
        model: "glm-4.5",
        stream: true,
      });
      expect(upstreamBodyPayload.messages[0].role).toBe("system");
      expect(upstreamBodyPayload.messages[0].content).toContain("节点上下文");
      expect(upstreamBodyPayload.messages[1]).toEqual({
        role: "user",
        content: "hello",
      });
    } finally {
      process.env.ZHIPU_API_KEY = previousApiKey;
      process.env.ZHIPU_BASE_URL = previousBaseUrl;
      global.fetch = previousFetch;
    }
  });

  it("redacts provider details while reporting safe AI chat failure context", async () => {
    const previousApiKey = process.env.ZHIPU_API_KEY;
    const previousFetch = global.fetch;
    const fetchMock = vi.fn().mockResolvedValue(
      NextJsonResponse({ error: { message: "provider down" } }, 503),
    );
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    process.env.ZHIPU_API_KEY = "test-key";
    global.fetch = fetchMock;

    try {
      const response = await postAiChat(
        new Request("https://example.test", {
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: "Zhipu GLM 调用 glm-4.5 失败（503），服务商暂时不可用。",
      });
    } finally {
      process.env.ZHIPU_API_KEY = previousApiKey;
      global.fetch = previousFetch;
    }
  });

  it("redacts thrown AI provider failures", async () => {
    const previousApiKey = process.env.ZHIPU_API_KEY;
    const previousFetch = global.fetch;
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("provider secret stack"));
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    process.env.ZHIPU_API_KEY = "test-key";
    global.fetch = fetchMock;

    try {
      const response = await postAiChat(
        new Request("https://example.test", {
          body: JSON.stringify({
            messages: [{ role: "user", content: "hello" }],
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(502);
      await expect(response.json()).resolves.toEqual({
        error:
          "Zhipu GLM 调用 glm-4.5 失败，无法连接服务商，请检查接口地址或网络。",
      });
    } finally {
      process.env.ZHIPU_API_KEY = previousApiKey;
      global.fetch = previousFetch;
    }
  });

  it("rejects unauthenticated reading asset uploads before project access checks", async () => {
    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "text/plain" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": "book.txt",
          "x-zenme-file-size": "4",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    await expectUnauthorized(response);
    expect(requireProjectAccessMock).not.toHaveBeenCalled();
    expect(createReadingAssetMock).not.toHaveBeenCalled();
  });

  it("rejects reading asset uploads when the project is not visible to the user", async () => {
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockRejectedValueOnce(
      new ApiAuthError("项目不存在或无权访问", 404),
    );

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "text/plain" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": "book.txt",
          "x-zenme-file-size": "4",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "项目不存在或无权访问",
    });
    expect(createReadingAssetMock).not.toHaveBeenCalled();
  });

  it("registers binary reading asset uploads with decoded file names", async () => {
    const supabase = { from: vi.fn() };
    const asset = readingAsset();
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockResolvedValueOnce({ supabase } as never);
    createReadingAssetMock.mockResolvedValueOnce(asset);

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "application/octet-stream" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": encodeURIComponent("地师.epub"),
          "x-zenme-file-size": "4",
          "x-zenme-node-id": "node-1",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(asset);
    expect(requireProjectAccessMock).toHaveBeenCalledWith("project-1");
    expect(createReadingAssetMock).toHaveBeenCalledWith({
      bytes: Buffer.from("book"),
      fileName: "地师.epub",
      mimeType: "application/octet-stream",
      nodeId: "node-1",
      ownerId: "user-1",
      projectId: "project-1",
      supabase,
    });
  });

  it("rejects incomplete binary reading asset uploads before repository writes", async () => {
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockResolvedValueOnce({ supabase: {} } as never);

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "application/octet-stream" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": "book.txt",
          "x-zenme-file-size": "8",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "图书文件接收不完整：收到 4 字节，应为 8 字节",
    });
    expect(createReadingAssetMock).not.toHaveBeenCalled();
  });

  it("rejects malformed binary reading asset file-name headers before repository writes", async () => {
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockResolvedValueOnce({ supabase: {} } as never);

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "application/octet-stream" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": "%E5%A",
          "x-zenme-file-size": "4",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "文件名编码无效",
    });
    expect(requireProjectAccessMock).not.toHaveBeenCalled();
    expect(createReadingAssetMock).not.toHaveBeenCalled();
  });

  it("redacts Supabase Storage invalid-key paths from reading asset upload errors", async () => {
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockResolvedValueOnce({ supabase: {} } as never);
    createReadingAssetMock.mockRejectedValueOnce(
      new Error(
        "Invalid key: user-1/project-1/reading/original/asset-1-地师.epub",
      ),
    );

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "application/octet-stream" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": encodeURIComponent("地师.epub"),
          "x-zenme-file-size": "4",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "阅读资料存储路径无效，请重新上传文件",
    });
  });

  it("redacts generic reading asset repository upload errors", async () => {
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockResolvedValueOnce({ supabase: {} } as never);
    createReadingAssetMock.mockRejectedValueOnce(
      new Error("database host internal.example leaked"),
    );

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: new Blob(["book"], { type: "application/octet-stream" }),
        headers: {
          "content-type": "application/octet-stream",
          "x-zenme-file-name": encodeURIComponent("地师.epub"),
          "x-zenme-file-size": "4",
          "x-zenme-project-id": "project-1",
        },
        method: "POST",
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "阅读资料登记失败",
    });
  });

  it("validates FormData reading asset uploads before repository writes", async () => {
    requireUserMock.mockResolvedValue({
      supabase: {},
      user: { id: "user-1" },
    } as never);

    const missingFileResponse = await postReadingAssets(
      new Request("https://example.test", {
        body: new FormData(),
        method: "POST",
      }),
    );
    expect(missingFileResponse.status).toBe(400);
    await expect(missingFileResponse.json()).resolves.toEqual({
      error: "缺少图书文件",
    });

    const missingProjectForm = new FormData();
    missingProjectForm.set("file", new File(["book"], "book.txt", { type: "text/plain" }));
    const missingProjectResponse = await postReadingAssets(
      new Request("https://example.test", {
        body: missingProjectForm,
        method: "POST",
      }),
    );
    expect(missingProjectResponse.status).toBe(400);
    await expect(missingProjectResponse.json()).resolves.toEqual({
      error: "缺少 projectId",
    });
    expect(requireProjectAccessMock).not.toHaveBeenCalled();
    expect(createReadingAssetMock).not.toHaveBeenCalled();
  });

  it("registers FormData reading asset uploads with optional covers", async () => {
    const supabase = { from: vi.fn() };
    const asset = readingAsset();
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    requireProjectAccessMock.mockResolvedValueOnce({ supabase } as never);
    createReadingAssetMock.mockResolvedValueOnce(asset);

    const formData = new FormData();
    formData.set("projectId", "project-1");
    formData.set("nodeId", "node-1");
    formData.set("fileSize", "4");
    formData.set("file", new File(["book"], "地师.epub", { type: "application/epub+zip" }));
    formData.set("cover", new File(["png"], "cover.png", { type: "image/png" }));

    const response = await postReadingAssets(
      new Request("https://example.test", {
        body: formData,
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(asset);
    expect(createReadingAssetMock).toHaveBeenCalledWith({
      bytes: Buffer.from("book"),
      coverBytes: Buffer.from("png"),
      coverMimeType: "image/png",
      fileName: "地师.epub",
      mimeType: "application/epub+zip",
      nodeId: "node-1",
      ownerId: "user-1",
      projectId: "project-1",
      supabase,
    });
  });

  it("rejects unauthenticated OCR before provider calls", async () => {
    const response = await postReadingOcr(
      new Request("https://example.test", {
        body: JSON.stringify({ imageBase64: "abc" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );

    await expectUnauthorized(response);
    expect(recognizeLocalModelOcrMock).not.toHaveBeenCalled();
    expect(recognizeTencentCloudOcrMock).not.toHaveBeenCalled();
  });

  it("runs authenticated OCR with the local model provider and cleans CJK spacing", async () => {
    const previousProvider = process.env.READING_OCR_PROVIDER;
    const previousAllowedProviders = process.env.READING_OCR_ALLOWED_PROVIDERS;
    process.env.READING_OCR_PROVIDER = "local-model";
    process.env.READING_OCR_ALLOWED_PROVIDERS = "local-model";
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    recognizeLocalModelOcrMock.mockResolvedValueOnce({
      text: "你 好   world\n\n\n下一 行  ",
      textDetections: [{ text: "你好" }],
    } as never);

    try {
      const response = await postReadingOcr(
        new Request("https://example.test", {
          body: JSON.stringify({
            imageBase64: "data:image/png;base64,abc123",
            provider: "local-model",
          }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.12",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        provider: "local-model",
        text: "你好 world\n\n下一行",
        textDetections: [{ text: "你好" }],
      });
      expect(recognizeLocalModelOcrMock).toHaveBeenCalledWith("abc123");
      expect(recognizeTencentCloudOcrMock).not.toHaveBeenCalled();
    } finally {
      process.env.READING_OCR_PROVIDER = previousProvider;
      process.env.READING_OCR_ALLOWED_PROVIDERS = previousAllowedProviders;
    }
  });

  it("runs authenticated OCR with the Tencent provider when allowed", async () => {
    const previousProvider = process.env.READING_OCR_PROVIDER;
    const previousAllowedProviders = process.env.READING_OCR_ALLOWED_PROVIDERS;
    process.env.READING_OCR_PROVIDER = "local-model";
    process.env.READING_OCR_ALLOWED_PROVIDERS = "local-model,tencent";
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    recognizeTencentCloudOcrMock.mockResolvedValueOnce({
      text: "腾讯 OCR",
      textDetections: [],
    } as never);

    try {
      const response = await postReadingOcr(
        new Request("https://example.test", {
          body: JSON.stringify({
            action: "GeneralBasicOCR",
            imageBase64: "abc123",
            provider: "tencent",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        provider: "tencent",
        text: "腾讯 OCR",
        textDetections: [],
      });
      expect(recognizeTencentCloudOcrMock).toHaveBeenCalledWith({
        action: "GeneralBasicOCR",
        imageBase64: "abc123",
      });
      expect(recognizeLocalModelOcrMock).not.toHaveBeenCalled();
    } finally {
      process.env.READING_OCR_PROVIDER = previousProvider;
      process.env.READING_OCR_ALLOWED_PROVIDERS = previousAllowedProviders;
    }
  });

  it("redacts OCR provider failures", async () => {
    const previousProvider = process.env.READING_OCR_PROVIDER;
    const previousAllowedProviders = process.env.READING_OCR_ALLOWED_PROVIDERS;
    process.env.READING_OCR_PROVIDER = "local-model";
    process.env.READING_OCR_ALLOWED_PROVIDERS = "local-model";
    requireUserMock.mockResolvedValueOnce({
      supabase: {},
      user: { id: "user-1" },
    } as never);
    recognizeLocalModelOcrMock.mockRejectedValueOnce(
      new Error("缺少 OCR 语言包：C:/secret/tessdata/chi_sim.traineddata"),
    );

    try {
      const response = await postReadingOcr(
        new Request("https://example.test", {
          body: JSON.stringify({
            imageBase64: "abc123",
            provider: "local-model",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "OCR 识别失败，请稍后重试",
      });
    } finally {
      process.env.READING_OCR_PROVIDER = previousProvider;
      process.env.READING_OCR_ALLOWED_PROVIDERS = previousAllowedProviders;
    }
  });

  it.each([
    [
      "reading asset payload",
      () =>
        getReadingAsset(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading asset file",
      () =>
        getReadingAssetFile(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading asset cover",
      () =>
        getReadingAssetCover(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading EPUB inner asset",
      () =>
        getReadingEpubAsset(
          new Request("https://example.test?path=OPS/chapter.xhtml"),
          assetParams(),
        ),
    ],
    [
      "reading asset notes list",
      () =>
        getReadingAssetNotes(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading asset note creation",
      () =>
        postReadingAssetNotes(jsonRequest({ selectedText: "quote" }), assetParams()),
    ],
    [
      "reading asset note reorder",
      () =>
        patchReadingAssetNotes(jsonRequest({ noteIds: ["note-1"] }), assetParams()),
    ],
    [
      "reading progress read",
      () =>
        getReadingAssetProgress(
          new Request("https://example.test"),
          assetParams(),
        ),
    ],
    [
      "reading progress save",
      () =>
        putReadingAssetProgress(jsonRequest({ scrollRatio: 0.5 }), assetParams()),
    ],
    [
      "reading note update",
      () =>
        patchReadingNote(jsonRequest({ comment: "updated" }), noteParams()),
    ],
    [
      "reading note delete",
      () =>
        deleteReadingNote(new Request("https://example.test"), noteParams()),
    ],
  ])("rejects unauthenticated %s before repository access", async (_name, callRoute) => {
    const response = await callRoute();

    await expectUnauthorized(response);
    expectRepositoryNotCalled();
  });

  it.each([
    [
      "reading asset payload",
      () =>
        getReadingAsset(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading asset file",
      () =>
        getReadingAssetFile(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading asset cover",
      () =>
        getReadingAssetCover(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading EPUB inner asset",
      () =>
        getReadingEpubAsset(
          new Request("https://example.test?path=OPS/chapter.xhtml"),
          assetParams(),
        ),
    ],
    [
      "reading asset notes list",
      () =>
        getReadingAssetNotes(new Request("https://example.test"), assetParams()),
    ],
    [
      "reading asset note creation",
      () =>
        postReadingAssetNotes(jsonRequest({ selectedText: "quote" }), assetParams()),
    ],
    [
      "reading asset note reorder",
      () =>
        patchReadingAssetNotes(jsonRequest({ noteIds: ["note-1"] }), assetParams()),
    ],
    [
      "reading progress read",
      () =>
        getReadingAssetProgress(
          new Request("https://example.test"),
          assetParams(),
        ),
    ],
    [
      "reading progress save",
      () =>
        putReadingAssetProgress(jsonRequest({ scrollRatio: 0.5 }), assetParams()),
    ],
  ])("rejects %s when the asset is not visible to the user", async (_name, callRoute) => {
    requireReadingAssetAccessMock.mockRejectedValueOnce(
      new ApiAuthError("阅读资料不存在", 404),
    );

    const response = await callRoute();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "阅读资料不存在" });
    expectRepositoryNotCalled();
  });

  it.each([
    [
      "reading note update",
      () =>
        patchReadingNote(jsonRequest({ comment: "updated" }), noteParams()),
    ],
    [
      "reading note delete",
      () =>
        deleteReadingNote(new Request("https://example.test"), noteParams()),
    ],
  ])("rejects %s when the note is not visible to the user", async (_name, callRoute) => {
    requireReadingNoteAccessMock.mockRejectedValueOnce(
      new ApiAuthError("笔记不存在", 404),
    );

    const response = await callRoute();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "笔记不存在" });
    expectRepositoryNotCalled();
  });

  it("returns the reading asset payload when the asset is visible", async () => {
    const supabase = { from: vi.fn() };
    const asset = readingAsset();
    const sections = [{ html: "<p>正文</p>", index: 0, text: "正文", title: "正文" }];
    const notes = [readingNote()];
    const progress = readingProgress();
    requireReadingAssetAccessMock.mockResolvedValueOnce({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);
    getReadingAssetMock.mockResolvedValueOnce(asset);
    getReadingSectionsMock.mockResolvedValueOnce(sections);
    listReadingNotesMock.mockResolvedValueOnce(notes);
    getReadingProgressMock.mockResolvedValueOnce(progress);

    const response = await getReadingAsset(
      new Request("https://example.test"),
      assetParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      asset,
      notes,
      progress,
      sections,
    });
    expect(getReadingAssetMock).toHaveBeenCalledWith(supabase, "asset-1");
    expect(getReadingSectionsMock).toHaveBeenCalledWith(supabase, "asset-1");
    expect(listReadingNotesMock).toHaveBeenCalledWith(supabase, "asset-1");
    expect(getReadingProgressMock).toHaveBeenCalledWith(supabase, "asset-1");
  });

  it("returns reading files with inline UTF-8 filename headers", async () => {
    const supabase = { from: vi.fn() };
    requireReadingAssetAccessMock.mockResolvedValueOnce({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);
    getReadingAssetFileMock.mockResolvedValueOnce({
      bytes: Buffer.from("book"),
      fileName: "地师.epub",
      format: "epub",
      mimeType: "application/epub+zip",
    });

    const response = await getReadingAssetFile(
      new Request("https://example.test"),
      assetParams(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/epub+zip");
    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''%E5%9C%B0%E5%B8%88.epub",
    );
    await expect(response.text()).resolves.toBe("book");
    expect(getReadingAssetFileMock).toHaveBeenCalledWith(supabase, "asset-1");
  });

  it("returns 404 when an authorized reading file or cover is missing", async () => {
    requireReadingAssetAccessMock.mockResolvedValue({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase: {},
      user: { id: "user-1" },
    } as never);
    getReadingAssetFileMock.mockResolvedValueOnce(null);
    getReadingAssetCoverMock.mockResolvedValueOnce(null);

    const fileResponse = await getReadingAssetFile(
      new Request("https://example.test"),
      assetParams(),
    );
    const coverResponse = await getReadingAssetCover(
      new Request("https://example.test"),
      assetParams(),
    );

    expect(fileResponse.status).toBe(404);
    await expect(fileResponse.json()).resolves.toEqual({ error: "文件不存在" });
    expect(coverResponse.status).toBe(404);
    await expect(coverResponse.json()).resolves.toEqual({
      error: "阅读资料封面不存在",
    });
  });

  it("redacts storage paths from authorized reading file read failures", async () => {
    requireReadingAssetAccessMock.mockResolvedValueOnce({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase: {},
      user: { id: "user-1" },
    } as never);
    getReadingAssetFileMock.mockRejectedValueOnce(
      new Error(
        "Object e42f7dfb-72cc-4042-aa20-731adc4263ba/bebae9e5-24db-45a9-88aa-43dc79816c5a/reading/original/46420b32-dd19-4801-ad06-44b2c0c3eb0c.epub is missing",
      ),
    );

    const response = await getReadingAssetFile(
      new Request("https://example.test"),
      assetParams(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "文件读取失败" });
  });

  it("returns reading covers with immutable cache headers", async () => {
    const supabase = { from: vi.fn() };
    requireReadingAssetAccessMock.mockResolvedValueOnce({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);
    getReadingAssetCoverMock.mockResolvedValueOnce({
      bytes: Buffer.from([1, 2, 3]),
      mimeType: "image/png",
    });

    const response = await getReadingAssetCover(
      new Request("https://example.test"),
      assetParams(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    await expect(response.arrayBuffer()).resolves.toEqual(
      Uint8Array.from([1, 2, 3]).buffer,
    );
    expect(getReadingAssetCoverMock).toHaveBeenCalledWith(supabase, "asset-1");
  });

  it("returns EPUB inner assets only when a path exists and the resource is found", async () => {
    const supabase = { from: vi.fn() };
    requireReadingAssetAccessMock.mockResolvedValue({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);

    const missingPathResponse = await getReadingEpubAsset(
      new Request("https://example.test"),
      assetParams(),
    );
    expect(missingPathResponse.status).toBe(404);
    await expect(missingPathResponse.json()).resolves.toEqual({
      error: "资源不存在",
    });
    expect(getReadingEpubAssetMock).not.toHaveBeenCalled();

    getReadingEpubAssetMock.mockResolvedValueOnce(null);
    const missingResourceResponse = await getReadingEpubAsset(
      new Request("https://example.test?path=OPS/missing.css"),
      assetParams(),
    );
    expect(missingResourceResponse.status).toBe(404);
    await expect(missingResourceResponse.json()).resolves.toEqual({
      error: "资源不存在",
    });

    getReadingEpubAssetMock.mockResolvedValueOnce({
      bytes: Buffer.from("body{}"),
      mimeType: "text/css",
    });
    const response = await getReadingEpubAsset(
      new Request("https://example.test?path=OPS/style.css"),
      assetParams(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/css");
    await expect(response.text()).resolves.toBe("body{}");
    expect(getReadingEpubAssetMock).toHaveBeenLastCalledWith({
      assetId: "asset-1",
      assetPath: "OPS/style.css",
      supabase,
    });
  });

  it("saves reading progress using current values as fallbacks for invalid input", async () => {
    const supabase = { from: vi.fn() };
    const saved = readingProgress({ contentScale: 1.2, sectionIndex: 4, scrollRatio: 0.25 });
    requireReadingAssetAccessMock.mockResolvedValueOnce({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);
    getReadingProgressMock.mockResolvedValueOnce(
      readingProgress({ contentScale: 1.2, sectionIndex: 4, scrollRatio: 0.25 }),
    );
    saveReadingProgressMock.mockResolvedValueOnce(saved);

    const response = await putReadingAssetProgress(
      jsonRequest({
        contentScale: Number.NaN,
        sectionIndex: Number.NaN,
        scrollRatio: Number.NaN,
      }),
      assetParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(saved);
    expect(saveReadingProgressMock).toHaveBeenCalledWith(supabase, {
      assetId: "asset-1",
      contentScale: 1.2,
      ownerId: "user-1",
      projectId: "project-1",
      scrollRatio: 0.25,
      sectionIndex: 4,
    });
  });

  it("creates reading notes only when the body matches the asset project", async () => {
    const supabase = { from: vi.fn() };
    const note = readingNote();
    requireReadingAssetAccessMock.mockResolvedValue({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);

    const mismatchResponse = await postReadingAssetNotes(
      jsonRequest({
        projectId: "project-2",
        selectedText: "quote",
      }),
      assetParams(),
    );

    expect(mismatchResponse.status).toBe(400);
    await expect(mismatchResponse.json()).resolves.toEqual({
      error: "项目与阅读资料不匹配",
    });
    expect(createReadingNoteMock).not.toHaveBeenCalled();

    createReadingNoteMock.mockResolvedValueOnce(note);
    const response = await postReadingAssetNotes(
      jsonRequest({
        chapterTitle: "第一章",
        color: "blue",
        comment: "comment",
        length: 5,
        offset: 2,
        projectId: "project-1",
        sectionIndex: 3,
        selectedText: "quote",
        type: "underline",
      }),
      assetParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(note);
    expect(createReadingNoteMock).toHaveBeenCalledWith(supabase, {
      assetId: "asset-1",
      chapterTitle: "第一章",
      color: "blue",
      comment: "comment",
      length: 5,
      offset: 2,
      ownerId: "user-1",
      projectId: "project-1",
      rect: undefined,
      sectionIndex: 3,
      selectedText: "quote",
      type: "underline",
    });
  });

  it("validates and normalizes reading note creation payloads before repository writes", async () => {
    const supabase = { from: vi.fn() };
    const note = readingNote();
    requireReadingAssetAccessMock.mockResolvedValue({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);

    const invalidResponse = await postReadingAssetNotes(
      jsonRequest({
        projectId: "project-1",
        selectedText: { text: "quote" },
      }),
      assetParams(),
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: "缺少笔记内容",
    });
    expect(createReadingNoteMock).not.toHaveBeenCalled();

    createReadingNoteMock.mockResolvedValueOnce(note);
    const response = await postReadingAssetNotes(
      jsonRequest({
        chapterTitle: "  第一章  ",
        color: "cyan",
        comment: "comment",
        length: 5.9,
        offset: -2,
        projectId: " project-1 ",
        rect: { h: 0.4, w: 2, x: -1, y: 0.2 },
        sectionIndex: 3.8,
        selectedText: "  quote  ",
        type: "marker",
      }),
      assetParams(),
    );

    expect(response.status).toBe(200);
    expect(createReadingNoteMock).toHaveBeenCalledWith(supabase, {
      assetId: "asset-1",
      chapterTitle: "第一章",
      color: undefined,
      comment: "comment",
      length: 5,
      offset: 0,
      ownerId: "user-1",
      projectId: "project-1",
      rect: { h: 0.4, w: 1, x: 0, y: 0.2 },
      sectionIndex: 3,
      selectedText: "quote",
      type: undefined,
    });
  });

  it("validates and deduplicates reading note order updates", async () => {
    const supabase = { from: vi.fn() };
    const orderedNotes = [readingNote({ id: "note-1" }), readingNote({ id: "note-2" })];
    requireReadingAssetAccessMock.mockResolvedValue({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);

    const invalidResponse = await patchReadingAssetNotes(
      jsonRequest({ noteIds: ["note-1", 42] }),
      assetParams(),
    );
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: "笔记顺序格式无效",
    });
    expect(reorderReadingNotesMock).not.toHaveBeenCalled();

    reorderReadingNotesMock.mockResolvedValueOnce(orderedNotes);
    const response = await patchReadingAssetNotes(
      jsonRequest({ noteIds: ["note-1", "note-1", "note-2"] }),
      assetParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(orderedNotes);
    expect(reorderReadingNotesMock).toHaveBeenCalledWith(supabase, "asset-1", [
      "note-1",
      "note-2",
    ]);
  });

  it("redacts reading asset note and progress repository failures", async () => {
    const supabase = {};
    requireReadingAssetAccessMock.mockResolvedValue({
      asset: { id: "asset-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);
    listReadingNotesMock.mockRejectedValueOnce(
      new Error("database host internal.example leaked"),
    );
    createReadingNoteMock.mockRejectedValueOnce(
      new Error("insert failed with row policy details"),
    );
    reorderReadingNotesMock.mockRejectedValueOnce(
      new Error("sort_order constraint details"),
    );
    getReadingProgressMock
      .mockRejectedValueOnce(new Error("progress select failed"))
      .mockResolvedValueOnce(null);
    saveReadingProgressMock.mockRejectedValueOnce(
      new Error("progress upsert failed"),
    );

    const notesResponse = await getReadingAssetNotes(
      new Request("https://example.test"),
      assetParams(),
    );
    const createResponse = await postReadingAssetNotes(
      jsonRequest({
        projectId: "project-1",
        selectedText: "quote",
      }),
      assetParams(),
    );
    const reorderResponse = await patchReadingAssetNotes(
      jsonRequest({ noteIds: ["note-1"] }),
      assetParams(),
    );
    const progressResponse = await getReadingAssetProgress(
      new Request("https://example.test"),
      assetParams(),
    );
    const progressSaveResponse = await putReadingAssetProgress(
      jsonRequest({ scrollRatio: 0.4 }),
      assetParams(),
    );

    expect(notesResponse.status).toBe(500);
    await expect(notesResponse.json()).resolves.toEqual({
      error: "笔记加载失败",
    });
    expect(createResponse.status).toBe(500);
    await expect(createResponse.json()).resolves.toEqual({
      error: "笔记保存失败",
    });
    expect(reorderResponse.status).toBe(500);
    await expect(reorderResponse.json()).resolves.toEqual({
      error: "笔记顺序保存失败",
    });
    expect(progressResponse.status).toBe(500);
    await expect(progressResponse.json()).resolves.toEqual({
      error: "阅读进度加载失败",
    });
    expect(progressSaveResponse.status).toBe(500);
    await expect(progressSaveResponse.json()).resolves.toEqual({
      error: "阅读进度保存失败",
    });
  });

  it("returns 404 when an authorized note update or delete affects no row", async () => {
    requireReadingNoteAccessMock.mockResolvedValue({
      note: { id: "note-1", owner_id: "user-1", project_id: "project-1" },
      supabase: {},
      user: { id: "user-1" },
    } as never);
    updateReadingNoteMock.mockResolvedValueOnce(null);
    deleteReadingNoteMock.mockResolvedValueOnce(false);

    const updateResponse = await patchReadingNote(
      jsonRequest({ comment: "updated" }),
      noteParams(),
    );
    const deleteResponse = await deleteReadingNote(
      new Request("https://example.test"),
      noteParams(),
    );

    expect(updateResponse.status).toBe(404);
    await expect(updateResponse.json()).resolves.toEqual({ error: "笔记不存在" });
    expect(deleteResponse.status).toBe(404);
    await expect(deleteResponse.json()).resolves.toEqual({ error: "笔记不存在" });
  });

  it("validates and normalizes reading note update payloads before repository writes", async () => {
    const supabase = {};
    requireReadingNoteAccessMock.mockResolvedValue({
      note: { id: "note-1", owner_id: "user-1", project_id: "project-1" },
      supabase,
      user: { id: "user-1" },
    } as never);

    const invalidResponse = await patchReadingNote(
      jsonRequest({
        color: "cyan",
        selectedText: "   ",
        type: "marker",
      }),
      noteParams(),
    );

    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toEqual({
      error: "缺少可更新的笔记内容",
    });
    expect(updateReadingNoteMock).not.toHaveBeenCalled();

    updateReadingNoteMock.mockResolvedValueOnce(
      readingNote({ id: "note-1", selectedText: "摘录" }),
    );
    const response = await patchReadingNote(
      jsonRequest({
        color: "purple",
        comment: "comment",
        selectedText: "  摘录  ",
        type: "note",
      }),
      noteParams(),
    );

    expect(response.status).toBe(200);
    expect(updateReadingNoteMock).toHaveBeenCalledWith(supabase, "note-1", {
      color: "purple",
      comment: "comment",
      selectedText: "摘录",
      type: "note",
    });
  });

  it("redacts single reading note repository failures", async () => {
    requireReadingNoteAccessMock.mockResolvedValue({
      note: { id: "note-1", owner_id: "user-1", project_id: "project-1" },
      supabase: {},
      user: { id: "user-1" },
    } as never);
    updateReadingNoteMock.mockRejectedValueOnce(
      new Error("note update database details"),
    );
    deleteReadingNoteMock.mockRejectedValueOnce(
      new Error("note delete database details"),
    );

    const updateResponse = await patchReadingNote(
      jsonRequest({ comment: "updated" }),
      noteParams(),
    );
    const deleteResponse = await deleteReadingNote(
      new Request("https://example.test"),
      noteParams(),
    );

    expect(updateResponse.status).toBe(500);
    await expect(updateResponse.json()).resolves.toEqual({
      error: "笔记保存失败",
    });
    expect(deleteResponse.status).toBe(500);
    await expect(deleteResponse.json()).resolves.toEqual({
      error: "笔记删除失败",
    });
  });
});

async function expectUnauthorized(response: Response) {
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: "请先登录" });
}

function assetParams() {
  return { params: Promise.resolve({ assetId: "asset-1" }) };
}

function noteParams() {
  return { params: Promise.resolve({ noteId: "note-1" }) };
}

function jsonRequest(body: unknown) {
  return new Request("https://example.test", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

function NextJsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function expectRepositoryNotCalled() {
  readingRepositoryMocks.forEach((mock) => expect(mock).not.toHaveBeenCalled());
  expect(requireProjectAccessMock).not.toHaveBeenCalled();
}

function readingAsset() {
  return {
    id: "asset-1",
    ownerId: "user-1",
    projectId: "project-1",
    nodeId: "node-1",
    title: "地师",
    author: null,
    format: "epub",
    fileName: "地师.epub",
    filePath: "user/project/reading/original/asset.epub",
    storagePath: "user/project/reading/original/asset.epub",
    coverPath: null,
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T02:00:00.000Z",
  };
}

function readingNote(
  overrides: Partial<{
    id: string;
    selectedText: string;
  }> = {},
) {
  return {
    id: overrides.id ?? "note-1",
    assetId: "asset-1",
    ownerId: "user-1",
    projectId: "project-1",
    selectedText: overrides.selectedText ?? "quote",
    comment: "comment",
    sectionIndex: 3,
    chapterTitle: "第一章",
    color: "blue",
    type: "underline",
    offset: 2,
    length: 5,
    rect: null,
    sortOrder: 0,
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T02:00:00.000Z",
  };
}

function readingProgress(
  overrides: Partial<{
    contentScale: number;
    sectionIndex: number;
    scrollRatio: number;
  }> = {},
) {
  return {
    assetId: "asset-1",
    ownerId: "user-1",
    contentScale: overrides.contentScale ?? 1,
    sectionIndex: overrides.sectionIndex ?? 0,
    scrollRatio: overrides.scrollRatio ?? 0,
    updatedAt: "2026-06-28T02:00:00.000Z",
  };
}
