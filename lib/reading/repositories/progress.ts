import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReadingProgress } from "@/lib/reading/types";
import {
  normalizeReadingContentScale,
  normalizeReadingScrollRatio,
  normalizeReadingSectionIndex,
} from "@/lib/reading/progress-policy";

import {
  progressSelectColumns,
  type ReadingProgressRow,
  rowToProgress,
} from "./rows";

export async function getReadingProgress(
  supabase: SupabaseClient,
  assetId: string,
): Promise<ReadingProgress | null> {
  const { data, error } = await supabase
    .from("reading_progress")
    .select(progressSelectColumns)
    .eq("asset_id", assetId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data ? rowToProgress(data as ReadingProgressRow) : null;
}

export async function saveReadingProgress(
  supabase: SupabaseClient,
  input: {
    assetId: string;
    contentScale: number;
    ownerId: string;
    projectId: string;
    scrollRatio: number;
    sectionIndex: number;
  },
): Promise<ReadingProgress> {
  const { data, error } = await supabase
    .from("reading_progress")
    .upsert(
      {
        asset_id: input.assetId,
        content_scale: normalizeReadingContentScale(input.contentScale),
        owner_id: input.ownerId,
        project_id: input.projectId,
        scroll_ratio: normalizeReadingScrollRatio(input.scrollRatio),
        section_index: normalizeReadingSectionIndex(input.sectionIndex),
      },
      { onConflict: "asset_id" },
    )
    .select(progressSelectColumns)
    .single();

  if (error) {
    throw error;
  }

  return rowToProgress(data as ReadingProgressRow);
}
