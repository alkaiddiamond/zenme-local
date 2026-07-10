import { NextResponse } from "next/server";

import {
  getLocalCanvasSnapshot,
  saveLocalCanvasSnapshot,
} from "@/lib/local/project-repository";
import type { CanvasSnapshotPayload } from "@/lib/zenme";

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

    const snapshot = JSON.parse(rawSnapshot) as CanvasSnapshotPayload;
    if (
      snapshot.version !== 1 ||
      !Array.isArray(snapshot.nodes) ||
      !Array.isArray(snapshot.edges) ||
      !snapshot.viewport ||
      typeof snapshot.updatedAt !== "string"
    ) {
      return NextResponse.json({ error: "画布快照格式无效" }, { status: 400 });
    }

    const thumbnailFile = formData.get("thumbnail");
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
