import { NextResponse } from "next/server";

import {
  deleteLocalReadingNote,
  updateLocalReadingNote,
} from "@/lib/local/reading-repository";
import {
  deleteReadingNote,
  updateReadingNote,
} from "@/lib/reading/supabase-repository";
import type { ReadingAnnotationColor, ReadingAnnotationType } from "@/lib/reading/types";
import { authErrorResponse, requireReadingNoteAccess } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  try {
    const { noteId } = await params;
    const body = normalizeReadingNoteUpdateBody(
      (await request.json()) as Record<string, unknown>,
    );

    if (!body) {
      return NextResponse.json({ error: "缺少可更新的笔记内容" }, { status: 400 });
    }

    const note = isLocalStorageMode()
      ? await updateLocalReadingNote(noteId, body)
      : await requireReadingNoteAccess(noteId).then(({ supabase }) =>
          updateReadingNote(supabase, noteId, body),
        );

    if (!note) {
      return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
    }

    return NextResponse.json(note);
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: "笔记保存失败" },
      { status: 500 },
    );
  }
}

function normalizeReadingNoteUpdateBody(body: Record<string, unknown>) {
  const update: {
    color?: ReadingAnnotationColor;
    comment?: string;
    selectedText?: string;
    type?: ReadingAnnotationType;
  } = {};

  if (typeof body.selectedText === "string") {
    const selectedText = body.selectedText.trim();
    if (selectedText) {
      update.selectedText = selectedText;
    }
  }

  if (typeof body.comment === "string") {
    update.comment = body.comment;
  }

  const color = normalizeReadingNoteColor(body.color);
  if (color) {
    update.color = color;
  }

  const type = normalizeReadingNoteType(body.type);
  if (type) {
    update.type = type;
  }

  return Object.keys(update).length > 0 ? update : null;
}

function normalizeReadingNoteColor(value: unknown): ReadingAnnotationColor | undefined {
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

function normalizeReadingNoteType(value: unknown): ReadingAnnotationType | undefined {
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ noteId: string }> },
) {
  try {
    const { noteId } = await params;
    const deleted = isLocalStorageMode()
      ? await deleteLocalReadingNote(noteId)
      : await requireReadingNoteAccess(noteId).then(({ supabase }) =>
          deleteReadingNote(supabase, noteId),
        );

    if (!deleted) {
      return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: "笔记删除失败" },
      { status: 500 },
    );
  }
}
