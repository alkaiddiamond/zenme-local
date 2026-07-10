import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ReadingAnnotationColor,
  ReadingAnnotationType,
  ReadingNote,
  ReadingNoteCreate,
} from "@/lib/reading/types";

import {
  normalizeColor,
  normalizeType,
  noteSelectColumns,
  type ReadingNoteRow,
  rowToNote,
} from "./rows";

export async function listReadingNotes(
  supabase: SupabaseClient,
  assetId: string,
): Promise<ReadingNote[]> {
  const { data, error } = await supabase
    .from("reading_notes")
    .select(noteSelectColumns)
    .eq("asset_id", assetId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as ReadingNoteRow[]).map(rowToNote);
}

export async function createReadingNote(
  supabase: SupabaseClient,
  input: ReadingNoteCreate,
): Promise<ReadingNote> {
  const { data: maxRow, error: maxError } = await supabase
    .from("reading_notes")
    .select("sort_order")
    .eq("asset_id", input.assetId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxError) {
    throw maxError;
  }

  const sortOrder =
    ((maxRow as { sort_order?: number | null } | null)?.sort_order ?? -1) + 1;
  const { data, error } = await supabase
    .from("reading_notes")
    .insert({
      asset_id: input.assetId,
      chapter_title: input.chapterTitle ?? null,
      color: normalizeColor(input.color),
      comment: input.comment ?? "",
      length: input.length ?? null,
      offset: input.offset ?? null,
      owner_id: input.ownerId,
      project_id: input.projectId,
      rect: input.rect ?? null,
      section_index: input.sectionIndex,
      selected_text: input.selectedText,
      sort_order: sortOrder,
      type: normalizeType(input.type),
    })
    .select(noteSelectColumns)
    .single();

  if (error) {
    throw error;
  }

  return rowToNote(data as ReadingNoteRow);
}

export async function reorderReadingNotes(
  supabase: SupabaseClient,
  assetId: string,
  noteIds: string[],
): Promise<ReadingNote[]> {
  const existing = await listReadingNotes(supabase, assetId);
  const existingSet = new Set(existing.map((note) => note.id));
  const orderedIds = [
    ...noteIds.filter((noteId) => existingSet.has(noteId)),
    ...existing
      .map((note) => note.id)
      .filter((noteId) => !noteIds.includes(noteId)),
  ];

  await Promise.all(
    orderedIds.map((noteId, index) =>
      supabase
        .from("reading_notes")
        .update({ sort_order: index })
        .eq("id", noteId)
        .eq("asset_id", assetId)
        .then(({ error }) => {
          if (error) throw error;
        }),
    ),
  );

  return listReadingNotes(supabase, assetId);
}

export async function updateReadingNote(
  supabase: SupabaseClient,
  noteId: string,
  input: {
    color?: ReadingAnnotationColor;
    comment?: string;
    selectedText?: string;
    type?: ReadingAnnotationType;
  },
): Promise<ReadingNote | null> {
  const { data, error } = await supabase
    .from("reading_notes")
    .update({
      ...(input.selectedText !== undefined ? { selected_text: input.selectedText } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      ...(input.color !== undefined ? { color: normalizeColor(input.color) } : {}),
      ...(input.type !== undefined ? { type: normalizeType(input.type) } : {}),
    })
    .eq("id", noteId)
    .select(noteSelectColumns)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? rowToNote(data as ReadingNoteRow) : null;
}

export async function deleteReadingNote(
  supabase: SupabaseClient,
  noteId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("reading_notes")
    .delete()
    .eq("id", noteId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}
