import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AgentWorkflowOutcome, AgentWorkflowProgressEvent } from "@/lib/agent/workflow-types";
import { getProjectDir } from "@/lib/local/data-dir";
import { readJsonFile, replaceFileWithRetry, writeJsonFile } from "@/lib/local/atomic-json";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";

export const AGENT_WORKFLOW_RUN_VERSION = 1 as const;

export type AgentWorkflowRunStatus = "queued" | "running" | "succeeded" | "failed" | "stopped";

export type AgentWorkflowRun = {
  version: typeof AGENT_WORKFLOW_RUN_VERSION;
  id: string;
  taskId: string;
  projectId: string;
  executionId: string;
  turnId?: string;
  name: string;
  description: string;
  status: AgentWorkflowRunStatus;
  scriptPath: string;
  journalPath: string;
  sourceRunId?: string;
  events: AgentWorkflowProgressEvent[];
  outcome?: AgentWorkflowOutcome;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

const locks = new Map<string, Promise<unknown>>();
const MAX_EVENTS = 2_000;

export function createAgentWorkflowRunId() {
  return `wf_${crypto.randomUUID()}`;
}

export function createAgentWorkflowTaskId() {
  return `workflow_${crypto.randomUUID()}`;
}

export async function createAgentWorkflowRun(input: {
  projectId: string;
  executionId: string;
  turnId?: string;
  name: string;
  description: string;
  script: string;
  runId?: string;
  taskId?: string;
  sourceRunId?: string;
}, dataDir: string) {
  const id = input.runId ?? createAgentWorkflowRunId();
  assertWorkflowRunId(id);
  const now = new Date().toISOString();
  const scriptPath = workflowScriptPath(input.projectId, id, dataDir);
  await writeTextFileAtomic(scriptPath, input.script);
  const run: AgentWorkflowRun = {
    version: AGENT_WORKFLOW_RUN_VERSION,
    id,
    taskId: input.taskId ?? createAgentWorkflowTaskId(),
    projectId: input.projectId,
    executionId: input.executionId,
    turnId: input.turnId,
    name: input.name,
    description: input.description,
    status: "queued",
    scriptPath,
    journalPath: workflowJournalPath(input.projectId, id, dataDir),
    sourceRunId: input.sourceRunId,
    events: [],
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonFile(workflowMetadataPath(input.projectId, id, dataDir), run);
  return run;
}

export function getAgentWorkflowRun(projectId: string, runId: string, dataDir: string) {
  assertWorkflowRunId(runId);
  return readJsonFile<AgentWorkflowRun | null>(workflowMetadataPath(projectId, runId, dataDir), {
    defaultValue: null,
    normalize: normalizeWorkflowRun,
  });
}

export async function listAgentWorkflowRuns(projectId: string, dataDir: string) {
  const directory = resolveInside(getProjectDir(projectId, dataDir), "executions", "workflows");
  let entries: string[];
  try { entries = await fs.readdir(directory); } catch { return []; }
  return (await Promise.all(entries
    .filter((name) => /^wf_[a-z0-9-]{6,}$/i.test(name))
    .map((runId) => getAgentWorkflowRun(projectId, runId, dataDir).catch(() => null))))
    .filter((run): run is AgentWorkflowRun => Boolean(run))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function findAgentWorkflowRunByTaskId(projectId: string, taskId: string, dataDir: string) {
  return (await listAgentWorkflowRuns(projectId, dataDir)).find((run) => run.taskId === taskId) ?? null;
}

export function updateAgentWorkflowRun(
  projectId: string,
  runId: string,
  dataDir: string,
  update: (run: AgentWorkflowRun) => void,
) {
  const filePath = workflowMetadataPath(projectId, runId, dataDir);
  return withLock(filePath, async () => {
    const run = await getAgentWorkflowRun(projectId, runId, dataDir);
    if (!run) throw new Error("Workflow Run 不存在");
    update(run);
    run.updatedAt = new Date().toISOString();
    await writeJsonFile(filePath, run);
    return run;
  });
}

export function appendAgentWorkflowProgress(
  projectId: string,
  runId: string,
  event: AgentWorkflowProgressEvent,
  dataDir: string,
) {
  return updateAgentWorkflowRun(projectId, runId, dataDir, (run) => {
    run.events.push(event);
    if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
  });
}

export function workflowJournalPath(projectId: string, runId: string, dataDir: string) {
  assertWorkflowRunId(runId);
  return resolveInside(workflowRunDirectory(projectId, runId, dataDir), "journal.jsonl");
}

function workflowScriptPath(projectId: string, runId: string, dataDir: string) {
  return resolveInside(workflowRunDirectory(projectId, runId, dataDir), "workflow.js");
}

function workflowMetadataPath(projectId: string, runId: string, dataDir: string) {
  return resolveInside(workflowRunDirectory(projectId, runId, dataDir), "run.json");
}

function workflowRunDirectory(projectId: string, runId: string, dataDir: string) {
  assertSafePathSegment(projectId, "project id");
  assertWorkflowRunId(runId);
  return resolveInside(getProjectDir(projectId, dataDir), "executions", "workflows", runId);
}

function assertWorkflowRunId(value: string) {
  assertSafePathSegment(value, "workflow run id");
  if (!/^wf_[a-z0-9-]{6,}$/i.test(value)) throw new Error("Workflow Run ID 无效");
}

function normalizeWorkflowRun(value: unknown): AgentWorkflowRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Partial<AgentWorkflowRun>;
  if (run.version !== AGENT_WORKFLOW_RUN_VERSION || typeof run.id !== "string" || typeof run.taskId !== "string" ||
      typeof run.projectId !== "string" || typeof run.executionId !== "string" || typeof run.name !== "string" ||
      typeof run.description !== "string" || typeof run.scriptPath !== "string" || typeof run.journalPath !== "string" ||
      !["queued", "running", "succeeded", "failed", "stopped"].includes(String(run.status)) ||
      !Array.isArray(run.events) || typeof run.createdAt !== "string" || typeof run.updatedAt !== "string") return null;
  return run as AgentWorkflowRun;
}

async function writeTextFileAtomic(filePath: string, content: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp.${process.pid}.${crypto.randomBytes(6).toString("hex")}`;
  try {
    const handle = await fs.open(temporaryPath, "w");
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await replaceFileWithRetry(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function withLock<T>(key: string, task: () => Promise<T>) {
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  locks.set(key, next);
  try { return await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
