import { workspaceFileErrorResponse } from "@/app/api/projects/[projectId]/workspace/files/route";
import { readWorkspaceFileDocument, saveWorkspaceFileDocument } from "@/lib/workspace/workspace-files";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  try {
    const { projectId, documentId } = await params;
    return Response.json(await readWorkspaceFileDocument(projectId, documentId));
  } catch (error) {
    return workspaceFileErrorResponse(error, "File Document 加载失败");
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  try {
    const { projectId, documentId } = await params;
    const body = await request.json() as { content?: unknown; expectedHash?: unknown };
    if (typeof body.content !== "string" || typeof body.expectedHash !== "string") {
      return Response.json({ error: "保存参数无效" }, { status: 400 });
    }
    return Response.json(await saveWorkspaceFileDocument({
      content: body.content,
      documentId,
      expectedHash: body.expectedHash,
      projectId,
    }));
  } catch (error) {
    return workspaceFileErrorResponse(error, "文件保存失败");
  }
}
