import fs from "node:fs/promises";
import path from "node:path";

import { findProjectWorkflow, listProjectWorkflows } from "@/lib/agent/workflow-discovery";
import { AgentWorkflowJournal } from "@/lib/agent/workflow-journal";
import {
  appendAgentWorkflowProgress,
  createAgentWorkflowRun,
  findAgentWorkflowRunByTaskId,
  getAgentWorkflowRun,
  listAgentWorkflowRuns,
  updateAgentWorkflowRun,
  type AgentWorkflowRun,
} from "@/lib/agent/workflow-run-store";
import { executeAgentWorkflow, prepareAgentWorkflow } from "@/lib/agent/workflow-runtime";
import { parseWorkflowStructuredResult } from "@/lib/agent/workflow-result-schema";
import type { AgentWorkflowAgentOptions, AgentWorkflowOutcome, AgentWorkflowProgressEvent } from "@/lib/agent/workflow-types";
import { getAgentExecution } from "@/lib/agent/execution-store";
import type { AgentWorkflowTaskSnapshot, AgentWorkspaceToolName } from "@/lib/agent/types";
import type { callProjectAgentModel } from "@/lib/agent/project-agent-model";
import type { ZenmeModelSpeed, ZenmeReasoningEffort } from "@/lib/local/settings";
import { getProjectDir } from "@/lib/local/data-dir";
import { resolveInside } from "@/lib/local/path-safety";

const MAX_WORKFLOW_AGENTS = 64;
const WORKFLOW_CONCURRENCY = 4;
const MAX_NESTED_WORKFLOW_DEPTH = 1;

type WorkflowJob = { controller: AbortController; promise: Promise<AgentWorkflowRun> };
type WorkflowRuntimeState = { jobs: Map<string, WorkflowJob> };
const runtimeKey = Symbol.for("zenme.project-agent-workflow-runtime");
const workflowRuntime = (Reflect.get(globalThis, runtimeKey) as WorkflowRuntimeState | undefined) ?? { jobs: new Map() };
if (!Reflect.get(globalThis, runtimeKey)) Reflect.set(globalThis, runtimeKey, workflowRuntime);

export type LaunchProjectAgentWorkflowInput = {
  projectId: string;
  executionId: string;
  turnId?: string;
  script?: string;
  scriptPath?: string;
  name?: string;
  rootId?: string;
  args?: unknown;
  resumeFromRunId?: string;
  model: string;
  reasoningEffort?: ZenmeReasoningEffort;
  modelSpeed?: ZenmeModelSpeed;
  signal?: AbortSignal;
  callModel?: typeof callProjectAgentModel;
  onProgress?: (event: AgentWorkflowProgressEvent, run: AgentWorkflowRun) => void | Promise<void>;
  onSettled?: (run: AgentWorkflowRun) => void | Promise<void>;
};

export async function previewProjectAgentWorkflow(input: {
  projectId: string;
  script?: string;
  scriptPath?: string;
  name?: string;
  rootId?: string;
}, dataDir: string) {
  const resolved = await resolveWorkflowScript(input, dataDir);
  const prepared = prepareAgentWorkflow(resolved.script);
  if (!prepared.ok) throw new Error(prepared.error);
  return {
    name: prepared.value.meta.name,
    description: prepared.value.meta.description,
    phases: prepared.value.meta.phases ?? [],
    scriptPath: resolved.scriptPath,
  };
}

