import { NextResponse } from "next/server";

import { logoutOpenAi } from "@/lib/ai/openai-oauth";

export async function DELETE() {
  await logoutOpenAi();
  return NextResponse.json({ loggedIn: false });
}
