import { NextResponse } from "next/server";

import { getLocalReadingAssetCover } from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import { getReadingAssetCover } from "@/lib/reading/supabase-repository";
import { authErrorResponse, requireReadingAssetAccess } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const cover = isLocalStorageMode()
      ? await getLocalReadingAssetCover(assetId)
      : await requireReadingAssetAccess(assetId).then(({ supabase }) =>
          getReadingAssetCover(supabase, assetId),
        );

    if (!cover) {
      return NextResponse.json({ error: "阅读资料封面不存在" }, { status: 404 });
    }

    return new Response(new Uint8Array(cover.bytes), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": cover.mimeType,
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: getReadingApiErrorMessage(error, "封面读取失败") },
      { status: 500 },
    );
  }
}
