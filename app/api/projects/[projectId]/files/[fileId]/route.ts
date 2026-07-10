import { NextResponse } from "next/server";

import {
  deleteLocalProjectFile,
  getLocalProjectFile,
} from "@/lib/local/project-files-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string; projectId: string }> },
) {
  try {
    const { fileId, projectId } = await params;
    const file = await getLocalProjectFile({ fileId, projectId, variant: "original" });
    if (!file) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    return new Response(file.bytes, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(
          file.fileName,
        )}`,
        "content-type": file.mimeType,
      },
    });
  } catch {
    return NextResponse.json({ error: "文件读取失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ fileId: string; projectId: string }> },
) {
  try {
    const { fileId, projectId } = await params;
    await deleteLocalProjectFile({ fileId, projectId });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "文件删除失败" }, { status: 500 });
  }
}

