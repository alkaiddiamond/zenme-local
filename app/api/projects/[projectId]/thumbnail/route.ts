import fs from "node:fs/promises";
import { NextResponse } from "next/server";

import { getLocalProjectThumbnailPath } from "@/lib/local/project-repository";

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
