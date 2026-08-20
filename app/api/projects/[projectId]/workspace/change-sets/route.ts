import { NextResponse } from "next/server";

import {
  ChangeSetError,
  createWorkspaceChangeSet,
  listWorkspaceChangeSets,
} from "@/lib/workspace/change-sets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    return NextResponse.json({ changeSets: await listWorkspaceChangeSets(projectId) });
  } catch (error) {
    return changeSetErrorResponse(error, "ChangeSet 加载失败");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Parameters<typeof createWorkspaceChangeSet>[0];
    return NextResponse.json(await createWorkspaceChangeSet({ ...body, projectId }), { status: 201 });
  } catch (error) {
    return changeSetErrorResponse(error, "ChangeSet 创建失败");
  }
}

export function changeSetErrorResponse(error: unknown, fallback: string) {
  if (!(error instanceof ChangeSetError)) {
    return NextResponse.json({ error: fallback }, { status: 500 });
  }
  const status = error.code === "change_set_not_found"
    ? 404
    : error.code === "version_conflict"
      ? 409
      : error.code === "invalid_change_set" || error.code === "invalid_status"
        ? 400
        : error.code === "write_not_allowed" || error.code === "delete_not_allowed"
          ? 403
          : 409;
  return NextResponse.json({ error: changeSetErrorMessage(error.code), code: error.code }, { status });
}

function changeSetErrorMessage(code: ChangeSetError["code"]) {
  switch (code) {
    case "workspace_unavailable": return "Workspace 未绑定或不可用";
    case "change_set_not_found": return "ChangeSet 不存在";
    case "invalid_status": return "ChangeSet 当前状态不允许此操作";
    case "write_not_allowed": return "Workspace 未授权写入";
    case "delete_not_allowed": return "Workspace 未授权删除或重命名";
    case "version_conflict": return "Workspace 文件版本与提案基线不一致";
    case "apply_failed": return "ChangeSet 应用失败，已尝试恢复原文件";
    default: return "ChangeSet 内容无效";
  }
}
