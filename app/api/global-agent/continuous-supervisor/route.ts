import { NextResponse } from "next/server";

import { getContinuousGlobalAgentRuntimeInstanceId } from "@/lib/global-agent/continuous-runtime";
import {
  listConfiguredContinuousGlobalAgentStates,
  reconcileContinuousAgentRuntime,
} from "@/lib/global-agent/continuous-store";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { projectIds?: unknown };
    const projectIds = Array.isArray(body.projectIds)
      ? body.projectIds.filter((value): value is string => typeof value === "string").slice(0, 1_000)
      : [];
    const configured = await listConfiguredContinuousGlobalAgentStates(projectIds);
    const runtimeInstanceId = getContinuousGlobalAgentRuntimeInstanceId();
    const states = await Promise.all(configured.map((state) =>
      reconcileContinuousAgentRuntime(state.projectId, runtimeInstanceId),
    ));
    return NextResponse.json({ states });
  } catch {
    return NextResponse.json({ error: "Continuous Agent Supervisor 加载失败" }, { status: 500 });
  }
}
