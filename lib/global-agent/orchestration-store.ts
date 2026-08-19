import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  createAgentExecution,
  getAgentExecution,
  retryAgentExecution,
  setAgentExecutionStage,
  stopAgentExecution,
} from "@/lib/agent/execution-store";
import { stopRunningAgentCommands } from "@/lib/agent/command-runtime";
import { createProjectAgentWorktree, settleProjectAgentWorktree } from "@/lib/agent/project-agent-worktree";
import { createAgentContextSnapshot, parseAgentContextSnapshot, type AgentContextSnapshot } from "@/lib/agent/context-model";
import type { AgentWorkspaceToolName } from "@/lib/agent/types";
import { getConfirmedMemoryContext, listProjectMemories } from "@/lib/memory/repository";
import { searchProjectKnowledge } from "@/lib/knowledge/index-store";
import {
  GLOBAL_ORCHESTRATION_VERSION,
  type GlobalConflictEdge,
  type GlobalContextEvidence,
  type GlobalOrchestration,
  type GlobalSubtask,
  type GlobalSubtaskMessage,
  type GlobalSubtaskStatus,
  type GlobalTaskPlanInput,
} from "@/lib/global-agent/types";
import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import {
  addLocalWorkspaceRoot,
  getLocalWorkspaceBinding,
  removeLocalWorkspaceRoot,
  setLocalWorkspaceRootPermissions,
} from "@/lib/local/workspace-repository";
import { listWorkspaceChangeSets } from "@/lib/workspace/change-sets";
import { isSensitiveWorkspacePath, listWorkspaceFiles } from "@/lib/workspace/workspace-files";
import {
  canUseWorkspaceCapability,
  canUseWorkspaceRootCapability,
  resolveWorkspaceRoot,
} from "@/lib/workspace/types";
import {
  inspectGitWorkspace,
  resolveExistingWorkspacePath,
  WorkspacePathError,
} from "@/lib/workspace/workspace-inspection";

const locks = new Map<string, Promise<unknown>>();
const MAX_SUBAGENTS = 8;
const MAX_CONCURRENCY = 4;
const MAX_BASELINE_FILES = 2_000;
const DEFAULT_TOOLS: AgentWorkspaceToolName[] = [
  "workspace_status", "list_directory", "glob_files", "search_files", "code_diagnostics", "code_intelligence",
  "search_knowledge", "web_search", "web_fetch", "view_image", "read_file", "write_file", "edit_file", "apply_patch",
  "notebook_edit", "shell_command", "propose_patch", "propose_memory", "skill", "tool_search", "git_diff",
];
const COLLABORATION_TASK_TOOLS: AgentWorkspaceToolName[] = ["task_create", "task_get", "task_list", "task_update"];

export class GlobalOrchestrationError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "not_found" | "invalid_status" | "workspace_unavailable") {
    super(message);
    this.name = "GlobalOrchestrationError";
  }
}

