import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheReadingProgress,
  createPdfReadingAnnotation,
  createReadingNote,
  loadReadingPayload,
  readCachedReadingProgress,
  recognizePdfAnnotationDraft,
  saveReadingProgress,
  saveReadingNoteOrder,
  updateReadingNote,
} from "@/components/zenme/reading/api";

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

function installWindowMock() {
  const store = new Map<string, string>();
  const windowMock = {
    clearTimeout,
    localStorage: {
      getItem: vi.fn((key: string) => store.get(key) ?? null),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, value);
      }),
    },
    setTimeout,
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
    writable: true,
  });

  return { store, windowMock };
}

function uninstallWindowMock() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: originalWindow,
    writable: true,
  });
}

function readingProgress(overrides: Partial<{
  assetId: string;
  contentScale: number;
  scrollRatio: number;
  sectionIndex: number;
  updatedAt: string;
}> = {}) {
  return {
    assetId: overrides.assetId ?? "asset-1",
    contentScale: overrides.contentScale ?? 1,
    scrollRatio: overrides.scrollRatio ?? 0.25,
    sectionIndex: overrides.sectionIndex ?? 2,
    updatedAt: overrides.updatedAt ?? "2026-06-28T01:00:00.000Z",
  };
}

function getJsonFetchBody(callIndex: number) {
  const request = vi.mocked(fetch).mock.calls[callIndex]?.[1];
  if (!request || typeof request !== "object" || !("body" in request)) {
    throw new Error("Missing fetch request body");
  }

  return JSON.parse(String(request.body)) as unknown;
}

describe("reading browser api progress cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T12:00:00.000Z"));
    globalThis.fetch = vi.fn() as never;
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallWindowMock();
    globalThis.fetch = originalFetch;
  });

  it("returns null when reading cached progress outside the browser", () => {
    uninstallWindowMock();

    expect(readCachedReadingProgress("asset-1")).toBeNull();
  });

  it("writes and reads cached progress with clamped scroll ratio", () => {
    installWindowMock();

    cacheReadingProgress({
      assetId: "asset-1",
      contentScale: 1.2,
      scrollRatio: 1.5,
      sectionIndex: 3,
    });

    expect(readCachedReadingProgress("asset-1")).toEqual({
      assetId: "asset-1",
      contentScale: 1.2,
      scrollRatio: 1,
      sectionIndex: 3,
      updatedAt: "2026-06-28T12:00:00.000Z",
    });
  });

  it("ignores malformed or mismatched cached progress", () => {
    const { store } = installWindowMock();
    store.set("zenme:reading-progress:asset-1", "{not json");
    expect(readCachedReadingProgress("asset-1")).toBeNull();

    store.set(
      "zenme:reading-progress:asset-1",
      JSON.stringify(readingProgress({ assetId: "asset-2" })),
    );
    expect(readCachedReadingProgress("asset-1")).toBeNull();
  });

  it("loads reading payload with cached progress preferred over server progress", async () => {
    installWindowMock();
    cacheReadingProgress(
      readingProgress({
        scrollRatio: 0.75,
        sectionIndex: 8,
        updatedAt: "2026-06-28T12:00:00.000Z",
      }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          asset: { id: "asset-1", format: "txt", title: "Book" },
          notes: [],
          progress: readingProgress({
            scrollRatio: 0.1,
            sectionIndex: 1,
            updatedAt: "2026-06-28T01:00:00.000Z",
          }),
          sections: [],
        }),
        { status: 200 },
      ),
    );

    await expect(loadReadingPayload("asset-1")).resolves.toMatchObject({
      progress: {
        scrollRatio: 0.75,
        sectionIndex: 8,
      },
    });
    expect(fetch).toHaveBeenCalledWith("/api/reading/assets/asset-1", {
      cache: "no-store",
    });
  });

  it("keeps the newest progress after a successful save response", async () => {
    installWindowMock();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          readingProgress({
            scrollRatio: 0.9,
            sectionIndex: 9,
            updatedAt: "2026-06-28T12:00:05.000Z",
          }),
        ),
        { status: 200 },
      ),
    );

    await saveReadingProgress("asset-1", 4, 1.1, 0.4, { keepalive: true });

    expect(fetch).toHaveBeenCalledWith(
      "/api/reading/assets/asset-1/progress",
      expect.objectContaining({
        body: JSON.stringify({
          contentScale: 1.1,
          scrollRatio: 0.4,
          sectionIndex: 4,
        }),
        cache: "no-store",
        keepalive: true,
        method: "PUT",
      }),
    );
    expect(readCachedReadingProgress("asset-1")).toMatchObject({
      scrollRatio: 0.9,
      sectionIndex: 9,
      updatedAt: "2026-06-28T12:00:05.000Z",
    });
  });
});

