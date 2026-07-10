import { NextResponse } from "next/server";

import {
  createLocalReadingNote,
  getLocalReadingAsset,
  listLocalReadingNotes,
  reorderLocalReadingNotes,
} from "@/lib/local/reading-repository";
import type { ReadingNoteCreate } from "@/lib/reading/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    return NextResponse.json(await listLocalReadingNotes(assetId));
  } catch {
    return NextResponse.json(
      { error: "笔记加载失败" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const normalizedBody = normalizeReadingNoteCreateBody(body);
    if (!normalizedBody) {
      return NextResponse.json({ error: "缺少笔记内容" }, { status: 400 });
    }

    const asset = await getLocalReadingAsset(assetId);
    if (!asset) {
      return NextResponse.json({ error: "阅读资料不存在" }, { status: 404 });
    }
    if (normalizedBody.projectId !== asset.projectId) {
      return NextResponse.json({ error: "项目与阅读资料不匹配" }, { status: 400 });
    }
    return NextResponse.json(
      await createLocalReadingNote({
        assetId,
        ownerId: "local",
        ...normalizedBody,
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "笔记保存失败" },
      { status: 500 },
    );
  }
}

function normalizeReadingNoteCreateBody(
  body: Record<string, unknown>,
): Omit<ReadingNoteCreate, "assetId" | "ownerId"> | null {
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const selectedText =
    typeof body.selectedText === "string" ? body.selectedText.trim() : "";

  if (!projectId || !selectedText) {
    return null;
  }

  const sectionIndex =
    typeof body.sectionIndex === "number" && Number.isFinite(body.sectionIndex)
      ? Math.max(0, Math.floor(body.sectionIndex))
      : 0;

  return {
    chapterTitle:
      typeof body.chapterTitle === "string" && body.chapterTitle.trim()
        ? body.chapterTitle.trim()
        : undefined,
    color: normalizeReadingNoteColor(body.color),
    comment: typeof body.comment === "string" ? body.comment : undefined,
    length: normalizeNullableNonNegativeInteger(body.length),
    offset: normalizeNullableNonNegativeInteger(body.offset),
    projectId,
    rect: normalizeReadingNoteRect(body.rect),
    sectionIndex,
    selectedText,
    type: normalizeReadingNoteType(body.type),
  };
}

function normalizeReadingNoteColor(value: unknown) {
  if (
    value === "yellow" ||
    value === "red" ||
    value === "blue" ||
    value === "green" ||
    value === "purple"
  ) {
    return value;
  }

  return undefined;
}

function normalizeReadingNoteType(value: unknown) {
  if (
    value === "highlight" ||
    value === "underline" ||
    value === "note" ||
    value === "region"
  ) {
    return value;
  }

  return undefined;
}

function normalizeNullableNonNegativeInteger(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.floor(value));
}

function normalizeReadingNoteRect(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const rect = value as Record<string, unknown>;
  const x = normalizeUnitNumber(rect.x);
  const y = normalizeUnitNumber(rect.y);
  const w = normalizeUnitNumber(rect.w);
  const h = normalizeUnitNumber(rect.h);

  if (x === null || y === null || w === null || h === null) {
    return undefined;
  }

  return { h, w, x, y };
}

function normalizeUnitNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const body = (await request.json()) as { noteIds?: string[] };

    if (!Array.isArray(body.noteIds)) {
      return NextResponse.json({ error: "缺少笔记顺序" }, { status: 400 });
    }

    const noteIds = normalizeReadingNoteOrderIds(body.noteIds);
    if (!noteIds) {
      return NextResponse.json({ error: "笔记顺序格式无效" }, { status: 400 });
    }

    return NextResponse.json(await reorderLocalReadingNotes(assetId, noteIds));
  } catch {
    return NextResponse.json(
      { error: "笔记顺序保存失败" },
      { status: 500 },
    );
  }
}

function normalizeReadingNoteOrderIds(noteIds: unknown[]) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const noteId of noteIds) {
    if (typeof noteId !== "string" || noteId.trim() === "") {
      return null;
    }

    if (!seen.has(noteId)) {
      normalized.push(noteId);
      seen.add(noteId);
    }
  }

  return normalized;
}