export async function createGlobalOrchestration(input: {
  allowEmptyTeam?: boolean;
  contextSnapshot?: AgentContextSnapshot;
  canvasContext?: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  concurrencyLimit?: number;
  contextEvidence?: GlobalContextEvidence[];
  fileDocumentIds?: string[];
  goal: string;
  kind?: "batch" | "team";
  maxSubagents?: number;
  projectId: string;
  resultNodeId: string;
  parentTurnId?: string;
  selectedNodeIds?: string[];
  tasks: GlobalTaskPlanInput[];
  teamName?: string;
  description?: string;
  triggerNodeId: string;
}, dataDir = getZenmeDataDir()) {
  validateCreate(input);
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding || !canUseWorkspaceCapability(binding, "read")) {
    throw new GlobalOrchestrationError("Workspace 未绑定或未授权读取", "workspace_unavailable");
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const confirmedMemories = await getConfirmedMemoryContext(input.projectId, dataDir);
  const knowledgeResults = await searchProjectKnowledge({ projectId: input.projectId, query: input.goal, limit: 30, budgetCharacters: 100_000 }, dataDir).then((result) => result.results).catch(() => []);
  const taskIds = input.tasks.map(() => crypto.randomUUID());
  const kind = input.kind ?? "batch";
  const tasks: GlobalSubtask[] = [];
  for (let index = 0; index < input.tasks.length; index += 1) {
    const plan = input.tasks[index];
    const scopes = normalizeScopes(plan.allowedPathPrefixes);
    const root = resolveWorkspaceRoot(binding, plan.rootId);
    if (!root || !canUseWorkspaceRootCapability(root, "read")) {
      throw new GlobalOrchestrationError("Sub-agent 指定的 Workspace Root 不存在或未授权读取", "workspace_unavailable");
    }
    tasks.push({
      id: taskIds[index],
      name: plan.name?.trim().slice(0, 100) || undefined,
      title: plan.title.trim().slice(0, 500),
      instruction: plan.instruction.trim().slice(0, 100_000),
      agentType: plan.agentType,
      model: plan.model,
      reasoningEffort: plan.reasoningEffort,
      maxTurns: plan.maxTurns,
      skills: plan.skills,
      memory: plan.memory,
      isolation: plan.isolation,
      permissionMode: plan.permissionMode,
      planModeRequired: plan.planModeRequired === true,
      hooks: plan.hooks,
      mcpServers: plan.mcpServers,
      customizationSource: plan.customizationSource,
      structuredResultSchema: plan.structuredResultSchema,
      rootId: root.id,
      rootDisplayName: root.displayName,
      dependsOn: (plan.dependsOn ?? []).map((dependency) => taskIds[dependency]).filter(Boolean),
      allowedPathPrefixes: scopes,
      allowedTools: normalizeTools(plan.allowedTools, kind, plan.planModeRequired === true),
      additionalAllowedTools: dedupe(plan.additionalAllowedTools),
      baselineHashes: await captureBaselines(input.projectId, root.id, scopes, dataDir),
      status: "queued",
      changeSetIds: [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    });
  }
  const maxSubagents = clampInteger(input.maxSubagents, tasks.length ? Math.min(4, tasks.length) : MAX_SUBAGENTS, 1, MAX_SUBAGENTS);
  if (tasks.length > maxSubagents) {
    throw new GlobalOrchestrationError("任务数量超过 Sub-agent 预算", "invalid_input");
  }
  const orchestration: GlobalOrchestration = {
    version: GLOBAL_ORCHESTRATION_VERSION,
    id,
    projectId: input.projectId,
    resultNodeId: input.resultNodeId,
    triggerNodeId: input.triggerNodeId,
    parentTurnId: input.parentTurnId?.trim() || undefined,
    kind,
    teamName: input.teamName?.trim().slice(0, 100) || undefined,
    description: input.description?.trim().slice(0, 2_000) || undefined,
    goal: input.goal.trim(),
    status: "planning",
    concurrencyLimit: clampInteger(input.concurrencyLimit, 2, 1, MAX_CONCURRENCY),
    maxSubagents,
    contextEvidence: [
      ...normalizeEvidence(input.contextEvidence),
      ...confirmedMemories.slice(0, 100).map((memory): GlobalContextEvidence => ({
        kind: "projectMemory",
        id: memory.id,
        reason: `已确认 Project Memory r${memory.revision}：${memory.title}`,
      })),
      ...knowledgeResults.map((result): GlobalContextEvidence => ({
        kind: "knowledgeSearch",
        id: result.entity.id,
        reason: `${result.evidence.join("；")}；score=${result.score.toFixed(3)}`,
        contentHash: result.entity.contentHash,
      })),
      ...tasks.flatMap((task) => task.allowedPathPrefixes.map((scope): GlobalContextEvidence => ({
        kind: "pathScope",
        id: `${task.rootId}:${scope}`,
        reason: `分配给 Sub-agent「${task.title}」的 Workspace Root 与最小路径范围`,
      }))),
    ].slice(0, 1_000),
    selectedNodeIds: dedupe(input.selectedNodeIds),
    fileDocumentIds: dedupe(input.fileDocumentIds),
    canvasContext: (input.canvasContext ?? "").slice(0, 2_000_000),
    contextSnapshot: input.contextSnapshot ?? createAgentContextSnapshot({
      prompt: input.goal,
      currentNodeContext: input.currentNodeContext,
      connectedGraphContext: input.connectedGraphContext,
      conversationId: input.conversationId,
      selectedNodeIds: input.selectedNodeIds,
      fileDocumentIds: input.fileDocumentIds,
      canvasContext: input.canvasContext,
    }),
    currentNodeContext: input.currentNodeContext?.slice(0, 2_000_000) || undefined,
    connectedGraphContext: input.connectedGraphContext?.slice(0, 2_000_000) || undefined,
    conversationId: input.conversationId?.trim() || undefined,
    tasks,
    conflicts: plannedConflicts(tasks),
    applicationOrder: topologicalOrder(tasks),
    createdAt: now,
    updatedAt: now,
  };
  await writeOrchestration(orchestration, dataDir);
  return orchestration;
}

export async function createGlobalTeam(input: {
  contextSnapshot?: AgentContextSnapshot;
  canvasContext?: string;
  currentNodeContext?: string;
  connectedGraphContext?: string;
  conversationId?: string;
  description?: string;
  fileDocumentIds?: string[];
  maxSubagents?: number;
  parentTurnId?: string;
  projectId: string;
  resultNodeId: string;
  selectedNodeIds?: string[];
  teamName: string;
  triggerNodeId: string;
}, dataDir = getZenmeDataDir()) {
  const openTeam = (await listGlobalOrchestrations(input.projectId, dataDir)).find((item) =>
    item.kind === "team" && !item.deletedAt);
  if (openTeam) {
    throw new GlobalOrchestrationError(
      `当前 Project Session 已在领导团队“${openTeam.teamName ?? openTeam.id}”，请先调用 team_delete`,
      "invalid_status",
    );
  }
  const requestedName = input.teamName.trim();
  if (!requestedName || requestedName.length > 100) {
    throw new GlobalOrchestrationError("团队名称无效", "invalid_input");
  }
  const existingNames = new Set((await listGlobalOrchestrations(input.projectId, dataDir))
    .flatMap((item) => item.teamName ? [item.teamName.toLocaleLowerCase()] : []));
  let teamName = requestedName;
  for (let suffix = 2; existingNames.has(teamName.toLocaleLowerCase()); suffix += 1) {
    teamName = `${requestedName}-${suffix}`.slice(0, 100);
  }
  return createGlobalOrchestration({
    contextSnapshot: input.contextSnapshot,
    ...input,
    allowEmptyTeam: true,
    kind: "team",
    teamName,
    goal: input.description?.trim() || `协调团队 ${teamName}`,
    tasks: [],
  }, dataDir);
}

export async function addGlobalTeamMember(input: {
  agentType?: string;
  allowedPathPrefixes?: string[];
  allowedTools?: AgentWorkspaceToolName[];
  instruction: string;
  name: string;
  projectId: string;
  rootId?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  maxTurns?: number;
  skills?: string[];
  memory?: "user" | "project" | "local";
  isolation?: "worktree";
  permissionMode?: import("@/lib/local/settings").ZenmeSessionPermissionMode;
  planModeRequired?: boolean;
  hooks?: import("@/lib/agent/project-agent-hooks").ProjectAgentHooks;
  mcpServers?: import("@/lib/agent/project-agent-mcp").ProjectAgentMcpServerSpec[];
  customizationSource?: "policy" | "project" | "user" | "plugin";
  structuredResultSchema?: unknown;
  teamId: string;
  title?: string;
}, dataDir = getZenmeDataDir()) {
  const current = await requireOrchestration(input.projectId, input.teamId, dataDir);
  if (current.kind !== "team" || current.deletedAt) {
    throw new GlobalOrchestrationError("团队不存在或已经关闭", "invalid_status");
  }
  const name = input.name.trim();
  const instruction = input.instruction.trim();
  if (!name || name.length > 100 || !instruction || instruction.length > 100_000) {
    throw new GlobalOrchestrationError("Agent 参数无效", "invalid_input");
  }
  const binding = await getLocalWorkspaceBinding(input.projectId, dataDir);
  if (!binding || !canUseWorkspaceCapability(binding, "read")) {
    throw new GlobalOrchestrationError("Workspace 未绑定或未授权读取", "workspace_unavailable");
  }
  const root = resolveWorkspaceRoot(binding, input.rootId);
  if (!root || !canUseWorkspaceRootCapability(root, "read")) {
    throw new GlobalOrchestrationError("Agent 指定的 Workspace Root 不存在或未授权读取", "workspace_unavailable");
  }
  const scopes = normalizeScopes(input.allowedPathPrefixes);
  const baselineHashes = await captureBaselines(input.projectId, root.id, scopes, dataDir);
  return mutate(input.projectId, input.teamId, dataDir, (team) => {
    if (team.kind !== "team" || team.deletedAt) {
      throw new GlobalOrchestrationError("团队不存在或已经关闭", "invalid_status");
    }
    if (team.tasks.length >= team.maxSubagents) {
      throw new GlobalOrchestrationError("团队成员数量已达到上限", "invalid_status");
    }
    if (team.tasks.some((task) => task.name?.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new GlobalOrchestrationError(`团队成员名称已存在：${name}`, "invalid_input");
    }
    const now = new Date().toISOString();
    const task: GlobalSubtask = {
      id: crypto.randomUUID(),
      name,
      title: (input.title?.trim() || name).slice(0, 500),
      instruction,
      agentType: input.agentType,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      maxTurns: input.maxTurns,
      skills: input.skills,
      memory: input.memory,
      isolation: input.isolation,
      permissionMode: input.permissionMode,
      planModeRequired: input.planModeRequired === true,
      hooks: input.hooks,
      mcpServers: input.mcpServers,
      customizationSource: input.customizationSource,
      structuredResultSchema: input.structuredResultSchema,
      rootId: root.id,
      rootDisplayName: root.displayName,
      dependsOn: [],
      allowedPathPrefixes: scopes,
      allowedTools: normalizeTools(input.allowedTools, "team", input.planModeRequired === true),
      baselineHashes,
      status: "queued",
      changeSetIds: [],
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    team.tasks.push(task);
    team.status = "planning";
    team.conflicts = plannedConflicts(team.tasks);
    team.applicationOrder = topologicalOrder(team.tasks);
    delete team.completedAt;
    team.updatedAt = now;
    return task;
  });
}

export async function closeGlobalTeam(projectId: string, teamId: string, dataDir = getZenmeDataDir()) {
  return mutate(projectId, teamId, dataDir, (team) => {
    if (team.kind !== "team" || team.deletedAt) {
      return { success: true, teamName: team.teamName, message: "团队已经关闭" };
    }
    const active = team.tasks.filter((task) =>
      ["queued", "dispatching", "running", "waitingApproval", "waitingInput"].includes(task.status));
    if (active.length) {
      return {
        success: false,
        teamName: team.teamName,
        activeMembers: active.map((task) => task.name ?? task.title),
        message: `仍有 ${active.length} 个活跃成员，请先发送 shutdown_request 或停止任务`,
      };
    }
    const now = new Date().toISOString();
    team.deletedAt = now;
    team.completedAt = now;
    team.status = "completed";
    team.updatedAt = now;
    return { success: true, teamName: team.teamName, message: `团队“${team.teamName ?? team.id}”已关闭` };
  });
}

export async function getGlobalOrchestration(projectId: string, orchestrationId: string, dataDir = getZenmeDataDir()) {
  const current = await readOrchestration(projectId, orchestrationId, dataDir);
  return current ? synchronizeRuntime(current, dataDir) : null;
}

export async function listGlobalOrchestrations(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  let names: string[];
  try { names = await fs.readdir(directoryPath(projectId, dataDir)); }
  catch (error) { if (isMissing(error)) return []; throw error; }
  const items = (await Promise.all(names.filter((name) => name.endsWith(".json"))
    .map((name) => readOrchestration(projectId, name.slice(0, -5), dataDir))))
    .filter((item): item is GlobalOrchestration => Boolean(item));
  return Promise.all(items.map((item) => synchronizeRuntime(item, dataDir)));
}

export async function getOpenGlobalTeam(projectId: string, dataDir = getZenmeDataDir()) {
  return (await listGlobalOrchestrations(projectId, dataDir)).find((item) =>
    item.kind === "team" && !item.deletedAt) ?? null;
}

export async function dispatchGlobalSubtasks(projectId: string, orchestrationId: string, dataDir = getZenmeDataDir()) {
  const current = await requireOrchestration(projectId, orchestrationId, dataDir);
  if (["completed", "failed", "stopped"].includes(current.status)) {
    throw new GlobalOrchestrationError("Global Agent 已结束", "invalid_status");
  }
  const occupied = current.tasks.filter((task) => task.status === "running" || task.status === "dispatching").length;
  const ready = current.tasks.filter((task) => task.status === "queued" && task.dependsOn.every((dependencyId) =>
    current.tasks.find((candidate) => candidate.id === dependencyId)?.status === "succeeded"))
    .slice(0, Math.max(0, current.concurrencyLimit - occupied));
  const dispatched: GlobalSubtask[] = [];
  for (const task of ready) {
    await mutate(projectId, orchestrationId, dataDir, (next) => {
      const target = requireTask(next, task.id);
      target.status = "dispatching";
      target.updatedAt = new Date().toISOString();
      next.status = "running";
      next.updatedAt = target.updatedAt;
    });
    try {
      const preparedTask = task.isolation === "worktree"
        ? await prepareSubtaskWorktree(projectId, orchestrationId, task.id, dataDir)
        : task;
      const created = await createAgentExecution({
        projectId,
        resultNodeId: `${current.resultNodeId}:${preparedTask.id}`,
        triggerNodeId: current.resultNodeId,
        agentId: `sub-agent:${preparedTask.id}`,
        instruction: delegatedInstruction(current, preparedTask),
        contextSnapshot: current.contextSnapshot,
        canvasContext: current.canvasContext,
        currentNodeContext: current.currentNodeContext,
        connectedGraphContext: current.connectedGraphContext,
        conversationId: current.conversationId,
        selectedNodeIds: current.selectedNodeIds,
        fileDocumentIds: current.fileDocumentIds,
        allowedPathPrefixes: preparedTask.allowedPathPrefixes,
        allowedTools: preparedTask.allowedTools,
        additionalAllowedTools: preparedTask.additionalAllowedTools,
        orchestrationId,
        subtaskId: preparedTask.id,
        workspaceRootId: preparedTask.rootId,
        agentMemory: preparedTask.agentType && preparedTask.memory ? { agentType: preparedTask.agentType, scope: preparedTask.memory } : undefined,
        agentHooks: preparedTask.hooks,
        agentMcpServers: preparedTask.mcpServers,
        agentCustomizationSource: preparedTask.customizationSource,
        structuredResultSchema: preparedTask.structuredResultSchema,
        permissionMode: preparedTask.permissionMode,
      }, dataDir);
      const updated = await mutate(projectId, orchestrationId, dataDir, (next) => {
        const target = requireTask(next, task.id);
        target.agentExecutionId = created.detail.id;
        target.status = "running";
        target.startedAt = created.detail.createdAt;
        target.updatedAt = created.detail.updatedAt;
        next.updatedAt = target.updatedAt;
        return target;
      });
      dispatched.push(updated);
    } catch (error) {
      await mutate(projectId, orchestrationId, dataDir, (next) => {
        const target = requireTask(next, task.id);
        target.status = "failed";
        target.error = safeMessage(error);
        target.completedAt = new Date().toISOString();
        target.updatedAt = target.completedAt;
      });
    }
  }
  return { orchestration: await requireOrchestration(projectId, orchestrationId, dataDir), dispatched };
}

async function prepareSubtaskWorktree(projectId: string, orchestrationId: string, subtaskId: string, dataDir: string) {
  const orchestration = await requireOrchestration(projectId, orchestrationId, dataDir);
  const task = requireTask(orchestration, subtaskId);
  if (task.worktree?.state === "active" || task.worktree?.state === "kept") return task;
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  const originalRoot = binding ? resolveWorkspaceRoot(binding, task.rootId) : null;
  if (!binding || !originalRoot) {
    throw new GlobalOrchestrationError("worktree isolation 需要可用的 Git Workspace Root", "workspace_unavailable");
  }
  const currentGit = await inspectGitWorkspace(originalRoot.realPath);
  if (!currentGit.available) {
    throw new GlobalOrchestrationError("worktree isolation 需要可用的 Git Workspace Root", "workspace_unavailable");
  }
  let worktree = await createProjectAgentWorktree({
    projectId,
    taskId: task.id,
    originalRootId: originalRoot.id,
    workspacePath: originalRoot.realPath,
    dataDir,
  });
  try {
    const updatedBinding = await addLocalWorkspaceRoot({ projectId, rootPath: worktree.path }, dataDir);
    const worktreeRealPath = await fs.realpath(worktree.path);
    const worktreeRoot = [updatedBinding, ...(updatedBinding.additionalRoots ?? [])].find((root) =>
      path.resolve(root.realPath).toLocaleLowerCase() === path.resolve(worktreeRealPath).toLocaleLowerCase());
    if (!worktreeRoot) throw new Error("Agent worktree 无法注册为临时 Workspace Root");
    await setLocalWorkspaceRootPermissions({
      projectId,
      rootId: worktreeRoot.id,
      permissions: {
        write: originalRoot.permissions.write,
        delete: originalRoot.permissions.delete,
        execute: originalRoot.permissions.execute,
        gitWrite: originalRoot.permissions.gitWrite,
      },
    }, dataDir);
    worktree = { ...worktree, rootId: worktreeRoot.id };
    return mutate(projectId, orchestrationId, dataDir, (next) => {
      const target = requireTask(next, subtaskId);
      target.worktree = worktree;
      target.rootId = worktreeRoot.id;
      target.rootDisplayName = `${originalRoot.displayName} (${path.basename(worktree.path)})`;
      target.updatedAt = new Date().toISOString();
      next.updatedAt = target.updatedAt;
      return target;
    });
  } catch (error) {
    await settleProjectAgentWorktree(worktree, false).catch(() => undefined);
    throw error;
  }
}

export async function sendGlobalSubtaskMessage(input: {
  projectId: string;
  orchestrationId: string;
  text: string;
  subtaskIds?: string[];
  recipientNames?: string[];
  reactivateTerminalTeamMembers?: boolean;
  reactivateTerminalAgents?: boolean;
  kind?: GlobalSubtaskMessage["kind"];
  summary?: string;
}, dataDir = getZenmeDataDir()) {
  const text = input.text.trim();
  if (!text || text.length > 200_000) {
    throw new GlobalOrchestrationError("Sub-agent 协调消息无效", "invalid_input");
  }
  const requestId = input.kind === "shutdown_request" ? crypto.randomUUID() : undefined;
  const delivery = await mutate(input.projectId, input.orchestrationId, dataDir, (orchestration) => {
    const selected = input.subtaskIds?.length ? new Set(input.subtaskIds) : null;
    const selectedNames = input.recipientNames?.length
      ? new Set(input.recipientNames.map((name) => name.toLocaleLowerCase()))
      : null;
    const now = new Date().toISOString();
    const recipients: string[] = [];
    const reactivatedAgentIds: string[] = [];
    for (const task of orchestration.tasks) {
      if (selected && !selected.has(task.id)) continue;
      if (selectedNames && !selectedNames.has((task.name ?? task.title).toLocaleLowerCase())) continue;
      const active = ["queued", "dispatching", "running", "waitingApproval", "waitingInput"].includes(task.status);
      const canReactivate = (input.reactivateTerminalAgents === true ||
        (input.reactivateTerminalTeamMembers === true && orchestration.kind === "team")) &&
        ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status) && Boolean(task.agentExecutionId);
      if (!active && !canReactivate) continue;
      task.messages ??= [];
      task.messages.push({
        id: crypto.randomUUID(),
        from: "parent",
        senderName: "team-lead",
        recipientName: task.name ?? task.title,
        text,
        kind: input.kind,
        summary: input.summary?.trim().slice(0, 500) || undefined,
        requestId,
        createdAt: now,
      });
      task.updatedAt = now;
      recipients.push(task.id);
      if (canReactivate) reactivatedAgentIds.push(task.id);
    }
    orchestration.updatedAt = now;
    if ((selected || selectedNames) && !recipients.length) {
      throw new GlobalOrchestrationError("没有找到可接收消息的活跃 Agent", "not_found");
    }
    return {
      orchestrationId: orchestration.id,
      recipients,
      recipientNames: orchestration.tasks
        .filter((task) => recipients.includes(task.id))
        .map((task) => task.name ?? task.title),
      reactivatedAgentIds,
      requestId,
    };
  });
  for (const taskId of delivery.reactivatedAgentIds) {
    const current = await requireOrchestration(input.projectId, input.orchestrationId, dataDir);
    const task = requireTask(current, taskId);
    if (!task.agentExecutionId) continue;
    await retryAgentExecution(input.projectId, task.agentExecutionId, dataDir);
    await mutate(input.projectId, input.orchestrationId, dataDir, (team) => {
      const target = requireTask(team, taskId);
      target.status = "running";
      delete target.completedAt;
      delete target.error;
      delete target.resultSummary;
      target.updatedAt = new Date().toISOString();
      team.status = "running";
      delete team.completedAt;
      team.updatedAt = target.updatedAt;
    });
  }
  return delivery;
}

export async function requestGlobalTeamPlanApproval(input: {
  executionId: string;
  orchestrationId: string;
  plan: string;
  projectId: string;
  subtaskId: string;
}, dataDir = getZenmeDataDir()) {
  const plan = input.plan.trim();
  if (!plan || plan.length > 200_000) {
    throw new GlobalOrchestrationError("Team Agent 计划无效", "invalid_input");
  }
  const result = await mutate(input.projectId, input.orchestrationId, dataDir, (orchestration) => {
    if (orchestration.kind !== "team" || orchestration.deletedAt) {
      throw new GlobalOrchestrationError("团队不存在或已经关闭", "invalid_status");
    }
    const task = requireTask(orchestration, input.subtaskId);
    if (!task.planModeRequired || task.agentExecutionId !== input.executionId || task.status !== "running") {
      throw new GlobalOrchestrationError("该成员当前不能提交计划审批", "invalid_status");
    }
    if (task.planApproval?.status === "pending") {
      throw new GlobalOrchestrationError("该成员已有待处理的计划审批", "invalid_status");
    }
    const now = new Date().toISOString();
    const requestId = crypto.randomUUID();
    task.planApproval = { requestId, plan, status: "pending", createdAt: now };
    task.status = "waitingApproval";
    const message: GlobalSubtaskMessage = {
      id: crypto.randomUUID(),
      from: "subagent",
      senderName: task.name ?? task.title,
      recipientName: "team-lead",
      kind: "plan_approval_request",
      requestId,
      summary: "请求批准实施计划",
      text: plan,
      createdAt: now,
    };
    task.messages.push(message);
    task.updatedAt = now;
    orchestration.status = "running";
    orchestration.updatedAt = now;
    return {
      agentExecutionId: task.agentExecutionId,
      message,
      parentTurnId: orchestration.parentTurnId,
      requestId,
      taskId: task.id,
      teammateName: task.name ?? task.title,
    };
  });
  await setAgentExecutionStage(input.projectId, input.executionId, "waitingApproval", dataDir);
  return result;
}

export async function respondGlobalTeamPlanApproval(input: {
  approve: boolean;
  feedback?: string;
  orchestrationId: string;
  projectId: string;
  requestId: string;
  teammateName: string;
}, dataDir = getZenmeDataDir()) {
  const feedback = input.feedback?.trim();
  if (!input.requestId.trim() || !input.teammateName.trim() || (!input.approve && !feedback)) {
    throw new GlobalOrchestrationError("计划审批响应无效；拒绝时必须提供 feedback", "invalid_input");
  }
  const result = await mutate(input.projectId, input.orchestrationId, dataDir, (orchestration) => {
    if (orchestration.kind !== "team" || orchestration.deletedAt) {
      throw new GlobalOrchestrationError("团队不存在或已经关闭", "invalid_status");
    }
    const task = orchestration.tasks.find((candidate) =>
      (candidate.name ?? candidate.title).toLocaleLowerCase() === input.teammateName.trim().toLocaleLowerCase());
    if (!task?.agentExecutionId || task.status !== "waitingApproval" ||
      task.planApproval?.status !== "pending" || task.planApproval.requestId !== input.requestId.trim()) {
      throw new GlobalOrchestrationError("待处理的成员计划审批不存在", "not_found");
    }
    const now = new Date().toISOString();
    task.planApproval.status = input.approve ? "approved" : "rejected";
    task.planApproval.feedback = feedback;
    task.planApproval.respondedAt = now;
    task.status = "running";
    task.messages.push({
      id: crypto.randomUUID(),
      from: "parent",
      senderName: "team-lead",
      recipientName: task.name ?? task.title,
      kind: "plan_approval_response",
      requestId: input.requestId.trim(),
      approve: input.approve,
      feedback,
      text: input.approve ? "计划已批准，可以开始实施。" : `计划未批准，请根据反馈修订：${feedback}`,
      createdAt: now,
    });
    task.updatedAt = now;
    orchestration.status = "running";
    delete orchestration.completedAt;
    orchestration.updatedAt = now;
    return {
      agentExecutionId: task.agentExecutionId,
      approved: input.approve,
      feedback,
      reactivatedAgentIds: [task.id],
      recipients: [task.name ?? task.title],
      taskId: task.id,
    };
  });
  await setAgentExecutionStage(input.projectId, result.agentExecutionId, "planning", dataDir);
  return result;
}

export async function claimGlobalSubtaskMessages(
  projectId: string,
  orchestrationId: string,
  subtaskId: string,
  dataDir = getZenmeDataDir(),
) {
  return mutate(projectId, orchestrationId, dataDir, (orchestration) => {
    const task = requireTask(orchestration, subtaskId);
    task.messages ??= [];
    const selfName = (task.name ?? task.title).toLocaleLowerCase();
    const unread = task.messages.filter((message) => !message.readAt && (
      message.from === "parent" || message.recipientName?.toLocaleLowerCase() === selfName
    ));
    if (!unread.length) return [] as GlobalSubtaskMessage[];
    const now = new Date().toISOString();
    for (const message of unread) message.readAt = now;
    task.updatedAt = now;
    orchestration.updatedAt = now;
    return unread.map((message) => ({ ...message }));
  });
}

export async function sendGlobalSubtaskReport(input: {
  projectId: string;
  orchestrationId: string;
  subtaskId: string;
  executionId: string;
  kind: "progress" | "question" | "blocked";
  summary: string;
  text: string;
}, dataDir = getZenmeDataDir()) {
  const summary = input.summary.trim();
  const text = input.text.trim();
  if (!summary || summary.length > 500 || !text || text.length > 200_000) {
    throw new GlobalOrchestrationError("Sub-agent 报告无效", "invalid_input");
  }
  return mutate(input.projectId, input.orchestrationId, dataDir, (orchestration) => {
    const task = requireTask(orchestration, input.subtaskId);
    if (task.agentExecutionId !== input.executionId ||
      !["running", "waitingApproval", "waitingInput"].includes(task.status)) {
      throw new GlobalOrchestrationError("Sub-agent 当前不能发送报告", "invalid_status");
    }
    const now = new Date().toISOString();
    const message: GlobalSubtaskMessage = {
      id: crypto.randomUUID(),
      from: "subagent",
      senderName: task.name ?? task.title,
      recipientName: "team-lead",
      kind: input.kind,
      summary,
      text,
      createdAt: now,
    };
    task.messages ??= [];
    task.messages.push(message);
    task.updatedAt = now;
    orchestration.updatedAt = now;
    return { ...message };
  });
}

/**
 * Persistent cc-haha-style Team mailbox. A teammate can address the lead,
 * another named teammate, or broadcast plain text to every other teammate.
 * Terminal teammates are resumed on the same Execution when new work arrives.
 */
export async function sendGlobalTeamMessage(input: {
  approve?: boolean;
  executionId: string;
  kind?: GlobalSubtaskMessage["kind"];
  message: string;
  orchestrationId: string;
  projectId: string;
  reason?: string;
  requestId?: string;
  senderSubtaskId: string;
  summary?: string;
  to: string;
}, dataDir = getZenmeDataDir()) {
  const message = input.message.trim();
  const to = input.to.trim();
  const summary = input.summary?.trim();
  if (!message || message.length > 200_000 || !to || to.length > 100 || (summary?.length ?? 0) > 500) {
    throw new GlobalOrchestrationError("Team 消息参数无效", "invalid_input");
  }
  if (input.kind === "shutdown_response") {
    if (to !== "team-lead" || !input.requestId) {
      throw new GlobalOrchestrationError("shutdown_response 必须携带 requestId 并发送给 team-lead", "invalid_input");
    }
    if (input.approve === false && !input.reason?.trim()) {
      throw new GlobalOrchestrationError("拒绝 shutdown_request 时必须说明原因", "invalid_input");
    }
  } else if (input.requestId || input.approve !== undefined || input.reason) {
    throw new GlobalOrchestrationError("只有 shutdown_response 可以携带响应字段", "invalid_input");
  }
  if (to === "*" && (input.kind === "shutdown_request" || input.kind === "shutdown_response")) {
    throw new GlobalOrchestrationError("结构化关闭消息不能广播", "invalid_input");
  }
  const generatedRequestId = input.kind === "shutdown_request" ? crypto.randomUUID() : input.requestId;
  const delivery = await mutate(input.projectId, input.orchestrationId, dataDir, (orchestration) => {
    if (orchestration.kind !== "team" || orchestration.deletedAt) {
      throw new GlobalOrchestrationError("团队不存在或已经关闭", "invalid_status");
    }
    const sender = requireTask(orchestration, input.senderSubtaskId);
    if (sender.agentExecutionId !== input.executionId ||
      !["running", "waitingApproval", "waitingInput"].includes(sender.status)) {
      throw new GlobalOrchestrationError("发送者当前不能发送 Team 消息", "invalid_status");
    }
    const senderName = sender.name ?? sender.title;
    const now = new Date().toISOString();
    const routedMessage: GlobalSubtaskMessage = {
      id: crypto.randomUUID(),
      from: "subagent",
      senderName,
      recipientName: to,
      text: message,
      kind: input.kind,
      summary: summary || undefined,
      requestId: generatedRequestId,
      approve: input.kind === "shutdown_response" ? input.approve : undefined,
      reason: input.reason?.trim() || undefined,
      createdAt: now,
    };
    if (to === "team-lead") {
      if (input.kind === "shutdown_response") {
        const request = sender.messages.find((candidate) =>
          candidate.from === "parent" && candidate.kind === "shutdown_request" &&
          candidate.requestId === input.requestId);
        if (!request) {
          throw new GlobalOrchestrationError("shutdown_request 不存在或不属于当前成员", "not_found");
        }
        if (sender.messages.some((candidate) =>
          candidate.from === "subagent" && candidate.kind === "shutdown_response" &&
          candidate.requestId === input.requestId)) {
          throw new GlobalOrchestrationError("shutdown_request 已经响应", "invalid_status");
        }
      }
      sender.messages.push(routedMessage);
      sender.updatedAt = now;
      orchestration.updatedAt = now;
      return {
        parentTurnId: orchestration.parentTurnId,
        message: routedMessage,
        recipients: ["team-lead"],
        recipientAgentIds: [] as string[],
        reactivatedAgentIds: [] as string[],
      };
    }
    const selected = to === "*"
      ? orchestration.tasks.filter((task) => task.id !== sender.id)
      : orchestration.tasks.filter((task) =>
        task.id !== sender.id && (task.name ?? task.title).toLocaleLowerCase() === to.toLocaleLowerCase());
    if (!selected.length) throw new GlobalOrchestrationError("没有找到消息接收者", "not_found");
    const recipients: string[] = [];
    const recipientAgentIds: string[] = [];
    const reactivatedAgentIds: string[] = [];
    for (const target of selected) {
      const active = ["queued", "dispatching", "running", "waitingApproval", "waitingInput"].includes(target.status);
      const canReactivate = ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(target.status) &&
        Boolean(target.agentExecutionId);
      if (!active && !canReactivate) continue;
      const targetName = target.name ?? target.title;
      target.messages.push({ ...routedMessage, id: crypto.randomUUID(), recipientName: targetName });
      target.updatedAt = now;
      recipients.push(targetName);
      recipientAgentIds.push(target.id);
      if (canReactivate) reactivatedAgentIds.push(target.id);
    }
    if (!recipients.length) throw new GlobalOrchestrationError("没有可接收消息的 Agent", "not_found");
    orchestration.updatedAt = now;
    return {
      parentTurnId: orchestration.parentTurnId,
      message: routedMessage,
      recipients,
      recipientAgentIds,
      reactivatedAgentIds,
    };
  });
  for (const taskId of delivery.reactivatedAgentIds) {
    const current = await requireOrchestration(input.projectId, input.orchestrationId, dataDir);
    const task = requireTask(current, taskId);
    if (!task.agentExecutionId) continue;
    await retryAgentExecution(input.projectId, task.agentExecutionId, dataDir);
    await mutate(input.projectId, input.orchestrationId, dataDir, (team) => {
      const target = requireTask(team, taskId);
      const now = new Date().toISOString();
      target.status = "running";
      delete target.completedAt;
      delete target.error;
      delete target.resultSummary;
      target.updatedAt = now;
      team.status = "running";
      delete team.completedAt;
      team.updatedAt = now;
    });
  }
  return delivery;
}

export async function broadcastProjectTurnMessageToSubagents(
  projectId: string,
  parentTurnId: string,
  text: string,
  dataDir = getZenmeDataDir(),
) {
  const active = (await listGlobalOrchestrations(projectId, dataDir)).filter((orchestration) =>
    orchestration.parentTurnId === parentTurnId &&
    !["completed", "failed", "stopped", "interrupted"].includes(orchestration.status));
  const deliveries = await Promise.all(active.map((orchestration) => sendGlobalSubtaskMessage({
    projectId,
    orchestrationId: orchestration.id,
    text,
  }, dataDir)));
  return deliveries.flatMap((delivery) => delivery.recipients);
}

export async function refreshGlobalOrchestration(projectId: string, orchestrationId: string, dataDir = getZenmeDataDir()) {
  return synchronizeRuntime(await requireOrchestration(projectId, orchestrationId, dataDir), dataDir);
}

export async function retryGlobalSubtask(projectId: string, orchestrationId: string, subtaskId: string, dataDir = getZenmeDataDir()) {
  const orchestration = await requireOrchestration(projectId, orchestrationId, dataDir);
  const task = requireTask(orchestration, subtaskId);
  if (!task.agentExecutionId || !["failed", "timedOut", "stopped", "interrupted"].includes(task.status)) {
    throw new GlobalOrchestrationError("Sub-agent 当前状态不能重试", "invalid_status");
  }
  await retryAgentExecution(projectId, task.agentExecutionId, dataDir);
  return mutate(projectId, orchestrationId, dataDir, (next) => {
    const target = requireTask(next, subtaskId);
    target.status = "running";
    delete target.error;
    delete target.completedAt;
    target.updatedAt = new Date().toISOString();
    next.status = "running";
    next.updatedAt = target.updatedAt;
    return target;
  });
}

export async function stopGlobalOrchestration(projectId: string, orchestrationId: string, dataDir = getZenmeDataDir()) {
  const orchestration = await requireOrchestration(projectId, orchestrationId, dataDir);
  for (const task of orchestration.tasks) {
    if (task.agentExecutionId && (task.status === "running" || task.status === "waitingApproval" || task.status === "waitingInput")) {
      await stopRunningAgentCommands(projectId, task.agentExecutionId);
      await stopAgentExecution(projectId, task.agentExecutionId, dataDir).catch(() => undefined);
    }
  }
  return mutate(projectId, orchestrationId, dataDir, (next) => {
    const now = new Date().toISOString();
    next.status = "stopped";
    next.completedAt = now;
    next.updatedAt = now;
    for (const task of next.tasks) {
      if (["queued", "dispatching", "running", "waitingApproval", "waitingInput"].includes(task.status)) {
        task.status = "stopped";
        task.completedAt = now;
        task.updatedAt = now;
      }
    }
    return next;
  });
}

export async function stopGlobalSubtask(
  projectId: string,
  orchestrationId: string,
  subtaskId: string,
  dataDir = getZenmeDataDir(),
) {
  const orchestration = await requireOrchestration(projectId, orchestrationId, dataDir);
  const task = requireTask(orchestration, subtaskId);
  if (["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status)) {
    return task;
  }
  if (task.agentExecutionId) {
    await stopRunningAgentCommands(projectId, task.agentExecutionId);
    await stopAgentExecution(projectId, task.agentExecutionId, dataDir).catch(() => undefined);
  }
  await mutate(projectId, orchestrationId, dataDir, (next) => {
    const target = requireTask(next, subtaskId);
    const now = new Date().toISOString();
    target.status = "stopped";
    target.completedAt = now;
    target.updatedAt = now;
    next.updatedAt = now;
    return target;
  });
  const refreshed = await refreshGlobalOrchestration(projectId, orchestrationId, dataDir);
  return requireTask(refreshed, subtaskId);
}

export async function failGlobalOrchestration(
  projectId: string,
  orchestrationId: string,
  error: string,
  dataDir = getZenmeDataDir(),
) {
  return mutate(projectId, orchestrationId, dataDir, (next) => {
    if (["completed", "failed", "stopped"].includes(next.status)) return next;
    const now = new Date().toISOString();
    next.status = "failed";
    next.error = error.slice(0, 100_000);
    next.completedAt = now;
    next.updatedAt = now;
    for (const task of next.tasks) {
      if (["queued", "dispatching", "running"].includes(task.status)) {
        task.status = "interrupted";
        task.error = next.error;
        task.completedAt = now;
        task.updatedAt = now;
      }
    }
    return next;
  });
}

async function synchronizeRuntime(orchestration: GlobalOrchestration, dataDir: string) {
  const filePath = orchestrationPath(orchestration.projectId, orchestration.id, dataDir);
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const latest = await requireOrchestration(orchestration.projectId, orchestration.id, dataDir);
    return synchronizeRuntimeUnlocked(latest, dataDir);
  });
  locks.set(filePath, next);
  return next.finally(() => { if (locks.get(filePath) === next) locks.delete(filePath); });
}

async function synchronizeRuntimeUnlocked(orchestration: GlobalOrchestration, dataDir: string) {
  const explicitlyStopped = orchestration.status === "stopped";
  let changed = false;
  const changeSets = await listWorkspaceChangeSets(orchestration.projectId, dataDir);
  for (const task of orchestration.tasks) {
    if (!task.agentExecutionId) continue;
    const detail = await getAgentExecution(orchestration.projectId, task.agentExecutionId, dataDir);
    if (!detail) continue;
    const status = subtaskStatus(detail.status, detail.stage);
    if (task.status !== status || JSON.stringify(task.changeSetIds) !== JSON.stringify(detail.changeSetIds) || task.resultSummary !== detail.resultSummary || task.error !== detail.error) {
      task.status = status;
      task.changeSetIds = [...detail.changeSetIds];
      task.resultSummary = detail.resultSummary;
      task.error = detail.error;
      task.updatedAt = detail.updatedAt;
      task.completedAt = detail.completedAt;
      changed = true;
    }
  }
  for (const task of orchestration.tasks) {
    if (!task.worktree || task.worktree.state !== "active" || !["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status)) continue;
    try {
      const settled = await settleProjectAgentWorktree(task.worktree, task.changeSetIds.length > 0);
      task.worktree = settled;
      if (settled.state === "cleaned" && settled.rootId) {
        await removeLocalWorkspaceRoot({ projectId: orchestration.projectId, rootId: settled.rootId }, dataDir);
        task.rootId = settled.originalRootId;
      }
      changed = true;
    } catch {
      task.worktree = { ...task.worktree, state: "kept" };
      changed = true;
    }
  }
  for (const task of orchestration.tasks) {
    if (task.status !== "queued") continue;
    const blocked = task.dependsOn.some((dependencyId) => {
      const dependency = orchestration.tasks.find((candidate) => candidate.id === dependencyId);
      return dependency && ["failed", "timedOut", "stopped", "interrupted"].includes(dependency.status);
    });
    if (blocked) {
      task.status = "stopped";
      task.error = "前置 Sub-agent 未成功，任务未启动";
      task.completedAt = new Date().toISOString();
      task.updatedAt = task.completedAt;
      changed = true;
    }
  }
  const conflicts = mergeConflicts(
    plannedConflicts(orchestration.tasks),
    actualConflicts(orchestration.tasks, changeSets),
  );
  if (JSON.stringify(conflicts) !== JSON.stringify(orchestration.conflicts)) {
    orchestration.conflicts = conflicts;
    changed = true;
  }
  const terminal = orchestration.tasks.every((task) => ["succeeded", "failed", "timedOut", "stopped", "interrupted"].includes(task.status));
  const waiting = orchestration.tasks.some((task) => task.status === "waitingApproval");
  if (terminal && orchestration.kind === "team" && !orchestration.deletedAt && !explicitlyStopped) {
    orchestration.status = "waitingReview";
    orchestration.resultSummary = collectResults(orchestration.tasks);
    orchestration.updatedAt = new Date().toISOString();
    changed = true;
  } else if (terminal && !explicitlyStopped) {
    const linkedIds = new Set(orchestration.tasks.flatMap((task) => task.changeSetIds));
    const linkedChangeSets = changeSets.filter((changeSet) => linkedIds.has(changeSet.id));
    const reviewsFinished = linkedChangeSets.every((changeSet) =>
      ["applied", "rejected", "reverted"].includes(changeSet.status));
    orchestration.status = orchestration.tasks.some((task) => task.status !== "succeeded")
      ? "failed"
      : reviewsFinished
        ? "completed"
        : "waitingReview";
    orchestration.resultSummary = collectResults(orchestration.tasks);
    if (!orchestration.convergenceProposal) {
      const executionIds = new Set(orchestration.tasks.flatMap((task) => task.agentExecutionId ? [task.agentExecutionId] : []));
      const memoryIds = (await listProjectMemories(orchestration.projectId, dataDir)).filter((memory) =>
        memory.sources.some((source) => source.kind === "execution" && executionIds.has(source.id)),
      ).map((memory) => memory.id);
      orchestration.convergenceProposal = {
        generatedAt: new Date().toISOString(),
        summary: orchestration.resultSummary,
        suggestedLifecycle: orchestration.tasks.every((task) => task.status === "succeeded") ? "knowledge" : "archived",
        foldExecutionDetails: true,
        preserveChangeSetIds: [...linkedIds],
        promoteMemoryIds: memoryIds,
        rationale: [
          "主画布只保留 Global Agent 结果节点，不展开高频工具步骤和临时 Sub-agent。",
          "Execution 详情归档后仍可从结果节点追溯。",
          "Workspace 文件、ChangeSet 审批历史与 Project Memory 不会因画布收敛被删除。",
        ],
      };
    }
    orchestration.completedAt = new Date().toISOString();
    changed = true;
  } else if (!explicitlyStopped && waiting && !orchestration.tasks.some((task) => task.status === "running")) {
    orchestration.status = "waitingReview";
    changed = true;
  }
  if (changed) {
    orchestration.updatedAt = new Date().toISOString();
    await writeOrchestration(orchestration, dataDir);
  }
  return orchestration;
}

function mergeConflicts(...groups: GlobalConflictEdge[][]) {
  const merged = new Map<string, GlobalConflictEdge>();
  for (const conflict of groups.flat()) {
    const key = [conflict.leftSubtaskId, conflict.rightSubtaskId].sort().join(":");
    const current = merged.get(key);
    merged.set(key, {
      leftSubtaskId: conflict.leftSubtaskId,
      rightSubtaskId: conflict.rightSubtaskId,
      relativePaths: [...new Set([...(current?.relativePaths ?? []), ...conflict.relativePaths])].sort(),
    });
  }
  return [...merged.values()];
}

function actualConflicts(tasks: GlobalSubtask[], changeSets: Awaited<ReturnType<typeof listWorkspaceChangeSets>>) {
  const paths = new Map<string, Set<string>>();
  for (const task of tasks) {
    const taskPaths = new Set<string>();
    for (const changeSet of changeSets.filter((item) =>
      item.sourceExecutionId === task.agentExecutionId && (!task.rootId || item.rootId === task.rootId))) {
      for (const operation of changeSet.operations) {
        taskPaths.add(operation.relativePath);
        if (operation.targetRelativePath) taskPaths.add(operation.targetRelativePath);
      }
    }
    paths.set(task.id, taskPaths);
  }
  return conflictEdges(tasks, paths);
}

function plannedConflicts(tasks: GlobalSubtask[]) {
  return conflictEdges(tasks, new Map(tasks.map((task) => [task.id, new Set(task.allowedPathPrefixes)])));
}

function conflictEdges(tasks: GlobalSubtask[], paths: Map<string, Set<string>>): GlobalConflictEdge[] {
  const conflicts: GlobalConflictEdge[] = [];
  for (let left = 0; left < tasks.length; left += 1) for (let right = left + 1; right < tasks.length; right += 1) {
    if ((tasks[left].rootId ?? "") !== (tasks[right].rootId ?? "")) continue;
    const overlaps = [...(paths.get(tasks[left].id) ?? [])].filter((leftPath) =>
      [...(paths.get(tasks[right].id) ?? [])].some((rightPath) => pathsOverlap(leftPath, rightPath)));
    if (overlaps.length) conflicts.push({ leftSubtaskId: tasks[left].id, rightSubtaskId: tasks[right].id, relativePaths: overlaps.sort() });
  }
  return conflicts;
}

function topologicalOrder(tasks: GlobalSubtask[]) {
  const result: string[] = [];
  const remaining = new Set(tasks.map((task) => task.id));
  while (remaining.size) {
    const ready = tasks.filter((task) => remaining.has(task.id) && task.dependsOn.every((id) => !remaining.has(id)));
    if (!ready.length) return tasks.map((task) => task.id);
    for (const task of ready) { result.push(task.id); remaining.delete(task.id); }
  }
  return result;
}

async function captureBaselines(projectId: string, rootId: string, scopes: string[], dataDir: string) {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  if (!binding) return {};
  const root = resolveWorkspaceRoot(binding, rootId);
  if (!root || !canUseWorkspaceRootCapability(root, "read")) return {};
  const entries = await listWorkspaceFiles(projectId, dataDir, root.id);
  const files = entries.filter((entry) => entry.kind === "file" && !entry.sensitive && scopes.some((scope) => pathsOverlap(entry.relativePath, scope))).slice(0, MAX_BASELINE_FILES);
  const hashes: Record<string, string> = {};
  for (const entry of files) {
    if (isSensitiveWorkspacePath(entry.relativePath)) continue;
    try {
      const filePath = await resolveExistingWorkspacePath(root.realPath, entry.relativePath);
      if ((await fs.stat(filePath)).size > 4 * 1024 * 1024) continue;
      hashes[entry.relativePath] = crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
    } catch (error) {
      if (error instanceof WorkspacePathError) continue;
      throw error;
    }
  }
  return hashes;
}

function normalizeScopes(values?: string[]) {
  const scopes = dedupe(values).map((value) => value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") || ".");
  for (const scope of scopes) {
    if (path.posix.isAbsolute(scope) || scope.split("/").includes("..") || isSensitiveWorkspacePath(scope)) {
      throw new GlobalOrchestrationError("Sub-agent 路径范围无效", "invalid_input");
    }
  }
  return scopes.length ? scopes : ["."];
}

function normalizeTools(values: AgentWorkspaceToolName[] | undefined, kind: GlobalOrchestration["kind"], planModeRequired = false) {
  const tools = Array.from(new Set(values?.length ? values : DEFAULT_TOOLS));
  const normalized = tools.filter((tool) => tool !== "ask_user_question" &&
    !["task_output", "task_stop"].includes(tool) &&
    (DEFAULT_TOOLS.includes(tool) || ["shell_command", "run_approved_command", ...COLLABORATION_TASK_TOOLS].includes(tool)));
  if (kind === "team") {
    for (const tool of COLLABORATION_TASK_TOOLS) {
      if (!normalized.includes(tool)) normalized.push(tool);
    }
    if (planModeRequired && !normalized.includes("exit_plan_mode")) normalized.push("exit_plan_mode");
  } else {
    return normalized.filter((tool) => !COLLABORATION_TASK_TOOLS.includes(tool));
  }
  return normalized;
}

function normalizeEvidence(values?: GlobalContextEvidence[]) {
  return (values ?? []).filter((value) => value && typeof value.id === "string" && typeof value.reason === "string")
    .slice(0, 1_000).map((value) => ({ ...value, id: value.id.slice(0, 500), reason: value.reason.slice(0, 2_000) }));
}

function validateCreate(input: { allowEmptyTeam?: boolean; goal: string; projectId: string; resultNodeId: string; tasks: GlobalTaskPlanInput[]; triggerNodeId: string }) {
  assertSafePathSegment(input.projectId, "projectId");
  if (!input.goal?.trim() || !input.resultNodeId || !input.triggerNodeId || !Array.isArray(input.tasks) || (!input.allowEmptyTeam && input.tasks.length < 1) || input.tasks.length > MAX_SUBAGENTS || input.tasks.some((task) => !task?.title?.trim() || !task.instruction?.trim())) {
    throw new GlobalOrchestrationError("Global Agent 计划参数无效", "invalid_input");
  }
  for (let index = 0; index < input.tasks.length; index += 1) {
    if ((input.tasks[index].dependsOn ?? []).some((dependency) => !Number.isInteger(dependency) || dependency < 0 || dependency >= index)) {
      throw new GlobalOrchestrationError("Sub-agent 依赖必须指向更早的任务", "invalid_input");
    }
  }
}

function subtaskStatus(status: string, stage: string): GlobalSubtaskStatus {
  if (stage === "waitingApproval") return "waitingApproval";
  if (stage === "waitingInput") return "waitingInput";
  return status === "polling" ? "running" : status as GlobalSubtaskStatus;
}

function collectResults(tasks: GlobalSubtask[]) {
  return tasks.map((task) => {
    const reports = task.messages.filter((message) =>
      message.from === "subagent" && (!message.recipientName || message.recipientName === "team-lead"))
      .map((message) => `${message.summary ?? message.kind ?? "报告"}：${message.text}`).join("；");
    return `${task.title}：${task.resultSummary || task.error || task.status}${reports ? `\n  协作报告：${reports}` : ""}`;
  }).join("\n").slice(0, 100_000);
}

function delegatedInstruction(orchestration: GlobalOrchestration, task: GlobalSubtask) {
  const dependencies = task.dependsOn.flatMap((dependencyId) => {
    const dependency = orchestration.tasks.find((candidate) => candidate.id === dependencyId);
    if (!dependency) return [];
    return [{
      title: dependency.title,
      result: dependency.resultSummary || dependency.error || dependency.status,
      reports: dependency.messages.filter((message) =>
        message.from === "subagent" && (!message.recipientName || message.recipientName === "team-lead"))
        .map((message) => ({ kind: message.kind, summary: message.summary, text: message.text })),
      changeSetIds: dependency.changeSetIds,
    }];
  });
  if (!dependencies.length) return task.instruction;
  return `${task.instruction}\n\n前置 Sub-agent 已完成。以下是经过调度器传递的依赖结果，请据此继续，不要重新猜测前置工作：\n${JSON.stringify(dependencies)}`.slice(0, 200_000);
}

function pathsOverlap(left: string, right: string) {
  return left === "." || right === "." || left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return Number.isInteger(value) ? Math.max(min, Math.min(max, value!)) : fallback;
}

function dedupe(values?: string[]) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length <= 1_000))];
}

