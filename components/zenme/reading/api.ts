import type {
  ReadingAnnotationColor,
  ReadingNote,
  ReadingProgress,
} from "@/lib/reading/types";

import type { PdfAnnotationDraft } from "./types";
import type { ReadingPayload } from "./types";

const READING_PROGRESS_CACHE_PREFIX = "zenme:reading-progress:";
const READING_NOTES_SCROLL_CACHE_PREFIX = "zenme:reading-notes-scroll:";

export async function loadReadingPayload(assetId: string) {
  const response = await fetch(`/api/reading/assets/${assetId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "阅读资料加载失败");
  }

  const payload = (await response.json()) as ReadingPayload;
  const cachedProgress = readCachedReadingProgress(assetId);
  return {
    ...payload,
    progress: cachedProgress
      ? { ...payload.progress, ...cachedProgress }
      : payload.progress,
  };
}

export function cacheReadingProgress(
  progress: Omit<ReadingProgress, "updatedAt"> & Partial<Pick<ReadingProgress, "updatedAt">>,
) {
  return writeLocalReadingProgress({
    ...progress,
    updatedAt: progress.updatedAt ?? new Date().toISOString(),
  });
}

export function saveReadingProgress(
  assetId: string,
  sectionIndex: number,
  contentScale: number,
  scrollRatio: number,
  options?: { keepalive?: boolean },
) {
  const localProgress = cacheReadingProgress({
    assetId,
    contentScale,
    sectionIndex,
    scrollRatio,
  });

  return fetch(`/api/reading/assets/${assetId}/progress`, {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentScale,
      notesScrollTop: readCachedReadingNotesScrollTop(assetId) ?? undefined,
      scrollRatio,
      sectionIndex,
    }),
    keepalive: options?.keepalive,
  }).then(async (response) => {
    if (response.ok) {
      const saved = (await response.clone().json().catch(() => null)) as
        | ReadingProgress
        | null;
      if (saved) {
        const newestProgress = getNewestReadingProgress(
          getNewestReadingProgress(saved, localProgress),
          readCachedReadingProgress(assetId),
        );
        if (newestProgress) {
          writeLocalReadingProgress(newestProgress);
        }
      }
    }
    return response;
  });
}

function getReadingProgressCacheKey(assetId: string) {
  return `${READING_PROGRESS_CACHE_PREFIX}${assetId}`;
}

function getNewestReadingProgress(
  first: ReadingProgress | null,
  second: ReadingProgress | null,
) {
  if (!first) return second;
  if (!second) return first;

  const firstTime = new Date(first.updatedAt).getTime();
  const secondTime = new Date(second.updatedAt).getTime();
  if (Number.isNaN(firstTime)) return second;
  if (Number.isNaN(secondTime)) return first;
  return secondTime > firstTime ? second : first;
}

export function readCachedReadingProgress(assetId: string): ReadingProgress | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(getReadingProgressCacheKey(assetId));
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as Partial<ReadingProgress>;
    if (
      value.assetId !== assetId ||
      typeof value.contentScale !== "number" ||
      typeof value.sectionIndex !== "number" ||
      typeof value.scrollRatio !== "number" ||
      typeof value.updatedAt !== "string"
    ) {
      return null;
    }

    return {
      assetId,
      contentScale: value.contentScale,
      notesScrollTop:
        typeof value.notesScrollTop === "number" &&
        Number.isFinite(value.notesScrollTop)
          ? Math.max(0, value.notesScrollTop)
          : undefined,
      sectionIndex: value.sectionIndex,
      scrollRatio: Math.min(1, Math.max(0, value.scrollRatio)),
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

export function cacheReadingNotesScrollTop(assetId: string, scrollTop: number) {
  const normalizedScrollTop =
    Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      `${READING_NOTES_SCROLL_CACHE_PREFIX}${assetId}`,
      JSON.stringify({ assetId, scrollTop: normalizedScrollTop }),
    );
  }
  return normalizedScrollTop;
}

export function readCachedReadingNotesScrollTop(assetId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(
    `${READING_NOTES_SCROLL_CACHE_PREFIX}${assetId}`,
  );
  if (!raw) {
    return null;
  }

  try {
    const value = JSON.parse(raw) as {
      assetId?: unknown;
      scrollTop?: unknown;
    };
    return value.assetId === assetId &&
      typeof value.scrollTop === "number" &&
      Number.isFinite(value.scrollTop)
      ? Math.max(0, value.scrollTop)
      : null;
  } catch {
    return null;
  }
}

export function saveReadingNotesScrollTop(
  assetId: string,
  scrollTop: number,
  options?: { keepalive?: boolean },
) {
  const normalizedScrollTop = cacheReadingNotesScrollTop(assetId, scrollTop);
  return fetch(`/api/reading/assets/${assetId}/progress`, {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notesScrollTop: normalizedScrollTop }),
    keepalive: options?.keepalive,
  }).then(async (response) => {
    if (response.ok) {
      const saved = (await response.clone().json().catch(() => null)) as
        | ReadingProgress
        | null;
      if (saved) cacheReadingProgress(saved);
    }
    return response;
  });
}

function writeLocalReadingProgress(progress: ReadingProgress) {
  if (typeof window !== "undefined") {
    const cached = readCachedReadingProgress(progress.assetId);
    window.localStorage.setItem(
      getReadingProgressCacheKey(progress.assetId),
      JSON.stringify({
        ...progress,
        notesScrollTop: progress.notesScrollTop ?? cached?.notesScrollTop,
      }),
    );
  }
  return progress;
}

export async function saveReadingNoteOrder(
  assetId: string,
  noteIds: string[],
) {
  const response = await fetch(`/api/reading/assets/${assetId}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ noteIds }),
  });

  if (!response.ok) {
    throw new Error("保存笔记顺序失败");
  }

  return (await response.json()) as ReadingNote[];
}

