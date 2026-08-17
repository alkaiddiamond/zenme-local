import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";

const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ executionId: string; fileName: string; projectId: string }> },
) {
  try {
    const { executionId, fileName, projectId } = await context.params;
    assertSafePathSegment(projectId, "projectId");
    assertSafePathSegment(executionId, "executionId");
    assertSafePathSegment(fileName, "fileName");
    const extension = fileName.split(".").at(-1)?.toLowerCase() ?? "";
    const contentType = CONTENT_TYPES[extension];
    if (!contentType) return NextResponse.json({ error: "图片格式无效" }, { status: 400 });
    const filePath = resolveInside(
      getProjectDir(projectId, getZenmeDataDir()),
      "agent-generated-images",
      executionId,
      fileName,
    );
    const body = await fs.readFile(filePath);
    return new Response(body, {
      headers: {
        "cache-control": "private, max-age=31536000, immutable",
        "content-type": contentType,
      },
    });
  } catch (error) {
    if (isMissingFile(error)) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    return NextResponse.json({ error: "图片路径无效" }, { status: 400 });
  }
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
