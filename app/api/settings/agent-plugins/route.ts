import { NextResponse } from "next/server";

import { listAgentPlugins, saveAgentPluginConfiguration } from "@/lib/agent/project-plugin-config-manager";
import { getZenmeDataDir } from "@/lib/local/data-dir";

export async function GET() {
  try {
    return NextResponse.json({ plugins: await listAgentPlugins({ dataDir: getZenmeDataDir() }) });
  } catch (error) {
    console.error("[agent-plugins-api] Failed to list plugins", error);
    return NextResponse.json({ error: "无法读取 Agent 插件配置" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.pluginId !== "string" || typeof body.configurationId !== "string" || !isRecord(body.values)) {
      return NextResponse.json({ error: "插件配置请求无效" }, { status: 400 });
    }
    const plugins = await saveAgentPluginConfiguration({
      pluginId: body.pluginId,
      configurationId: body.configurationId,
      values: body.values,
      dataDir: getZenmeDataDir(),
    });
    return NextResponse.json({ plugins });
  } catch (error) {
    console.error("[agent-plugins-api] Failed to save plugin configuration", error);
    return NextResponse.json({ error: "Agent 插件配置保存失败" }, { status: 400 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
