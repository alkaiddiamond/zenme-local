import { NextResponse } from "next/server";

import {
  createProjectMemory,
  getConfirmedMemoryContext,
  listProjectMemories,
  ProjectMemoryError,
  validateProjectMemories,
} from "@/lib/memory/repository";
import type { ProjectMemoryKind, ProjectMemorySource } from "@/lib/memory/types";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    if (url.searchParams.get("context") === "1") {
      return NextResponse.json({ memories: await getConfirmedMemoryContext(projectId) });
    }
    if (url.searchParams.get("validate") === "1") await validateProjectMemories(projectId);
    return NextResponse.json({ memories: await listProjectMemories(projectId) });
  } catch (error) {
    return response(error, "Project Memory 加载失败");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.title !== "string" || typeof body.content !== "string" || !isKind(body.kind) || !Array.isArray(body.sources)) {
      return NextResponse.json({ error: "Project Memory 参数无效" }, { status: 400 });
    }
    const memory = await createProjectMemory({
      projectId,
      title: body.title,
      content: body.content,
      kind: body.kind,
      sources: body.sources as ProjectMemorySource[],
      createdBy: body.createdBy === "agent" ? "agent" : "user",
      status: body.status === "confirmed" ? "confirmed" : "candidate",
      reason: typeof body.reason === "string" ? body.reason : undefined,
      supersedesMemoryId: typeof body.supersedesMemoryId === "string" ? body.supersedesMemoryId : undefined,
    });
    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    return response(error, "Project Memory 创建失败");
  }
}

function isKind(value: unknown): value is ProjectMemoryKind {
  return typeof value === "string" && ["file", "architecture", "decision", "todo"].includes(value);
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