export async function launchProjectAgentWorkflow(input: LaunchProjectAgentWorkflowInput, dataDir: string) {
  const resolved = await resolveWorkflowScript(input, dataDir);
  const prepared = prepareAgentWorkflow(resolved.script);
  if (!prepared.ok) throw new Error(prepared.error);
  const runId = input.resumeFromRunId;
  if (runId && workflowRuntime.jobs.has(jobKey(dataDir, input.projectId, runId))) {
    throw new Error("该 Workflow Run 仍在运行，不能重复恢复");
  }
  const previous = runId ? await getAgentWorkflowRun(input.projectId, runId, dataDir) : null;
  if (runId && !previous) throw new Error("要恢复的 Workflow Run 不存在");
  const run = await createAgentWorkflowRun({
    projectId: input.projectId,
    executionId: input.executionId,
    turnId: input.turnId,
    name: prepared.value.meta.name,
    description: prepared.value.meta.description,
    script: resolved.script,
    runId,
    taskId: previous?.taskId,
    sourceRunId: runId,
  }, dataDir);
  const controller = new AbortController();
  const detachParentAbort = forwardAbort(input.signal, controller);
  const key = jobKey(dataDir, input.projectId, run.id);
  const promise = runProjectAgentWorkflow({ ...input, prepared: prepared.value, run, controller, dataDir })
    .finally(() => {
      detachParentAbort();
      workflowRuntime.jobs.delete(key);
    });
  workflowRuntime.jobs.set(key, { controller, promise });
  void promise.then((settled) => input.onSettled?.(settled)).catch(() => undefined);
  return run;
}

export async function waitForProjectAgentWorkflow(projectId: string, runId: string, dataDir: string) {
  const job = workflowRuntime.jobs.get(jobKey(dataDir, projectId, runId));
  if (job) return job.promise;
  const run = await getAgentWorkflowRun(projectId, runId, dataDir);
  if (!run) throw new Error("Workflow Run 不存在");
  return run;
}

export async function readProjectAgentWorkflowTask(projectId: string, taskId: string, dataDir: string) {
  const run = await findAgentWorkflowRunByTaskId(projectId, taskId, dataDir);
  return run ? workflowTaskSnapshot(run) : null;
}

export async function stopProjectAgentWorkflowTask(projectId: string, taskId: string, dataDir: string) {
  const run = await findAgentWorkflowRunByTaskId(projectId, taskId, dataDir);
  if (!run) return null;
  workflowRuntime.jobs.get(jobKey(dataDir, projectId, run.id))?.controller.abort(new Error("Workflow 已由用户停止"));
  if (run.status === "queued" || run.status === "running") {
    return workflowTaskSnapshot(await updateAgentWorkflowRun(projectId, run.id, dataDir, (current) => {
      current.status = "stopped";
      current.error = "Workflow 已由用户停止";
      current.completedAt = new Date().toISOString();
    }));
  }
  return workflowTaskSnapshot(run);
}

