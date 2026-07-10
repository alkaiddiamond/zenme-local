import { NextResponse } from "next/server";

import {
  getLocalReadingAsset,
  getLocalReadingProgress,
  getLocalReadingSections,
  listLocalReadingNotes,
} from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import {
  getReadingAsset,
  getReadingProgress,
  getReadingSections,
  listReadingNotes,
} from "@/lib/reading/supabase-repository";
import { authErrorResponse, requireReadingAssetAccess } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    if (!isLocalStorageMode()) {
      const { supabase } = await requireReadingAssetAccess(assetId);
      const asset = await getReadingAsset(supabase, assetId);
      if (!asset) {
        return NextResponse.json({ error: "阅读资料不存在" }, { status: 404 });
      }
      const [sections, notes, progress] = await Promise.all([
        getReadingSections(supabase, assetId),
        listReadingNotes(supabase, assetId),
        getReadingProgress(supabase, assetId),
      ]);
      return NextResponse.json({ asset, sections, notes, progress });
    }

    const asset = await getLocalReadingAsset(assetId);

    if (!asset) {
      return NextResponse.json({ error: "阅读资料不存在" }, { status: 404 });
    }

    const [sections, notes, progress] = await Promise.all([
      getLocalReadingSections(assetId),
      listLocalReadingNotes(assetId),
      getLocalReadingProgress(assetId),
    ]);

    return NextResponse.json({ asset, sections, notes, progress });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: getReadingApiErrorMessage(error, "阅读资料加载失败") },
      { status: 500 },
    );
  }
}
