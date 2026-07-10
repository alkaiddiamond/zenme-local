import { NextResponse } from "next/server";

import {
  importLocalProjectFile,
  listLocalProjectFiles,
} from "@/lib/local/project-files-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    return NextResponse.json(await listLocalProjectFiles(projectId));
  } catch {
    return NextResponse.json({ error: "项目文件列表加载失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const formData = await request.formData();
    const file = formData.get("file");
    const preview = formData.get("preview");

    if (
      !file ||
      typeof file !== "object" ||
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function"
    ) {
      return NextResponse.json({ error: "缺少项目文件" }, { status: 400 });
    }

    const uploadedFile = file as File;
    const previewFile =
      preview &&
      typeof preview === "object" &&
      typeof (preview as { arrayBuffer?: unknown }).arrayBuffer === "function"
        ? (preview as File)
        : null;
    const record = await importLocalProjectFile({
      projectId,
      fileName: uploadedFile.name,
      mimeType: uploadedFile.type,
      bytes: Buffer.from(await uploadedFile.arrayBuffer()),
      previewBytes: previewFile
        ? Buffer.from(await previewFile.arrayBuffer())
        : undefined,
      previewMimeType: previewFile?.type,
    });

    return NextResponse.json({
      fileId: record.id,
      originalPath: record.originalPath,
      previewPath: record.previewPath,
      originalUrl: `/api/projects/${projectId}/files/${record.id}`,
      previewUrl: record.previewPath
        ? `/api/projects/${projectId}/files/${record.id}/preview`
        : undefined,
    });
  } catch {
    return NextResponse.json({ error: "项目文件导入失败" }, { status: 500 });
  }
}

