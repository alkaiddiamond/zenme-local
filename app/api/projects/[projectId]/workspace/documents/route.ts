import { NextResponse } from "next/server";

import { workspaceFileErrorResponse } from "@/app/api/projects/[projectId]/workspace/files/route";
import { openWorkspaceFileDocument } from "@/lib/workspace/workspace-files";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await request.json() as { relativePath?: unknown; rootId?: unknown };
    if (typeof body.relativePath !== "string") {
      return NextResponse.json({ error: "文件路径无效" }, { status: 400 });
    }
    return NextResponse.json(
      await openWorkspaceFileDocument({
        projectId,
        relativePath: body.relativePath,
        ...(typeof body.rootId === "string" ? { rootId: body.rootId } : {}),
      }),
      { status: 201 },
    );
  } catch (error) {
    return workspaceFileErrorResponse(error, "File Document 创建失败");
  }
}
