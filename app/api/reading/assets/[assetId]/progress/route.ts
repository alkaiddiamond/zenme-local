import { NextResponse } from "next/server";

import {
  getLocalReadingAsset,
  getLocalReadingProgress,
  saveLocalReadingProgress,
} from "@/lib/local/reading-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    return NextResponse.json(await getLocalReadingProgress(assetId));
  } catch {
    return NextResponse.json(
      { error: "阅读进度加载失败" },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ assetId: string }> },
) {
  try {
    const { assetId } = await params;
    const body = (await request.json()) as {
      contentScale?: number;
      notesScrollTop?: number;
      sectionIndex?: number;
      scrollRatio?: number;
    };
    const asset = await getLocalReadingAsset(assetId);
    if (!asset) {
      return NextResponse.json({ error: "阅读资料不存在" }, { status: 404 });
    }
    const current = await getLocalReadingProgress(assetId);
    const contentScale =
      typeof body.contentScale === "number" && Number.isFinite(body.contentScale)
        ? body.contentScale
        : (current?.contentScale ?? 1);
    const sectionIndex =
      typeof body.sectionIndex === "number" && Number.isFinite(body.sectionIndex)
        ? body.sectionIndex
        : (current?.sectionIndex ?? 0);
    const scrollRatio =
      typeof body.scrollRatio === "number" && Number.isFinite(body.scrollRatio)
        ? body.scrollRatio
        : (current?.scrollRatio ?? 0);
    const notesScrollTop =
      typeof body.notesScrollTop === "number" &&
      Number.isFinite(body.notesScrollTop)
        ? body.notesScrollTop
        : (current?.notesScrollTop ?? 0);
    return NextResponse.json(
      await saveLocalReadingProgress({
        assetId,
        contentScale,
        notesScrollTop,
        projectId: asset.projectId,
        scrollRatio,
        sectionIndex,
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "阅读进度保存失败" },
      { status: 500 },
    );
  }
}

