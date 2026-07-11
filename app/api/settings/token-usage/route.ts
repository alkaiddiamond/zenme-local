import { NextResponse } from "next/server";

import { getTokenUsageStats } from "@/lib/local/token-usage";

export async function GET() {
  try {
    return NextResponse.json(await getTokenUsageStats());
  } catch {
    return NextResponse.json({ error: "Token 用量加载失败" }, { status: 500 });
  }
}
