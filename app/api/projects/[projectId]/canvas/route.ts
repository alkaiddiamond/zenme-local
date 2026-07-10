import { NextResponse } from "next/server";

import {
  getLocalCanvasSnapshot,
  saveLocalCanvasSnapshot,
} from "@/lib/local/project-repository";
import type { CanvasSnapshotPayload } from "@/lib/zenme";
import {
  isValidCanvasSnapshot,
  MAX_CANVAS_SNAPSHOT_BYTES,
  MAX_CANVAS_THUMBNAIL_BYTES,
} from "@/lib/local/canvas-validation";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    return NextResponse.json(await getLocalCanvasSnapshot(projectId));
  } catch {
    return NextResponse.json({ error: "画布加载失败" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const formData = await request.formData();
    const rawSnapshot = formData.get("snapshot");
    if (typeof rawSnapshot !== "string") {
      return NextResponse.json({ error: "缺少画布快照" }, { status: 400 });
    }
    if (Buffer.byteLength(rawSnapshot, "utf-8") > MAX_CANVAS_SNAPSHOT_BYTES) {
      return NextResponse.json({ error: "画布快照超过 20 MB 限制" }, { status: 413 });
    }

    const snapshot = JSON.parse(rawSnapshot) as CanvasSnapshotPayload;
    if (!isValidCanvasSnapshot(snapshot)) {
      return NextResponse.json({ error: "画布快照格式无效" }, { status: 400 });
    }

    const thumbnailFile = formData.get("thumbnail");
    if (
      thumbnailFile instanceof File &&
      (thumbnailFile.size > MAX_CANVAS_THUMBNAIL_BYTES ||
        thumbnailFile.type !== "image/webp")
    ) {
      return NextResponse.json({ error: "缩略图格式或大小无效" }, { status: 400 });
    }
    const thumbnail =
      thumbnailFile &&
      typeof thumbnailFile === "object" &&
      typeof (thumbnailFile as { arrayBuffer?: unknown }).arrayBuffer === "function"
        ? Buffer.from(await (thumbnailFile as File).arrayBuffer())
        : undefined;

    await saveLocalCanvasSnapshot({ projectId, snapshot, thumbnail });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "画布保存失败" }, { status: 500 });
  }
}
