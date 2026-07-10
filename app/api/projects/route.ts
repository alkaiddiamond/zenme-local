import { NextResponse } from "next/server";

import {
  createLocalProject,
  listLocalProjects,
} from "@/lib/local/project-repository";

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
      model?: string;
      name?: string;
      prompt?: string;
    };

    const project = await createLocalProject({
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim() : "未命名项目",
      prompt: typeof body.prompt === "string" ? body.prompt : "",
      model: typeof body.model === "string" && body.model.trim() ? body.model : "glm-4.5",
    });

    return NextResponse.json(project, { status: 201 });
  } catch {
    return NextResponse.json({ error: "项目创建失败" }, { status: 500 });
  }
}