export async function createReadingNote(input: {
  assetId: string;
  chapterTitle: string;
  color: ReadingAnnotationColor;
  comment: string;
  length: number | null;
  offset: number | null;
  projectId: string;
  ranges?: Array<{ sectionIndex: number; offset: number; length: number }> | null;
  sectionIndex: number;
  selectedText: string;
  type: "highlight" | "note";
}) {
  const response = await fetch(`/api/reading/assets/${input.assetId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      selectedText: input.selectedText,
      comment: input.comment,
      sectionIndex: input.sectionIndex,
      chapterTitle: input.chapterTitle,
      color: input.color,
      type: input.type,
      offset: input.offset,
      ranges: input.ranges,
      length: input.length,
    }),
  });

  if (!response.ok) {
    throw new Error("保存笔记失败");
  }

  return (await response.json()) as ReadingNote;
}

export async function createPdfReadingAnnotation(input: {
  assetId: string;
  chapterTitle: string;
  color: ReadingAnnotationColor;
  comment: string;
  draft: PdfAnnotationDraft;
  projectId: string;
}) {
  const response = await fetch(`/api/reading/assets/${input.assetId}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId: input.projectId,
      selectedText:
        input.draft.selectedText ||
        `第 ${input.draft.pageIndex + 1} 页区域标注`,
      comment: input.comment,
      sectionIndex: input.draft.pageIndex,
      chapterTitle: input.chapterTitle,
      color: input.color,
      type: input.draft.kind === "text" ? "highlight" : "region",
      rect: input.draft.rect,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "保存 PDF 标注失败");
  }

  return (await response.json()) as ReadingNote;
}

export async function recognizePdfAnnotationDraft(input: {
  draft: PdfAnnotationDraft;
  signal?: AbortSignal;
}) {
  if (!input.draft.imageDataUrl) {
    throw new Error("缺少 OCR 图片");
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortRequest = () => controller.abort();
  input.signal?.addEventListener("abort", abortRequest, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 100_000);

  let response: Response;
  try {
    response = await fetch("/api/reading/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        imageBase64: input.draft.imageDataUrl,
      }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (!timedOut && input.signal?.aborted) {
        throw new Error("OCR 识别已取消");
      }
      throw new Error("OCR 识别超时，请重新框选或稍后重试");
    }
    throw new Error("OCR 服务连接失败，请重新框选或稍后重试");
  } finally {
    window.clearTimeout(timeoutId);
    input.signal?.removeEventListener("abort", abortRequest);
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: string;
    text?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "OCR 识别失败");
  }

  return payload?.text?.trim() ?? "";
}

export async function updateReadingNote(input: {
  comment: string;
  noteId: string;
  selectedText: string;
}) {
  const response = await fetch(`/api/reading/notes/${input.noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      selectedText: input.selectedText,
      comment: input.comment,
    }),
  });

  if (!response.ok) {
    throw new Error("保存笔记失败");
  }

  return (await response.json()) as ReadingNote;
}

export async function deleteReadingNote(noteId: string) {
  const response = await fetch(`/api/reading/notes/${noteId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("删除笔记失败");
  }
}
