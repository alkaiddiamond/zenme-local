import { NextResponse } from "next/server";

import { getLocalReadingEpubAsset } from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";

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

    const asset = await getLocalReadingEpubAsset({
      assetId,
      assetPath,
    });

    if (!asset) {
      return NextResponse.json({ error: "资源不存在" }, { status: 404 });
    }

    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        "Content-Type": asset.mimeType,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getReadingApiErrorMessage(error, "资源读取失败") },
      { status: 500 },
    );
  }
}
