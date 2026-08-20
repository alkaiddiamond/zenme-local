import { NextResponse } from "next/server";

import {
  getLocalSettings,
  updateLocalSettings,
  type ZenmeLocalSettings,
} from "@/lib/local/settings";

export async function GET() {
  try {
    return NextResponse.json({
      mode: "local",
      settings: await getLocalSettings(),
    });
  } catch {
    return NextResponse.json({ error: "设置加载失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Partial<ZenmeLocalSettings>;
    const updates: Partial<Omit<ZenmeLocalSettings, "version">> = {};
    if ("autoSaveIntervalMs" in body) updates.autoSaveIntervalMs = body.autoSaveIntervalMs!;
    if ("theme" in body) updates.theme = body.theme!;
    if ("defaultSessionPermissionMode" in body) {
      updates.defaultSessionPermissionMode = body.defaultSessionPermissionMode!;
    }
    if ("thinkingEnabled" in body) updates.thinkingEnabled = body.thinkingEnabled!;
    if ("defaultReasoningEffort" in body) updates.defaultReasoningEffort = body.defaultReasoningEffort!;
    if ("defaultModelSpeed" in body) updates.defaultModelSpeed = body.defaultModelSpeed!;
    if ("autoDreamEnabled" in body) updates.autoDreamEnabled = body.autoDreamEnabled!;
    if (typeof body.dataDir === "string") updates.dataDir = body.dataDir;
    if ("lastImageModelId" in body) updates.lastImageModelId = body.lastImageModelId;
    if ("lastVideoModelId" in body) updates.lastVideoModelId = body.lastVideoModelId;
    if ("lastImageAspectRatio" in body) updates.lastImageAspectRatio = body.lastImageAspectRatio;
    if ("lastImageQuality" in body) updates.lastImageQuality = body.lastImageQuality;
    if ("lastTextModelId" in body) updates.lastTextModelId = body.lastTextModelId;
    if ("modelProviders" in body) updates.modelProviders = body.modelProviders!;
    if ("mcpServers" in body) updates.mcpServers = body.mcpServers!;
    const settings = await updateLocalSettings(updates);

    return NextResponse.json({
      mode: "local",
      settings,
    });
  } catch {
    return NextResponse.json({ error: "设置保存失败" }, { status: 500 });
  }
}
