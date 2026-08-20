import { NextResponse } from "next/server";

import {
  bindLocalWorkspace,
  getLocalWorkspaceBinding,
  unbindLocalWorkspace,
  setLocalWorkspacePermissions,
} from "@/lib/local/workspace-repository";
import { ProjectNotFoundError } from "@/lib/local/project-repository";
import { WorkspacePathError } from "@/lib/workspace/workspace-inspection";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    return NextResponse.json(await getLocalWorkspaceBinding(projectId));
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "Workspace 状态加载失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (!isAuthorizedDesktopRequest(request)) {
    return NextResponse.json({ error: "Workspace 只能通过桌面目录选择器绑定" }, { status: 403 });
  }
  try {
    const { projectId } = await params;
    const body = await request.json() as { rootPath?: unknown };
    if (typeof body.rootPath !== "string") {
      return NextResponse.json({ error: "Workspace 路径无效" }, { status: 400 });
    }
    return NextResponse.json(
      await bindLocalWorkspace({ projectId, rootPath: body.rootPath }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof WorkspacePathError) {
      return NextResponse.json(
        { error: workspacePathErrorMessage(error.code), code: error.code },
        { status: 400 },
      );
    }
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "Workspace 绑定失败" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    await unbindLocalWorkspace(projectId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "Workspace 解除失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (!isAuthorizedDesktopRequest(request)) {
    return NextResponse.json({ error: "Workspace 权限只能在桌面应用中修改" }, { status: 403 });
  }
  try {
    const { projectId } = await params;
    const body = await request.json() as { delete?: unknown; execute?: unknown; gitWrite?: unknown; write?: unknown };
    const permissions = {
      ...(typeof body.write === "boolean" ? { write: body.write } : {}),
      ...(typeof body.delete === "boolean" ? { delete: body.delete } : {}),
      ...(typeof body.execute === "boolean" ? { execute: body.execute } : {}),
      ...(typeof body.gitWrite === "boolean" ? { gitWrite: body.gitWrite } : {}),
    };
    if (Object.keys(permissions).length === 0) {
      return NextResponse.json({ error: "Workspace 权限参数无效" }, { status: 400 });
    }
    return NextResponse.json(await setLocalWorkspacePermissions({
      permissions,
      projectId,
    }));
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }
    return NextResponse.json({ error: "Workspace 权限更新失败" }, { status: 500 });
  }
}

function workspacePathErrorMessage(code: WorkspacePathError["code"]) {
  switch (code) {
    case "network_path_unsupported":
      return "Phase 0 暂不支持网络路径或设备路径";
    case "not_found":
      return "Workspace 目录不存在";
    case "not_directory":
      return "Workspace 必须是目录";
    default:
      return "Workspace 路径无效";
  }
}

function isAuthorizedDesktopRequest(request: Request) {
  const expected = process.env.ZENME_DESKTOP_TOKEN;
  return Boolean(
    expected &&
    request.headers.get("x-zenme-desktop-token") === expected,
  );
}
