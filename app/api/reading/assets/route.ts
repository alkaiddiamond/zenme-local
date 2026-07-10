import { NextResponse } from "next/server";

import { getLocalProject } from "@/lib/local/project-repository";
import { createLocalReadingAsset } from "@/lib/local/reading-repository";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import { getReadingAssetSizeError } from "@/lib/reading/limits";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.startsWith("application/octet-stream")) {
      return await registerBinaryReadingAsset(request);
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const cover = formData.get("cover");
    const expectedFileSize = Number(formData.get("fileSize") ?? 0);
    const projectId = formData.get("projectId");
    const nodeId = formData.get("nodeId");

    if (
      !file ||
      typeof file !== "object" ||
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer !== "function"
    ) {
      return NextResponse.json({ error: "缺少图书文件" }, { status: 400 });
    }

    if (typeof projectId !== "string" || !projectId) {
      return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
    }

    if (!(await getLocalProject(projectId))) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    const uploadedFile = file as File;
    const declaredSizeError = getReadingAssetSizeError(
      Number.isFinite(expectedFileSize) && expectedFileSize > 0
        ? expectedFileSize
        : uploadedFile.size,
    );
    if (declaredSizeError) {
      return NextResponse.json({ error: declaredSizeError }, { status: 413 });
    }

    const coverFile =
      cover &&
      typeof cover === "object" &&
      typeof (cover as { arrayBuffer?: unknown }).arrayBuffer === "function"
        ? (cover as File)
        : null;
    const bytes = Buffer.from(await uploadedFile.arrayBuffer());
    const actualSizeError = getReadingAssetSizeError(bytes.length);
    if (actualSizeError) {
      return NextResponse.json({ error: actualSizeError }, { status: 413 });
    }

    if (
      Number.isFinite(expectedFileSize) &&
      expectedFileSize > 0 &&
      bytes.length !== expectedFileSize
    ) {
      return NextResponse.json(
        {
          error: `图书文件接收不完整：收到 ${bytes.length} 字节，应为 ${expectedFileSize} 字节`,
        },
        { status: 400 },
      );
    }

    const coverBytes = coverFile
      ? Buffer.from(await coverFile.arrayBuffer())
      : undefined;
    const asset = await createLocalReadingAsset({
      projectId,
      nodeId: typeof nodeId === "string" ? nodeId : undefined,
      fileName: uploadedFile.name || "untitled",
      mimeType: uploadedFile.type,
      bytes,
      coverBytes,
      coverMimeType: coverFile?.type,
    });

    return NextResponse.json(asset);
  } catch (error) {
    return NextResponse.json(
      {
        error: getReadingApiErrorMessage(error, "阅读资料登记失败"),
      },
      { status: 500 },
    );
  }
}

async function registerBinaryReadingAsset(request: Request) {
  const projectId = request.headers.get("x-zenme-project-id");
  const nodeId = request.headers.get("x-zenme-node-id") ?? undefined;
  const encodedFileName = request.headers.get("x-zenme-file-name");
  const expectedFileSize = Number(request.headers.get("x-zenme-file-size") ?? 0);
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (!projectId) {
    return NextResponse.json({ error: "缺少 projectId" }, { status: 400 });
  }

  const fileName = decodeReadingFileName(encodedFileName);
  if (!fileName) {
    return NextResponse.json({ error: "文件名编码无效" }, { status: 400 });
  }

  if (!(await getLocalProject(projectId))) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  const declaredSizeError = getReadingAssetSizeError(
    Number.isFinite(expectedFileSize) && expectedFileSize > 0
      ? expectedFileSize
      : contentLength,
  );
  if (declaredSizeError) {
    return NextResponse.json({ error: declaredSizeError }, { status: 413 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());

  if (bytes.length === 0) {
    return NextResponse.json({ error: "缺少图书文件" }, { status: 400 });
  }

  const actualSizeError = getReadingAssetSizeError(bytes.length);
  if (actualSizeError) {
    return NextResponse.json({ error: actualSizeError }, { status: 413 });
  }

  if (
    Number.isFinite(expectedFileSize) &&
    expectedFileSize > 0 &&
    bytes.length !== expectedFileSize
  ) {
    return NextResponse.json(
      {
        error: `图书文件接收不完整：收到 ${bytes.length} 字节，应为 ${expectedFileSize} 字节`,
      },
      { status: 400 },
    );
  }

  const asset = await createLocalReadingAsset({
    projectId,
    nodeId,
    fileName,
    mimeType: request.headers.get("content-type") ?? undefined,
    bytes,
  });

  return NextResponse.json(asset);
}

function decodeReadingFileName(encodedFileName: string | null) {
  if (!encodedFileName) return "untitled";

  try {
    return decodeURIComponent(encodedFileName);
  } catch {
    return null;
  }
}
