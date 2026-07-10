import { NextResponse } from "next/server";

import { getLocalReadingAssetFile } from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import { getReadingAssetFile } from "@/lib/reading/supabase-repository";
import { authErrorResponse, requireReadingAssetAccess } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const file = isLocalStorageMode()
      ? await getLocalReadingAssetFile(assetId)
      : await requireReadingAssetAccess(assetId).then(({ supabase }) =>
          getReadingAssetFile(supabase, assetId),
        );

    if (!file) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      },
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: getReadingApiErrorMessage(error, "文件读取失败") },
      { status: 500 },
    );
  }
}
