import { NextResponse } from "next/server";

import {
  createLocalProject,
  listLocalProjects,
} from "@/lib/local/project-repository";
import { isValidCanvasSnapshot } from "@/lib/local/canvas-validation";
import type { CanvasSnapshotPayload } from "@/lib/zenme";

export async function GET() {
  try {
    return NextResponse.json(await listLocalProjects());
  } catch {
    return NextResponse.json({ error: "项目列表加载失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      initialCanvas?: unknown;
      model?: string;
      name?: string;
      prompt?: string;
    };

    if (
      body.initialCanvas !== undefined &&
      !isValidCanvasSnapshot(body.initialCanvas)
    ) {
      return NextResponse.json({ error: "初始画布格式无效" }, { status: 400 });
    }

    const project = await createLocalProject({
      initialCanvas: body.initialCanvas as CanvasSnapshotPayload | undefined,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "未命名项目",
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      model: typeof body.model === "string" ? body.model.trim() : "",
    });

    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json({ error: "项目创建失败" }, { status: 500 });
  }
}
