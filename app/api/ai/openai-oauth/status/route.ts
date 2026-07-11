import { NextResponse } from "next/server";

import { getOpenAiOAuthStatus } from "@/lib/ai/openai-oauth";

export async function GET() {
  return NextResponse.json(await getOpenAiOAuthStatus());
}
