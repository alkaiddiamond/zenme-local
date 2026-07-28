import { NextResponse } from "next/server";

import { createAssetRef, type AssetRef, type ExecutionError, type ExecutionStatus } from "@/lib/execution/types";
import {
  getLocalExecution,
  retryLocalNodeRun,
  stopLocalExecution,
  updateLocalExecutionAttempt,
} from "@/lib/local/execution-repository";
import { getLocalProjectFileSource } from "@/lib/local/project-files-repository";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ executionId: string; projectId: string }> },
) {
  try {
    const { executionId, projectId } = await params;
    const execution = await getLocalExecution({ executionId, projectId });
    if (!execution) {
      return NextResponse.json({ error: "执行记录不存在" }, { status: 404 });
    }
    return NextResponse.json(execution);
  } catch {
    return NextResponse.json({ error: "执行记录加载失败" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ executionId: string; projectId: string }> },
) {
  try {
    const { executionId, projectId } = await params;
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "stop") {
      return NextResponse.json(await stopLocalExecution({ executionId, projectId }));
    }
    if (body.action === "retry") {
      if (typeof body.nodeRunId !== "string") {
        return NextResponse.json({ error: "缺少节点运行 ID" }, { status: 400 });
      }
      return NextResponse.json(await retryLocalNodeRun({
        executionId,
        projectId,
        nodeRunId: body.nodeRunId,
        providerId: optionalString(body.providerId),
        modelId: optionalString(body.modelId),
      }));
    }
    if (body.action !== "updateAttempt") {
      return NextResponse.json({ error: "不支持的执行操作" }, { status: 400 });
    }
    if (
      typeof body.nodeRunId !== "string" ||
      typeof body.attemptId !== "string" ||
      !isExecutionStatus(body.status)
    ) {
      return NextResponse.json({ error: "执行状态参数无效" }, { status: 400 });
    }
    const assetRefs = await resolveAssetRefs(projectId, body.assetFileIds);
    return NextResponse.json(await updateLocalExecutionAttempt({
      projectId,
      executionId,
      nodeRunId: body.nodeRunId,
      attemptId: body.attemptId,
      status: body.status,
      externalTaskId: optionalString(body.externalTaskId),
      outputText: optionalString(body.outputText),
      error: body.error === null ? null : normalizeError(body.error),
      assetRefs,
    }));
  } catch {
    return NextResponse.json({ error: "执行记录更新失败" }, { status: 500 });
  }
}

async function resolveAssetRefs(projectId: string, value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((fileId) => typeof fileId !== "string")) {
    throw new Error("资产文件 ID 无效");
  }
  const refs = await Promise.all(value.map(async (fileId): Promise<AssetRef> => {
    const source = await getLocalProjectFileSource({
      projectId,
      fileId,
      variant: "original",
    });
    if (!source) throw new Error("执行结果文件不存在");
    return createAssetRef({
      projectId,
      fileId,
      fileName: source.record.fileName,
      kind: assetKindFromMimeType(source.record.mimeType),
      mimeType: source.record.mimeType,
      sizeBytes: source.record.sizeBytes,
      createdAt: source.record.createdAt,
    });
  }));
  return refs;
}

function normalizeError(value: unknown): ExecutionError | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const details = value as Record<string, unknown>;
  if (typeof details.code !== "string" || typeof details.message !== "string") return undefined;
  return {
    code: details.code,
    message: details.message,
    retryable: details.retryable === true,
    stage: details.stage === "preflight" || details.stage === "submit" || details.stage === "poll" || details.stage === "download" || details.stage === "persist" || details.stage === "recovery" ? details.stage : undefined,
  };
}

function assetKindFromMimeType(mimeType: string | null): AssetRef["kind"] {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("audio/")) return "audio";
  return "file";
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isExecutionStatus(value: unknown): value is ExecutionStatus {
  return typeof value === "string" && [
    "queued", "running", "polling", "succeeded", "failed", "stopped", "timedOut", "interrupted",
  ].includes(value);
}
