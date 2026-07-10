import { NextResponse } from "next/server";

import { getLocalReadingEpubAsset } from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import { getReadingEpubAsset } from "@/lib/reading/supabase-repository";
import { authErrorResponse, requireReadingAssetAccess } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const url = new URL(request.url);
    const assetPath = url.searchParams.get("path");

    if (!assetPath) {
      return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    }

    const asset = isLocalStorageMode()
      ? await getLocalReadingEpubAsset({
          assetId,
          assetPath,
        })
      : await requireReadingAssetAccess(assetId).then(({ supabase }) =>
          getReadingEpubAsset({
            assetId,
            assetPath,
            supabase,
          }),
        );

    if (!asset) {
      return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    }

    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.mimeType,
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: getReadingApiErrorMessage(error, "资源读取失败") },
      { status: 500 },
    );
  }
}
