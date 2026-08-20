import { NextResponse } from "next/server";

import { ProjectNotFoundError } from "@/lib/local/project-repository";
import { WorkspaceFileError, listWorkspaceFiles } from "@/lib/workspace/workspace-files";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const rootId = new URL(request.url).searchParams.get("rootId") ?? undefined;
    return NextResponse.json({ entries: await listWorkspaceFiles(projectId, undefined, rootId) });
  } catch (error) {
    return workspaceFileErrorResponse(error, "Workspace 文件加载失败");
  }
}

export function workspaceFileErrorResponse(error: unknown, fallback: string) {
  if (error instanceof ProjectNotFoundError) {
    return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  }
  if (error instanceof WorkspaceFileError) {
    const status = error.code === "document_not_found" || error.code === "file_not_found"
      ? 404
      : error.code === "invalid_file" || error.code === "invalid_content"
        ? 400
        : error.code === "version_conflict"
          ? 409
        : 409;
    return NextResponse.json(
      { error: workspaceFileErrorMessage(error.code), code: error.code },
      { status },
    );
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}

function workspaceFileErrorMessage(code: WorkspaceFileError["code"]) {
  switch (code) {
    case "workspace_unavailable": return "Workspace 未绑定或不可用";
    case "read_not_allowed": return "Workspace 未授权读取";
    case "write_not_allowed": return "Workspace 未授权写入";
    case "version_conflict": return "磁盘文件已发生变化，请先处理冲突";
    case "invalid_content": return "文件内容无效或不可编辑";
    case "file_not_found": return "文件不存在";
    case "document_not_found": return "File Document 不存在";
    default: return "文件路径无效";
  }
}