describe("reading browser api notes and OCR", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn() as never;
    installWindowMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    uninstallWindowMock();
    globalThis.fetch = originalFetch;
  });

  it("creates reading notes with normalized request payload", async () => {
    const note = { id: "note-1", selectedText: "重要内容" };
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(note), { status: 200 }),
    );

    await expect(
      createReadingNote({
        assetId: "asset-1",
        chapterTitle: "第一章",
        color: "yellow",
        comment: "想法",
        length: 4,
        offset: 12,
        projectId: "project-1",
        sectionIndex: 2,
        selectedText: "重要内容",
        type: "highlight",
      }),
    ).resolves.toEqual(note);

    expect(fetch).toHaveBeenCalledWith(
      "/api/reading/assets/asset-1/notes",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(getJsonFetchBody(0)).toEqual({
      chapterTitle: "第一章",
      color: "yellow",
      comment: "想法",
      length: 4,
      offset: 12,
      projectId: "project-1",
      sectionIndex: 2,
      selectedText: "重要内容",
      type: "highlight",
    });
  });

  it("uses API error messages from PDF annotation creation failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "保存区域失败" }), { status: 500 }),
    );

    await expect(
      createPdfReadingAnnotation({
        assetId: "asset-1",
        chapterTitle: "第 1 页",
        color: "blue",
        comment: "",
        draft: {
          kind: "region",
          pageIndex: 0,
          rect: { h: 0.2, w: 0.3, x: 0.1, y: 0.1 },
          x: 10,
          y: 20,
        },
        projectId: "project-1",
      }),
    ).rejects.toThrow("保存区域失败");
  });

  it("saves note order and updates note edits through JSON APIs", async () => {
    const orderedNotes = [{ id: "note-2" }, { id: "note-1" }];
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(orderedNotes), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "note-1", comment: "更新" }), {
          status: 200,
        }),
      );

    await expect(
      saveReadingNoteOrder("asset-1", ["note-2", "note-1"]),
    ).resolves.toEqual(orderedNotes);
    await expect(
      updateReadingNote({
        comment: "更新",
        noteId: "note-1",
        selectedText: "摘录",
      }),
    ).resolves.toMatchObject({ comment: "更新" });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/reading/assets/asset-1/notes",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(getJsonFetchBody(0)).toEqual({ noteIds: ["note-2", "note-1"] });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/reading/notes/note-1",
      expect.objectContaining({
        method: "PATCH",
      }),
    );
    expect(getJsonFetchBody(1)).toEqual({
      comment: "更新",
      selectedText: "摘录",
    });
  });

  it("recognizes PDF annotation OCR text and trims whitespace", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ text: "  识别结果  " }), { status: 200 }),
    );

    await expect(
      recognizePdfAnnotationDraft({
        draft: {
          imageDataUrl: "data:image/png;base64,abc",
          kind: "region",
          pageIndex: 0,
          rect: { h: 0.2, w: 0.3, x: 0.1, y: 0.1 },
          x: 10,
          y: 20,
        },
      }),
    ).resolves.toBe("识别结果");

    expect(fetch).toHaveBeenCalledWith(
      "/api/reading/ocr",
      expect.objectContaining({
        body: JSON.stringify({ imageBase64: "data:image/png;base64,abc" }),
        method: "POST",
      }),
    );
  });

  it("rejects OCR requests before fetch when the draft has no image", async () => {
    await expect(
      recognizePdfAnnotationDraft({
        draft: {
          kind: "region",
          pageIndex: 0,
          rect: { h: 0.2, w: 0.3, x: 0.1, y: 0.1 },
          x: 10,
          y: 20,
        },
      }),
    ).rejects.toThrow("缺少 OCR 图片");

    expect(fetch).not.toHaveBeenCalled();
  });
});
