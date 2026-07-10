import { NextResponse } from "next/server";

import {
  getLocalSettings,
  updateLocalSettings,
  type ZenmeLocalSettings,
} from "@/lib/local/settings";
import { isLocalStorageMode } from "@/lib/utils";

export async function GET() {
  try {
    return NextResponse.json({
      mode: isLocalStorageMode() ? "local" : "supabase",
      settings: await getLocalSettings(),
    });
  } catch {
    return NextResponse.json({ error: "设置加载失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Partial<ZenmeLocalSettings>;
    const settings = await updateLocalSettings({
      autoSaveIntervalMs: body.autoSaveIntervalMs,
      dataDir: typeof body.dataDir === "string" ? body.dataDir : undefined,
      enableCloudSyncExperimental: body.enableCloudSyncExperimental,
      enableSnapshotHistory: body.enableSnapshotHistory,
      language: body.language,
      modelProviders: body.modelProviders,
      recentProjectIds: body.recentProjectIds,
      theme: body.theme,
    });

    return NextResponse.json({
      mode: isLocalStorageMode() ? "local" : "supabase",
      settings,
    });
  } catch {
    return NextResponse.json({ error: "设置保存失败" }, { status: 500 });
  }
}
