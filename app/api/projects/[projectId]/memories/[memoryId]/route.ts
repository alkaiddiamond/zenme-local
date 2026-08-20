import { NextResponse } from "next/server";

import {
  deleteProjectMemory,
  ProjectMemoryError,
  updateProjectMemory,
} from "@/lib/memory/repository";
import type { ProjectMemorySource } from "@/lib/memory/types";

type RouteParams = { params: Promise<{ memoryId: string; projectId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const { memoryId, projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== "confirm" && body.action !== "reject" && body.action !== "revise" && body.action !== "pin" && body.action !== "unpin") {
      return NextResponse.json({ error: "Project Memory 操作无效" }, { status: 400 });
    }
    return NextResponse.json(await updateProjectMemory({
      action: body.action,
      projectId,
      memoryId,
      title: typeof body.title === "string" ? body.title : undefined,
      content: typeof body.content === "string" ? body.content : undefined,
      sources: Array.isArray(body.sources) ? body.sources as ProjectMemorySource[] : undefined,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    }));
  } catch (error) {
    return response(error, "Project Memory 更新失败");
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { memoryId, projectId } = await params;
    await deleteProjectMemory(projectId, memoryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return response(error, "Project Memory 删除失败");
  }
}

function response(error: unknown, fallback: string) {
  if (error instanceof ProjectMemoryError) {
    const status = error.code === "not_found" ? 404 : error.code === "source_unavailable" ? 409 : 400;
    const messages = {
      invalid_input: "Project Memory 参数无效",
      invalid_status: "Project Memory 当前状态不允许此操作",
      not_found: "Project Memory 不存在",
      sensitive_source: "敏感文件不能作为 Project Memory 来源",
      source_unavailable: "Project Memory 来源当前不可验证",
    };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
