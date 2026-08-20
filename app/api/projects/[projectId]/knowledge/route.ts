import { NextResponse } from "next/server";

import {
  clearProjectKnowledgeIndex,
  getProjectKnowledgeStatus,
  ProjectKnowledgeError,
  rebuildProjectKnowledgeIndex,
  searchProjectKnowledge,
  setProjectKnowledgePaused,
} from "@/lib/knowledge/index-store";
import { listEmbeddingProviderOptions, resolveConfiguredEmbeddingProvider } from "@/lib/knowledge/embeddings";

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const url = new URL(request.url);
    const query = url.searchParams.get("query");
    if (query) {
      return NextResponse.json(await searchProjectKnowledge({
        projectId, query,
        limit: numberValue(url.searchParams.get("limit")),
        budgetCharacters: numberValue(url.searchParams.get("budgetCharacters")),
      }));
    }
    return NextResponse.json({
      ...await getProjectKnowledgeStatus(projectId),
      embeddingOptions: await listEmbeddingProviderOptions(),
    });
  } catch (error) { return response(error, "Project Knowledge 加载失败"); }
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "rebuild") {
      const embeddingModel = typeof body.embeddingModel === "string" ? body.embeddingModel : undefined;
      const provider = embeddingModel
        ? await resolveConfiguredEmbeddingProvider(embeddingModel) ?? undefined
        : undefined;
      if (embeddingModel && !provider) {
        throw new ProjectKnowledgeError("Embedding 模型不存在或不受支持", "invalid_input");
      }
      return NextResponse.json(await rebuildProjectKnowledgeIndex({
        projectId,
        force: body.force === true,
        provider,
        cloudAuthorized: body.cloudAuthorized === true,
      }));
    }
    if (body.action === "pause") return NextResponse.json(await setProjectKnowledgePaused(projectId, true));
    if (body.action === "resume") return NextResponse.json(await setProjectKnowledgePaused(projectId, false));
    if (body.action === "clear") return NextResponse.json(await clearProjectKnowledgeIndex(projectId));
    return NextResponse.json({ error: "Project Knowledge 操作无效" }, { status: 400 });
  } catch (error) { return response(error, "Project Knowledge 操作失败"); }
}

function numberValue(value: string | null) { if (value === null) return undefined; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function response(error: unknown, fallback: string) {
  if (error instanceof ProjectKnowledgeError) {
    const status = error.code === "index_missing" ? 404 : ["workspace_unavailable", "index_paused", "index_stale"].includes(error.code) ? 409 : 400;
    const messages = { workspace_unavailable: "Workspace 未绑定或不可读", index_missing: "Project Knowledge 尚未构建", index_paused: "Project Knowledge 索引已暂停", index_stale: "Workspace 或 Embedding 已变化，请重建 Project Knowledge", invalid_input: "Project Knowledge 参数无效", cloud_authorization_required: "云端 Embedding 尚未获得授权" };
    return NextResponse.json({ error: messages[error.code], code: error.code }, { status });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
