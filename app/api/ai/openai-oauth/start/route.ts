import { NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { startOpenAiOAuth } from "@/lib/ai/openai-oauth";

export async function POST(request: Request) {
  const limited = checkRateLimit({ key: `openai-oauth:start:${getClientIp(request)}`, limit: 5, windowMs: 60_000 });
  if (limited) return limited;
  try {
    return NextResponse.json({ authorizeUrl: await startOpenAiOAuth() });
  } catch {
    return NextResponse.json({ error: "无法启动 ChatGPT 登录，请检查本地回调端口是否可用。" }, { status: 500 });
  }
}
