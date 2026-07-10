import { NextResponse } from "next/server";

import { getLocalProjectFile } from "@/lib/local/project-files-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string; projectId: string }> },
) {
  try {
    const { fileId, projectId } = await params;
    const file = await getLocalProjectFile({ fileId, projectId, variant: "preview" });
    if (!file) {
      return NextResponse.json({ error: "预览图不存在" }, { status: 404 });
    }

    return new Response(file.bytes, {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/webp",
      },
    });
  } catch {
    return NextResponse.json({ error: "预览图读取失败" }, { status: 500 });
  }
}

