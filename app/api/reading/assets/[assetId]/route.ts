import { NextResponse } from "next/server";

import {
  getLocalReadingAsset,
  getLocalReadingProgress,
  getLocalReadingSections,
  listLocalReadingNotes,
} from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const asset = await getLocalReadingAsset(assetId);

    if (!asset) {
      return NextResponse.json({ error: "阅读资料不存在" }, { status: 404 });
    }

    const [sections, notes, progress] = await Promise.all([
      getLocalReadingSections(assetId),
      listLocalReadingNotes(assetId),
      getLocalReadingProgress(assetId),
    ]);

    const body = JSON.stringify({ asset, sections, notes, progress });
    return new Response(body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-zenme-content-length": String(Buffer.byteLength(body, "utf8")),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getReadingApiErrorMessage(error, "阅读资料加载失败") },
      { status: 500 },
    );
  }
}
