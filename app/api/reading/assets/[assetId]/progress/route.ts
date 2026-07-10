import { NextResponse } from "next/server";

import {
  getLocalReadingAsset,
  getLocalReadingProgress,
  saveLocalReadingProgress,
} from "@/lib/local/reading-repository";
import {
  getReadingProgress,
  saveReadingProgress,
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
      return NextResponse.json(await getReadingProgress(supabase, assetId));
    }

    return NextResponse.json(await getLocalReadingProgress(assetId));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

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
      sectionIndex?: number;
      scrollRatio?: number;
    };
    const access = isLocalStorageMode()
      ? null
      : await requireReadingAssetAccess(assetId);
    const asset = access ? null : await getLocalReadingAsset(assetId);
    if (!access && !asset) {
      return NextResponse.json({ error: "阅读资料不存在" }, { status: 404 });
    }
    const current = access
      ? await getReadingProgress(access.supabase, assetId)
      : await getLocalReadingProgress(assetId);
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
    if (access) {
      return NextResponse.json(
        await saveReadingProgress(access.supabase, {
          assetId,
          contentScale,
          ownerId: access.user.id,
          projectId: access.asset.project_id,
          scrollRatio,
          sectionIndex,
        }),
      );
    }

    return NextResponse.json(
      await saveLocalReadingProgress({
        assetId,
        contentScale,
        projectId: asset!.projectId,
        scrollRatio,
        sectionIndex,
      }),
    );
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      { error: "阅读进度保存失败" },
      { status: 500 },
    );
  }
}

