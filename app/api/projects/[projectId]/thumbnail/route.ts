import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import {
  getLocalProjectThumbnailPath,
  saveLocalProjectThumbnail,
} from "@/lib/local/project-repository";
import { MAX_CANVAS_THUMBNAIL_BYTES } from "@/lib/local/canvas-validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const bytes = await fs.readFile(getLocalProjectThumbnailPath(projectId));
    return new Response(bytes, {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/webp",
      },
    });
  } catch {
    return NextResponse.json({ error: "缩略图不存在" }, { status: 404 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    if (request.headers.get("content-type") !== "image/webp") {
      return NextResponse.json(
        { error: "缩略图格式无效" },
        { status: 400 },
      );
    }
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_CANVAS_THUMBNAIL_BYTES) {
      return NextResponse.json(
        { error: "缩略图大小无效" },
        { status: 400 },
      );
    }

    const { projectId } = await params;
    await saveLocalProjectThumbnail({ projectId, thumbnail: bytes });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "缩略图保存失败" }, { status: 500 });
  }
}