function requireTask(orchestration: GlobalOrchestration, taskId: string) {
  const task = orchestration.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new GlobalOrchestrationError("Sub-agent 不存在", "not_found");
  return task;
}

async function requireOrchestration(projectId: string, orchestrationId: string, dataDir: string) {
  const orchestration = await readOrchestration(projectId, orchestrationId, dataDir);
  if (!orchestration) throw new GlobalOrchestrationError("Global Agent 调度不存在", "not_found");
  return orchestration;
}

function mutate<T>(projectId: string, orchestrationId: string, dataDir: string, update: (value: GlobalOrchestration) => T) {
  const filePath = orchestrationPath(projectId, orchestrationId, dataDir);
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const value = await requireOrchestration(projectId, orchestrationId, dataDir);
    const result = update(value);
    await writeOrchestration(value, dataDir);
    return result;
  });
  locks.set(filePath, next);
  return next.finally(() => { if (locks.get(filePath) === next) locks.delete(filePath); }) as Promise<T>;
}

function readOrchestration(projectId: string, orchestrationId: string, dataDir: string) {
  assertSafePathSegment(projectId, "projectId");
  assertSafePathSegment(orchestrationId, "orchestrationId");
  return readJsonFile<GlobalOrchestration | null>(orchestrationPath(projectId, orchestrationId, dataDir), { defaultValue: null, normalize: normalizeOrchestration });
}

async function writeOrchestration(value: GlobalOrchestration, dataDir: string) {
  const filePath = orchestrationPath(value.projectId, value.id, dataDir);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeJsonFile(filePath, value);
}

function directoryPath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "executions", "global");
}

function orchestrationPath(projectId: string, orchestrationId: string, dataDir: string) {
  return resolveInside(directoryPath(projectId, dataDir), `${orchestrationId}.json`);
}

function normalizeOrchestration(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as GlobalOrchestration;
  if (item.version !== GLOBAL_ORCHESTRATION_VERSION || typeof item.id !== "string" || typeof item.projectId !== "string" || !Array.isArray(item.tasks)) return null;
  item.contextSnapshot = parseAgentContextSnapshot(item.contextSnapshot);
  for (const task of item.tasks) task.messages ??= [];
  return item;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 4_000) : "Sub-agent 启动失败";
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
