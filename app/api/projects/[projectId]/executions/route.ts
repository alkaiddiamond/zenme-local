import { NextResponse } from "next/server";

import type { ExecutionInputSnapshot, ExecutionKind } from "@/lib/execution/types";
import {
  createLocalExecution,
  listLocalExecutions,
  listRecoverableLocalExecutions,
} from "@/lib/local/execution-repository";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const recoverable = new URL(request.url).searchParams.get("recoverable") === "1";
    return NextResponse.json(
      recoverable
        ? await listRecoverableLocalExecutions(projectId)
        : await listLocalExecutions(projectId),
    );
  } catch {
    return NextResponse.json({ error: "执行记录加载失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (
      !isExecutionKind(body.kind) ||
      typeof body.nodeId !== "string" ||
      typeof body.triggerNodeId !== "string"
    ) {
      return NextResponse.json({ error: "执行参数无效" }, { status: 400 });
    }
    const execution = await createLocalExecution({
      projectId,
      kind: body.kind,
      nodeId: body.nodeId,
      triggerNodeId: body.triggerNodeId,
      executionId: optionalString(body.executionId),
      nodeRunId: optionalString(body.nodeRunId),
      attemptId: optionalString(body.attemptId),
      providerId: optionalString(body.providerId),
      modelId: optionalString(body.modelId),
      input: normalizeInput(body.input),
      startedAt: optionalString(body.startedAt),
    });
    return NextResponse.json(execution, { status: 201 });
  } catch {
    return NextResponse.json({ error: "执行记录创建失败" }, { status: 500 });
  }
}

function normalizeInput(value: unknown): ExecutionInputSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.prompt !== "string" || input.prompt.length > 100_000) return undefined;
  const rawParameters = input.parameters;
  const parameters = rawParameters && typeof rawParameters === "object" && !Array.isArray(rawParameters)
    ? Object.fromEntries(Object.entries(rawParameters).filter((entry): entry is [string, string | number | boolean] =>
        typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean"))
    : undefined;
  return {
    prompt: input.prompt,
    context: typeof input.context === "string" && input.context.length <= 2_000_000
      ? input.context
      : undefined,
    parameters,
  };
}

function isExecutionKind(value: unknown): value is ExecutionKind {
  return value === "text" || value === "image" || value === "video";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
