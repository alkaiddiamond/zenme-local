import { NextResponse } from "next/server";

import {
  getAppShellState,
  updateAppShellState,
  type AppShellState,
} from "@/lib/local/app-shell-state";

export async function GET() {
  try {
    return NextResponse.json({ state: await getAppShellState() });
  } catch {
    return NextResponse.json({ error: "界面状态加载失败" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Partial<AppShellState>;
    const updates: Partial<Omit<AppShellState, "version">> = {};
    if ("favoriteProjectIds" in body) updates.favoriteProjectIds = body.favoriteProjectIds;
    if ("pinnedProjectIds" in body) updates.pinnedProjectIds = body.pinnedProjectIds;
    if ("projectOrderIds" in body) updates.projectOrderIds = body.projectOrderIds;
    if ("openProjectIds" in body) updates.openProjectIds = body.openProjectIds;
    if ("sidebarCollapsed" in body) updates.sidebarCollapsed = body.sidebarCollapsed;
    if ("localStorageMigrationCompleted" in body) {
      updates.localStorageMigrationCompleted = body.localStorageMigrationCompleted;
    }

    return NextResponse.json({ state: await updateAppShellState(updates) });
  } catch {
    return NextResponse.json({ error: "界面状态保存失败" }, { status: 500 });
  }
}
