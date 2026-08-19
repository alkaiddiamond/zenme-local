import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { getProjectDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";

export const PROJECT_AGENT_PLAN_ENTRYPOINT = "@plan/PLAN.md";
const MAX_PLAN_BYTES = 1024 * 1024;

export function isProjectAgentPlanVirtualPath(value: string) {
  return value.replaceAll("\\", "/").toLocaleLowerCase() === PROJECT_AGENT_PLAN_ENTRYPOINT.toLocaleLowerCase();
}

export function getProjectAgentPlanFilePath(projectId: string, dataDir: string, conversationId?: string) {
  if (!conversationId) {
    return resolveInside(getProjectDir(projectId, dataDir), "agent", "plans", "PLAN.md");
  }
  assertSafePathSegment(conversationId, "conversationId");
  return resolveInside(
    getProjectDir(projectId, dataDir),
    "agent",
    "plans",
    "conversations",
    conversationId,
    "PLAN.md",
  );
}

export async function readProjectAgentPlan(projectId: string, dataDir: string, conversationId?: string) {
  try {
    return await fs.readFile(getProjectAgentPlanFilePath(projectId, dataDir, conversationId), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "";
    throw error;
  }
}

export async function writeProjectAgentPlan(projectId: string, content: string, dataDir: string, conversationId?: string) {
  if (Buffer.byteLength(content, "utf8") > MAX_PLAN_BYTES) throw new Error("计划内容超过 1 MiB");
  const filePath = getProjectAgentPlanFilePath(projectId, dataDir, conversationId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}`;
  try {
    const handle = await fs.open(temporaryPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return filePath;
}
