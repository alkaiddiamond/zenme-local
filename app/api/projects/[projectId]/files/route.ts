import { NextResponse } from "next/server";

import {
  importLocalProjectFile,
  listLocalProjectFiles,
} from "@/lib/local/project-files-repository";
import { getLocalProject } from "@/lib/local/project-repository";

const MAX_PROJECT_FILE_BYTES = 50 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;

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
    if (!(await getLocalProject(projectId))) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
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
    if (uploadedFile.size === 0 || uploadedFile.size > MAX_PROJECT_FILE_BYTES) {
      return NextResponse.json(
        { error: "项目文件大小必须在 1 B 到 50 MB 之间" },
        { status: 413 },
      );
    }
    if (
      previewFile &&
      (previewFile.size > MAX_PREVIEW_BYTES ||
        !previewFile.type.startsWith("image/"))
    ) {
      return NextResponse.json({ error: "预览图格式或大小无效" }, { status: 400 });
    }
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
