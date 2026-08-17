import { changeSetErrorResponse } from "@/app/api/projects/[projectId]/workspace/change-sets/route";
import {
  applyWorkspaceChangeSet,
  approveWorkspaceChangeSet,
  rejectWorkspaceChangeSet,
  revertWorkspaceChangeSet,
} from "@/lib/workspace/change-sets";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string; changeSetId: string }> },
) {
  try {
    const { projectId, changeSetId } = await params;
    const body = await request.json() as { action?: unknown };
    if (body.action === "approve") return Response.json(await approveWorkspaceChangeSet(projectId, changeSetId));
    if (body.action === "reject") return Response.json(await rejectWorkspaceChangeSet(projectId, changeSetId));
    if (body.action === "apply") return Response.json(await applyWorkspaceChangeSet(projectId, changeSetId));
    if (body.action === "revert") return Response.json(await revertWorkspaceChangeSet(projectId, changeSetId));
    return Response.json({ error: "ChangeSet 操作无效" }, { status: 400 });
  } catch (error) {
    return changeSetErrorResponse(error, "ChangeSet 操作失败");
  }
}
