import { NextResponse } from "next/server";

import {
  deleteLocalProject,
  getLocalProject,
  touchLocalProject,
  updateLocalProjectName,
} from "@/lib/local/project-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const project = await getLocalProject(projectId);
    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    await touchLocalProject({
      projectId,
      lastOpenedAt: new Date().toISOString(),
    });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "项目加载失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await request.json() as { name?: string };
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });
    }

    return NextResponse.json(
      await updateLocalProjectName({ projectId, name: body.name.trim() }),
    );
  } catch {
    return NextResponse.json({ error: "项目更新失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    await deleteLocalProject(projectId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "项目删除失败" }, { status: 500 });
  }
}
