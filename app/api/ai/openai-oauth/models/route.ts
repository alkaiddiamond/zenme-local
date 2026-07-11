import { NextResponse } from "next/server";

import { syncOpenAiModels } from "@/lib/ai/openai-oauth";

export async function POST() {
  try {
    const models = await syncOpenAiModels();
    return NextResponse.json({ modelCount: models.length });
  } catch {
    return NextResponse.json({ error: "ChatGPT 模型同步失败，请重新登录或稍后重试。" }, { status: 502 });
  }
}