async function runProjectAgentWorkflow(input: LaunchProjectAgentWorkflowInput & {
  prepared: ReturnType<typeof requirePrepared>;
  run: AgentWorkflowRun;
  controller: AbortController;
  dataDir: string;
}) {
  try {
    await updateAgentWorkflowRun(input.projectId, input.run.id, input.dataDir, (run) => { run.status = "running"; });
    const journal = new AgentWorkflowJournal(input.run.journalPath);
    const resumeSnapshot = input.resumeFromRunId ? await journal.load() : undefined;
    let totalAgents = 0;
    const limiter = createLimiter(WORKFLOW_CONCURRENCY);
    let progressWrites = Promise.resolve();
    const emit = async (event: AgentWorkflowProgressEvent) => {
      const run = await appendAgentWorkflowProgress(input.projectId, input.run.id, event, input.dataDir);
      await input.onProgress?.(event, run);
    };
    const queueProgress = (event: AgentWorkflowProgressEvent) => {
      progressWrites = progressWrites.catch(() => undefined).then(() => emit(event));
    };
    const executePrepared = (
      prepared: ReturnType<typeof requirePrepared>,
      args: unknown,
      nestedDepth = 0,
    ): Promise<AgentWorkflowOutcome> => executeAgentWorkflow({
      prepared,
      runId: input.run.id,
      args,
      signal: input.controller.signal,
      journal,
      resumeSnapshot,
      maxAgents: MAX_WORKFLOW_AGENTS,
      concurrency: WORKFLOW_CONCURRENCY,
      onProgress: queueProgress,
      runAgent: ({ prompt, options, index, signal }) => limiter(async () => {
        totalAgents += 1;
        if (totalAgents > MAX_WORKFLOW_AGENTS) throw new Error(`Workflow 最多允许 ${MAX_WORKFLOW_AGENTS} 个 Agent`);
        return runWorkflowSubagent({
          ...input,
          prompt,
          options,
          index,
          signal,
        });
      }),
      runNestedWorkflow: async (nameOrReference, nestedArgs): Promise<unknown> => {
        if (nestedDepth >= MAX_NESTED_WORKFLOW_DEPTH) {
          throw new Error(`Workflow 最多允许嵌套 ${MAX_NESTED_WORKFLOW_DEPTH} 层`);
        }
        const reference = parseNestedWorkflowReference(nameOrReference);
        const nested = await resolveWorkflowScript({
          projectId: input.projectId,
          rootId: input.rootId,
          ...reference,
        }, input.dataDir);
        return (await executePrepared(requirePrepared(nested.script), nestedArgs, nestedDepth + 1)).result;
      },
    });

    const outcome = await executePrepared(input.prepared, input.args);
    await progressWrites;
    const status = input.controller.signal.aborted ? "stopped" : outcome.error ? "failed" : "succeeded";
    return updateAgentWorkflowRun(input.projectId, input.run.id, input.dataDir, (run) => {
      run.status = status;
      run.outcome = outcome;
      run.error = outcome.error;
      run.completedAt = new Date().toISOString();
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow 执行失败";
    return updateAgentWorkflowRun(input.projectId, input.run.id, input.dataDir, (run) => {
      run.status = input.controller.signal.aborted ? "stopped" : "failed";
      run.error = message;
      run.completedAt = new Date().toISOString();
    });
  }
}

async function runWorkflowSubagent(input: LaunchProjectAgentWorkflowInput & {
  dataDir: string;
  prompt: string;
  options: AgentWorkflowAgentOptions;
  index: number;
  signal?: AbortSignal;
}) {
  const parent = await getAgentExecution(input.projectId, input.executionId, input.dataDir);
  if (!parent) throw new Error("Workflow 父 Agent Execution 不存在");
  const { executeAgentWorkspaceTool } = await import("@/lib/agent/workspace-tools");
  const spawned = await executeAgentWorkspaceTool({
    projectId: input.projectId,
    executionId: input.executionId,
    name: "agent_spawn",
    arguments: {
      name: `workflow-${input.index}`,
      title: input.options.label ?? `Workflow Agent ${input.index}`,
      instruction: [
        "你是由确定性 Workflow 编排脚本启动的 Sub-agent。完成任务后直接返回结果；不要尝试启动 Workflow。",
        input.options.schema ? `最终结果必须是符合以下 JSON Schema 的 JSON 值：${JSON.stringify(input.options.schema)}` : "",
        `<workflow-task>\n${input.prompt}\n</workflow-task>`,
      ].filter(Boolean).join("\n\n"),
      rootId: input.rootId ?? parent.context.workspaceRootId,
      allowedPathPrefixes: parent.context.allowedPathPrefixes,
      allowedTools: withoutRecursiveWorkflow(parent.context.allowedTools),
      model: input.options.model || input.model,
      agentType: input.options.agentType,
      isolation: input.options.isolation,
      structuredResultSchema: input.options.schema,
    },
    signal: input.signal,
    delegatedCallModel: input.callModel,
    delegatedModel: input.options.model || input.model,
    delegatedReasoningEffort: normalizeEffort(input.options.effort) ?? input.reasoningEffort,
    delegatedModelSpeed: input.modelSpeed,
  }, input.dataDir);
  const { waitForDelegatedOrchestrationRun } = await import("@/lib/global-agent/delegated-runtime");
  const orchestration = await waitForDelegatedOrchestrationRun(input.projectId, spawned.teamId, input.dataDir);
  const task = orchestration.tasks.find((candidate) => candidate.id === spawned.agentId);
  if (!task || task.status !== "succeeded") {
    throw new Error(task?.error || `Workflow Sub-agent 未完成：${task?.status ?? "missing"}`);
  }
  const value = parseStructuredResult(task.resultSummary ?? "", input.options.schema);
  return { agentId: task.id, value };
}

async function resolveWorkflowScript(input: Pick<LaunchProjectAgentWorkflowInput,
  "projectId" | "script" | "scriptPath" | "name" | "rootId">, dataDir: string) {
  if (input.scriptPath) {
    const real = await fs.realpath(input.scriptPath);
    const allowed = [
      ...(await listProjectWorkflows(input.projectId, dataDir, input.rootId)).map((workflow) => workflow.filePath),
      ...(await listAgentWorkflowRuns(input.projectId, dataDir)).map((run) => run.scriptPath),
    ];
    if (!allowed.some((candidate) => samePath(candidate, real))) throw new Error("Workflow scriptPath 不在受信定义或历史运行目录中");
    return { script: await fs.readFile(real, "utf8"), scriptPath: real };
  }
  if (input.name) {
    const workflow = await findProjectWorkflow({ projectId: input.projectId, dataDir, name: input.name, rootId: input.rootId });
    if (!workflow) {
      const names = (await listProjectWorkflows(input.projectId, dataDir, input.rootId)).map((item) => item.name).join(", ");
      throw new Error(`未知 Workflow「${input.name}」${names ? `；可用：${names}` : ""}`);
    }
    return { script: workflow.script, scriptPath: workflow.filePath };
  }
  if (input.script) return { script: input.script };
  throw new Error("Workflow 需要 script、scriptPath 或 name 之一");
}

function requirePrepared(script: string) {
  const prepared = prepareAgentWorkflow(script);
  if (!prepared.ok) throw new Error(prepared.error);
  return prepared.value;
}

function withoutRecursiveWorkflow(tools: AgentWorkspaceToolName[] | undefined) {
  return tools?.filter((tool) => tool !== "workflow");
}

function normalizeEffort(value: string | undefined): ZenmeReasoningEffort | undefined {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" ? value : undefined;
}

function parseStructuredResult(value: string, schema: unknown) {
  return parseWorkflowStructuredResult(value, schema);
}

export { parseWorkflowStructuredResult } from "@/lib/agent/workflow-result-schema";

function parseNestedWorkflowReference(value: unknown): { name: string } | { scriptPath: string } {
  if (typeof value === "string" && value.trim()) return { name: value.trim() };
  if (value && typeof value === "object" && !Array.isArray(value) &&
    "scriptPath" in value && typeof value.scriptPath === "string" && value.scriptPath.trim()) {
    return { scriptPath: value.scriptPath.trim() };
  }
  throw new Error("workflow() 需要已保存 Workflow 的名称或 { scriptPath }");
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>) => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try { return await task(); } finally { active -= 1; queue.shift()?.(); }
  };
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController) {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

function jobKey(dataDir: string, projectId: string, runId: string) {
  return `${dataDir}\u0000${projectId}\u0000${runId}`;
}

function samePath(left: string, right: string) {
  const normalize = (value: string) => {
    const resolved = path.resolve(value).replaceAll("\\", "/");
    return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

// Retained as an explicit boundary for future run import/migration checks.
export function projectWorkflowRunsDirectory(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "executions", "workflows");
}

export function workflowTaskSnapshot(run: AgentWorkflowRun): AgentWorkflowTaskSnapshot {
  return {
    taskId: run.taskId,
    taskType: "local_workflow",
    runId: run.id,
    workflowName: run.name,
    status: run.status,
    scriptPath: run.scriptPath,
    journalPath: run.journalPath,
    events: run.events,
    outcome: run.outcome,
    error: run.error,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedAt: run.completedAt,
  };
}
