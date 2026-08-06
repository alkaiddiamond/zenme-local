import { afterEach, describe, expect, it, vi } from "vitest";

import { READING_ASSET_FORMDATA_MAX_BYTES } from "@/lib/reading/limits";

import {
  prepareReadingAssetForCanvasNode,
  registerReadingAsset,
} from "./reading-assets";
import type { CanvasNode } from "./types";

function readingAsset(overrides: Partial<{ id: string; title: string }> = {}) {
  return {
    id: overrides.id ?? "asset-1",
    ownerId: "user-1",
    projectId: "project-1",
    title: overrides.title ?? "地师",
    fileName: "地师.epub",
    filePath: "user/project/reading/original/asset.epub",
    storagePath: "user/project/reading/original/asset.epub",
    format: "epub",
    createdAt: "2026-06-28T01:00:00.000Z",
    updatedAt: "2026-06-28T02:00:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function canvasNode(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
}): CanvasNode {
  return {
    id: input.id,
    position: { x: 0, y: 0 },
    type: "book",
    data: {
      kind: "book",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

function textCanvasNode(input: {
  plainText: string;
  textMode?: "code" | "markdown" | "plain";
}): CanvasNode {
  return {
    id: "text-node-1",
    position: { x: 0, y: 0 },
    type: "text",
    data: {
      kind: "text",
      plainText: input.plainText,
      textMode: input.textMode ?? "plain",
      title: "阅读笔记",
    },
  } as CanvasNode;
}

describe("reading asset client registration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers small reading assets with FormData and optional covers", async () => {
    const asset = readingAsset();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(asset));
    const file = new File(["book"], "地师.epub", {
      type: "application/epub+zip",
    });
    const cover = new Blob(["cover"], { type: "image/webp" });

    await expect(
      registerReadingAsset({
        cover,
        file,
        fileName: "地师.epub",
        nodeId: "node-1",
        projectId: "project-1",
      }),
    ).resolves.toEqual(asset);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/reading/assets",
      expect.objectContaining({
        body: expect.any(FormData),
        method: "POST",
      }),
    );
    const formData = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(formData.get("projectId")).toBe("project-1");
    expect(formData.get("nodeId")).toBe("node-1");
    expect(formData.get("fileSize")).toBe("4");
    expect(formData.get("file")).toBeInstanceOf(File);
    expect(formData.get("cover")).toBeInstanceOf(File);
  });

  it("uses binary upload for files above the FormData threshold", async () => {
    const asset = readingAsset({ id: "asset-large" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(asset));
    const file = new File(
      [new Uint8Array(READING_ASSET_FORMDATA_MAX_BYTES + 1)],
      "地师.epub",
      { type: "application/epub+zip" },
    );

    await expect(
      registerReadingAsset({
        file,
        fileName: "地师.epub",
        nodeId: "node-1",
        projectId: "project-1",
      }),
    ).resolves.toEqual(asset);

    expect(fetchMock).toHaveBeenCalledWith("/api/reading/assets", {
      body: file,
      headers: {
        "content-type": "application/octet-stream",
        "x-zenme-file-name": "%E5%9C%B0%E5%B8%88.epub",
        "x-zenme-file-size": String(READING_ASSET_FORMDATA_MAX_BYTES + 1),
        "x-zenme-node-id": "node-1",
        "x-zenme-project-id": "project-1",
      },
      method: "POST",
    });
  });

  it("falls back to binary upload when FormData parsing is unavailable upstream", async () => {
    const asset = readingAsset({ id: "asset-fallback" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ error: "FormData parser failed" }, 400))
      .mockResolvedValueOnce(jsonResponse(asset));
    const file = new File(["book"], "地师.epub", {
      type: "application/epub+zip",
    });

    await expect(
      registerReadingAsset({
        file,
        fileName: "地师.epub",
        nodeId: "node-1",
        projectId: "project-1",
      }),
    ).resolves.toEqual(asset);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      body: file,
      headers: expect.objectContaining({
        "content-type": "application/octet-stream",
        "x-zenme-file-name": "%E5%9C%B0%E5%B8%88.epub",
      }),
      method: "POST",
    });
  });

  it("returns null when preparing nodes without original file references", async () => {
    await expect(
      prepareReadingAssetForCanvasNode({
        node: canvasNode({
          data: { fileName: "地师.epub", originalUrl: undefined },
          id: "book-1",
        }),
        projectId: "project-1",
      }),
    ).resolves.toBeNull();
    await expect(
      prepareReadingAssetForCanvasNode({
        node: canvasNode({
          data: { fileName: undefined, originalUrl: "blob:book" },
          id: "book-1",
        }),
        projectId: "project-1",
      }),
    ).resolves.toBeNull();
  });

  it("throws when the original book file cannot be fetched before registration", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      prepareReadingAssetForCanvasNode({
        node: canvasNode({
          data: { fileName: "地师.epub", originalUrl: "blob:missing-book" },
          id: "book-1",
        }),
        projectId: "project-1",
      }),
    ).rejects.toThrow("无法读取原始图书文件");
  });

  it("fetches original book files and registers them with the node metadata", async () => {
    const asset = readingAsset({ id: "asset-prepared" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("book", {
          headers: { "content-type": "application/epub+zip" },
          status: 200,
        }),
      )
      .mockResolvedValueOnce(jsonResponse(asset));

    await expect(
      prepareReadingAssetForCanvasNode({
        node: canvasNode({
          data: {
            fileName: "地师.epub",
            mimeType: "application/epub+zip",
            originalUrl: "blob:book",
          },
          id: "book-node-1",
        }),
        projectId: "project-1",
      }),
    ).resolves.toEqual(asset);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "blob:book");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/reading/assets",
      expect.objectContaining({
        body: expect.any(FormData),
        method: "POST",
      }),
    );
    const formData = fetchMock.mock.calls[1][1]?.body as FormData;
    expect(formData.get("projectId")).toBe("project-1");
    expect(formData.get("nodeId")).toBe("book-node-1");
    expect(formData.get("fileSize")).toBe("4");
    const file = formData.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("地师.epub");
    expect((file as File).type).toBe("application/epub+zip");
  });

  it("registers Markdown text nodes as rendered reading assets", async () => {
    const asset = readingAsset({ id: "asset-markdown", title: "阅读笔记" });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(asset));

    await expect(
      prepareReadingAssetForCanvasNode({
        node: textCanvasNode({
          plainText: "# 标题\n\n正文 **重点**",
          textMode: "markdown",
        }),
        projectId: "project-1",
      }),
    ).resolves.toEqual(asset);

    const formData = fetchMock.mock.calls[0][1]?.body as FormData;
    const file = formData.get("file") as File;
    expect(file.name).toBe("阅读笔记.md");
    expect(file.type).toBe("text/markdown;charset=utf-8");
    await expect(file.text()).resolves.toBe("# 标题\n\n正文 **重点**");
  });

  it("does not create a reading asset for an empty text node", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      prepareReadingAssetForCanvasNode({
        node: textCanvasNode({ plainText: "   ", textMode: "markdown" }),
        projectId: "project-1",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
