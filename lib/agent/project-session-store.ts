import crypto from "node:crypto";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getLocalProject } from "@/lib/local/project-repository";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import {
  PROJECT_AGENT_SESSION_VERSION,
  type ProjectAgentCompactCheckpoint,
  type ProjectAgentConversation,
  type ProjectAgentContextBudget,
  type ProjectAgentContextState,
  type ProjectAgentEvent,
  type ProjectAgentEventType,
  type ProjectAgentSession,
  type ProjectAgentTaskItem,
} from "@/lib/agent/project-session-types";
import {
  estimateProjectAgentEventTokens,
  estimateProjectAgentTextTokens,
  projectProjectAgentToolResultsForModel,
  thinProjectAgentToolResults,
} from "@/lib/agent/project-context-policy";
import { normalizeProjectAgentHooks, type ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import { projectConversationEvents, projectUnscopedConversationEvents } from "@/lib/agent/project-agent-transcript";

const mutationLocks = new Map<string, Promise<unknown>>();
const MAX_EVENT_CONTENT_LENGTH = 500_000;
const MAX_EVENT_DATA_LENGTH = 500_000;
const MAX_SUMMARY_LENGTH = 500_000;
const MAX_EVENTS = 100_000;
const MAX_CHECKPOINTS = 1_000;
const MAX_CONSECUTIVE_COMPACTION_FAILURES = 3;

export class ProjectAgentSessionError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_input" | "project_not_found" | "capacity_exceeded",
  ) {
    super(message);
    this.name = "ProjectAgentSessionError";
  }
}

export async function getProjectAgentSession(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  validateProjectId(projectId);
  const filePath = sessionPath(projectId, dataDir);
  const existing = await readJsonFile<ProjectAgentSession | null>(filePath, {
    defaultValue: null,
    normalize: normalizeSession,
  });
  if (existing) return existing;

  if (!await getLocalProject(projectId, dataDir)) {
    throw new ProjectAgentSessionError("项目不存在", "project_not_found");
  }

  return mutateSession(projectId, dataDir, (current) => current);
}

export async function appendProjectAgentEvent(input: {
  projectId: string;
  turnId?: string;
  conversationId?: string;
  parentConversationIds?: string[];
  parentTurnId?: string;
  sourceNodeId?: string;
  resultNodeId?: string;
  type: ProjectAgentEventType;
  content?: string;
  data?: Record<string, unknown>;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  validateEventInput(input);
  let appended!: ProjectAgentEvent;
  await mutateSession(input.projectId, dataDir, (session) => {
    if (session.events.length >= MAX_EVENTS) {
      throw new ProjectAgentSessionError("项目 Agent 事件流已达到容量上限", "capacity_exceeded");
    }
    const now = new Date().toISOString();
    appended = {
      id: crypto.randomUUID(),
      sequence: (session.events.at(-1)?.sequence ?? 0) + 1,
      turnId: input.turnId?.trim() || crypto.randomUUID(),
      conversationId: input.conversationId?.trim() || undefined,
      parentTurnId: input.parentTurnId?.trim() || undefined,
      sourceNodeId: input.sourceNodeId?.trim() || undefined,
      resultNodeId: input.resultNodeId?.trim() || undefined,
      type: input.type,
      createdAt: now,
      content: input.content,
      data: input.data,
    };
    const conversationId = appended.conversationId;
    if (conversationId) {
      const conversations = session.conversations ?? (session.conversations = []);
      const existingConversation = conversations.find((conversation) => conversation.id === conversationId);
      if (existingConversation) {
        existingConversation.updatedAt = now;
      } else {
        const parentConversationIds = [...new Set((input.parentConversationIds ?? []).filter(Boolean))];
        conversations.push({
          id: conversationId,
          rootNodeId: appended.sourceNodeId,
          parentConversationIds: parentConversationIds.length ? parentConversationIds : undefined,
          forkedFromTurnId: parentConversationIds.length ? appended.parentTurnId : undefined,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    session.events.push(appended);
    session.updatedAt = now;
    return session;
  });
  return appended;
}

export async function updateProjectAgentEvent(input: {
  projectId: string;
  eventId: string;
  content?: string;
  data?: Record<string, unknown>;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  if (!input.eventId.trim() || (input.content !== undefined && input.content.length > MAX_EVENT_CONTENT_LENGTH) ||
    (input.data !== undefined && (!isObject(input.data) || serializedLength(input.data) > MAX_EVENT_DATA_LENGTH))) {
    throw new ProjectAgentSessionError("Agent 事件更新无效", "invalid_input");
  }
  let updated!: ProjectAgentEvent;
  await mutateSession(input.projectId, dataDir, (session) => {
    const event = session.events.find((candidate) => candidate.id === input.eventId);
    if (!event) throw new ProjectAgentSessionError("Agent 事件不存在", "invalid_input");
    if (input.content !== undefined) event.content = input.content;
    if (input.data !== undefined) event.data = { ...event.data, ...input.data };
    session.updatedAt = new Date().toISOString();
    updated = { ...event, data: event.data ? { ...event.data } : undefined };
    return session;
  });
  return updated;
}

export async function updateProjectAgentConversationContext(input: {
  projectId: string;
  conversationId: string;
  summary?: string;
  compactedThroughSequence?: number;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new ProjectAgentSessionError("Conversation 标识无效", "invalid_input");
  }
  if (input.summary !== undefined && input.summary.trim().length > MAX_SUMMARY_LENGTH) {
    throw new ProjectAgentSessionError("Conversation 摘要无效", "invalid_input");
  }
  if (
    input.compactedThroughSequence !== undefined &&
    (!Number.isSafeInteger(input.compactedThroughSequence) || input.compactedThroughSequence < 0)
  ) {
    throw new ProjectAgentSessionError("Conversation 压缩边界无效", "invalid_input");
  }

  let updated!: ProjectAgentConversation;
  await mutateSession(input.projectId, dataDir, (session) => {
    const conversation = session.conversations?.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      throw new ProjectAgentSessionError("Conversation 不存在", "invalid_input");
    }
    const now = new Date().toISOString();
    if (input.summary !== undefined) {
      const summary = input.summary.trim();
      if (summary) conversation.summary = summary;
      else delete conversation.summary;
    }
    if (input.compactedThroughSequence !== undefined) {
      conversation.compactedThroughSequence = input.compactedThroughSequence;
      conversation.consecutiveCompactionFailures = 0;
      conversation.lastCompactedAt = now;
      delete conversation.compactionBlockedAt;
      delete conversation.lastCompactionFailureCode;
    }
    conversation.updatedAt = now;
    session.updatedAt = now;
    updated = { ...conversation };
    return session;
  });
  return updated;
}

export async function upsertProjectAgentAnswerDraft(input: {
  projectId: string;
  turnId: string;
  content: string;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  const content = input.content;
  if (!input.turnId.trim() || !content.trim() || content.length > MAX_EVENT_CONTENT_LENGTH) {
    throw new ProjectAgentSessionError("Agent 回复草稿无效", "invalid_input");
  }
  let draft!: ProjectAgentEvent;
  await mutateSession(input.projectId, dataDir, (session) => {
    const existing = session.events.findLast((event) =>
      event.turnId === input.turnId && event.type === "assistantDraft",
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.content = content;
      existing.data = { ...existing.data, status: "streaming", updatedAt: now };
      draft = existing;
    } else {
      if (session.events.length >= MAX_EVENTS) {
        throw new ProjectAgentSessionError("项目 Agent 事件流已达到容量上限", "capacity_exceeded");
      }
      draft = {
        id: crypto.randomUUID(),
        sequence: (session.events.at(-1)?.sequence ?? 0) + 1,
        turnId: input.turnId,
        type: "assistantDraft",
        createdAt: now,
        content,
        data: { status: "streaming", updatedAt: now },
      };
      session.events.push(draft);
    }
    session.updatedAt = now;
    return session;
  });
  return draft;
}

export async function clearProjectAgentAnswerDraft(input: {
  projectId: string;
  turnId: string;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  if (!input.turnId.trim()) throw new ProjectAgentSessionError("Turn 参数无效", "invalid_input");
  return mutateSession(input.projectId, dataDir, (session) => {
    const previousLength = session.events.length;
    session.events = session.events.filter((event) =>
      event.turnId !== input.turnId || event.type !== "assistantDraft",
    );
    if (session.events.length !== previousLength) session.updatedAt = new Date().toISOString();
    return session;
  });
}

export async function updateProjectAgentContext(input: {
  projectId: string;
  interactionMode?: "default" | "plan";
  activePlan?: string | null;
  activeWorktree?: ProjectAgentContextState["activeWorktree"] | null;
  modelId?: string | null;
  permissionMode?: "untrusted" | "onRequest" | "neverAsk";
  contextWindowTokens?: number | null;
  inputTokens?: number;
  outputTokens?: number;
  estimatedEffectiveTokens?: number;
  skillHooks?: ProjectAgentHooks | null;
  consumedHookIds?: string[];
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  validateTokenCount(input.contextWindowTokens, "contextWindowTokens", true);
  validateTokenCount(input.inputTokens, "inputTokens");
  validateTokenCount(input.outputTokens, "outputTokens");
  validateTokenCount(input.estimatedEffectiveTokens, "estimatedEffectiveTokens");
  return mutateSession(input.projectId, dataDir, (session) => {
    session.context = {
      ...session.context,
      interactionMode: input.interactionMode ?? session.context.interactionMode ?? "default",
      activePlan: input.activePlan === undefined
        ? session.context.activePlan
        : input.activePlan === null ? undefined : input.activePlan.slice(0, MAX_SUMMARY_LENGTH),
      activeWorktree: input.activeWorktree === undefined
        ? session.context.activeWorktree
        : input.activeWorktree === null ? undefined : input.activeWorktree,
      modelId: input.modelId === undefined ? session.context.modelId : normalizeModelId(input.modelId),
      permissionMode: input.permissionMode === undefined ? session.context.permissionMode : input.permissionMode,
      contextWindowTokens: input.contextWindowTokens === undefined
        ? session.context.contextWindowTokens
        : input.contextWindowTokens,
      inputTokens: input.inputTokens ?? session.context.inputTokens,
      outputTokens: input.outputTokens ?? session.context.outputTokens,
      estimatedEffectiveTokens: input.estimatedEffectiveTokens ?? session.context.estimatedEffectiveTokens,
      skillHooks: input.skillHooks === undefined
        ? session.context.skillHooks
        : input.skillHooks === null ? undefined : normalizeProjectAgentHooks(input.skillHooks, { preserveRuntimeMetadata: true }),
      consumedHookIds: input.consumedHookIds === undefined
        ? session.context.consumedHookIds
        : [...new Set(input.consumedHookIds.filter((value) => /^[a-f0-9]{64}$/.test(value)))].slice(-2_000),
    };
    session.updatedAt = new Date().toISOString();
    return session;
  });
}

export async function updateProjectAgentTaskPlan(input: {
  projectId: string;
  items: ProjectAgentTaskItem[];
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  const items = normalizeTaskPlan(input.items);
  if (items.length !== input.items.length) {
    throw new ProjectAgentSessionError("Agent 任务清单无效", "invalid_input");
  }
  return mutateSession(input.projectId, dataDir, (session) => {
    session.taskPlan = items.every((item) => item.status === "completed") ? [] : items;
    session.updatedAt = new Date().toISOString();
    return session.taskPlan;
  });
}

export async function createProjectAgentTask(input: {
  projectId: string;
  subject: string;
  description: string;
  activeForm?: string;
  owner?: string;
  blockedBy?: string[];
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  const subject = requiredTaskText(input.subject, 10_000);
  const description = requiredTaskText(input.description, 100_000);
  const blockedBy = normalizeTaskIds(input.blockedBy);
  return mutateSession(input.projectId, dataDir, (session) => {
    if (session.taskPlan.length >= 100) throw new ProjectAgentSessionError("Agent 任务清单容量已满", "capacity_exceeded");
    assertTaskIdsExist(session.taskPlan, blockedBy);
    const now = new Date().toISOString();
    const task: ProjectAgentTaskItem = {
      id: crypto.randomUUID(),
      content: subject,
      description,
      status: "pending",
      blockedBy,
      ...(optionalTaskText(input.activeForm, 10_000) ? { activeForm: optionalTaskText(input.activeForm, 10_000) } : {}),
      ...(optionalTaskText(input.owner, 500) ? { owner: optionalTaskText(input.owner, 500) } : {}),
      createdAt: now,
      updatedAt: now,
    };
    session.taskPlan.push(task);
    assertAcyclicTaskDependencies(session.taskPlan);
    session.updatedAt = now;
    return { ...task, blockedBy: [...blockedBy] };
  });
}

export async function getProjectAgentTask(projectId: string, taskId: string, dataDir = getZenmeDataDir()) {
  validateProjectId(projectId);
  const normalizedId = requiredTaskText(taskId, 500);
  const session = await getProjectAgentSession(projectId, dataDir);
  const task = session.taskPlan.find((item) => item.id === normalizedId);
  return task ? { ...task, blockedBy: [...(task.blockedBy ?? [])] } : null;
}

export async function listProjectAgentTasks(projectId: string, dataDir = getZenmeDataDir()) {
  validateProjectId(projectId);
  const session = await getProjectAgentSession(projectId, dataDir);
  const completedIds = new Set(session.taskPlan.filter((item) => item.status === "completed").map((item) => item.id));
  return session.taskPlan.map((task) => ({
    id: task.id,
    subject: task.content,
    status: task.status,
    ...(task.owner ? { owner: task.owner } : {}),
    blockedBy: (task.blockedBy ?? []).filter((id) => !completedIds.has(id)),
  }));
}

export async function updateProjectAgentTask(input: {
  projectId: string;
  taskId: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  status?: ProjectAgentTaskItem["status"] | "deleted";
  addBlockedBy?: string[];
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  if (input.status !== undefined && !["pending", "in_progress", "completed", "deleted"].includes(input.status)) {
    throw new ProjectAgentSessionError("Agent 任务状态无效", "invalid_input");
  }
  const taskId = requiredTaskText(input.taskId, 500);
  return mutateSession(input.projectId, dataDir, (session) => {
    const index = session.taskPlan.findIndex((item) => item.id === taskId);
    if (index < 0) throw new ProjectAgentSessionError("Agent 任务不存在", "invalid_input");
    const previous = session.taskPlan[index];
    if (input.status === "deleted") {
      if (session.taskPlan.some((item) => (item.blockedBy ?? []).includes(taskId))) {
        throw new ProjectAgentSessionError("Agent 任务仍被其他任务依赖，无法删除", "invalid_input");
      }
      session.taskPlan.splice(index, 1);
      session.updatedAt = new Date().toISOString();
      return null;
    }
    const addBlockedBy = normalizeTaskIds(input.addBlockedBy);
    assertTaskIdsExist(session.taskPlan, addBlockedBy);
    if (addBlockedBy.includes(taskId)) throw new ProjectAgentSessionError("Agent 任务不能依赖自身", "invalid_input");
    const updated: ProjectAgentTaskItem = {
      ...previous,
      ...(input.subject === undefined ? {} : { content: requiredTaskText(input.subject, 10_000) }),
      ...(input.description === undefined ? {} : { description: requiredTaskText(input.description, 100_000) }),
      ...(input.activeForm === undefined ? {} : { activeForm: optionalTaskText(input.activeForm, 10_000) }),
      ...(input.owner === undefined ? {} : { owner: optionalTaskText(input.owner, 500) }),
      ...(input.status === undefined ? {} : { status: input.status }),
      blockedBy: Array.from(new Set([...(previous.blockedBy ?? []), ...addBlockedBy])),
      updatedAt: new Date().toISOString(),
    };
    session.taskPlan[index] = updated;
    assertAcyclicTaskDependencies(session.taskPlan);
    session.updatedAt = updated.updatedAt!;
    return { ...updated, blockedBy: [...(updated.blockedBy ?? [])] };
  });
}

export async function createProjectAgentCompactCheckpoint(input: {
  projectId: string;
  summary: string;
  compactedThroughSequence: number;
  sourceTokenEstimate: number;
  turnId?: string;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  const summary = input.summary.trim();
  if (!summary || summary.length > MAX_SUMMARY_LENGTH) {
    throw new ProjectAgentSessionError("上下文摘要无效", "invalid_input");
  }
  validateRequiredTokenCount(input.sourceTokenEstimate, "sourceTokenEstimate");
  if (!Number.isSafeInteger(input.compactedThroughSequence) || input.compactedThroughSequence < 1) {
    throw new ProjectAgentSessionError("压缩边界无效", "invalid_input");
  }

  let checkpoint!: ProjectAgentCompactCheckpoint;
  await mutateSession(input.projectId, dataDir, (session) => {
    if (session.events.length >= MAX_EVENTS) {
      throw new ProjectAgentSessionError("项目 Agent 事件流已达到容量上限", "capacity_exceeded");
    }
    const lastSequence = session.events.at(-1)?.sequence ?? 0;
    if (
      input.compactedThroughSequence >= lastSequence ||
      input.compactedThroughSequence <= session.context.compactedThroughSequence
    ) {
      throw new ProjectAgentSessionError("压缩边界必须保留近期事件", "invalid_input");
    }
    const boundaryEvent = session.events.find((event) => event.sequence === input.compactedThroughSequence);
    const nextEvent = session.events.find((event) => event.sequence > input.compactedThroughSequence && event.type !== "compact");
    if (!boundaryEvent || !nextEvent || boundaryEvent.turnId === nextEvent.turnId) {
      throw new ProjectAgentSessionError("压缩边界不能拆分同一 Turn", "invalid_input");
    }
    if (session.events.some((event) =>
      event.sequence <= input.compactedThroughSequence &&
      ((event.type === "approval" && isPendingCompactionStatus(event.data?.status)) ||
        (event.type === "toolCall" && isRunningCompactionStatus(event.data?.status))),
    )) {
      throw new ProjectAgentSessionError("压缩边界不能越过待审批或运行中的工具", "invalid_input");
    }
    if (session.compactCheckpoints.length >= MAX_CHECKPOINTS) {
      throw new ProjectAgentSessionError("项目 Agent 压缩检查点已达到容量上限", "capacity_exceeded");
    }
    const now = new Date().toISOString();
    checkpoint = {
      id: crypto.randomUUID(),
      summary,
      compactedThroughSequence: input.compactedThroughSequence,
      sourceTokenEstimate: input.sourceTokenEstimate,
      createdAt: now,
    };
    session.compactCheckpoints.push(checkpoint);
    session.context = {
      ...session.context,
      activeSummary: summary,
      compactedThroughSequence: input.compactedThroughSequence,
      consecutiveCompactionFailures: 0,
      lastCompactedAt: now,
      estimatedEffectiveTokens: estimateProjectAgentTextTokens(summary) + session.events
        .filter((event) => event.sequence > input.compactedThroughSequence)
        .reduce((total, event) => total + estimateProjectAgentEventTokens(event), 0),
    };
    delete session.context.compactionBlockedAt;
    delete session.context.lastCompactionFailureCode;
    session.events.push({
      id: crypto.randomUUID(),
      sequence: lastSequence + 1,
      turnId: input.turnId?.trim() || crypto.randomUUID(),
      type: "compact",
      createdAt: now,
      content: summary,
      data: {
        checkpointId: checkpoint.id,
        compactedThroughSequence: input.compactedThroughSequence,
        sourceTokenEstimate: input.sourceTokenEstimate,
      },
    });
    session.updatedAt = now;
    return session;
  });
  return checkpoint;
}

export async function getEffectiveProjectAgentContext(
  projectId: string,
  dataDir = getZenmeDataDir(),
) {
  const session = await getProjectAgentSession(projectId, dataDir);
  return {
    summary: session.context.activeSummary,
    events: session.events.filter(
      (event) => event.sequence > session.context.compactedThroughSequence &&
        event.type !== "compact" && event.type !== "assistantDraft" && event.data?.uiProjection !== true,
    ),
    compactedThroughSequence: session.context.compactedThroughSequence,
  };
}

export async function getProjectAgentModelContext(
  projectId: string,
  dataDir = getZenmeDataDir(),
  conversationId?: string,
) {
  const context = await getEffectiveProjectAgentContext(projectId, dataDir);
  const session = await getProjectAgentSession(projectId, dataDir);
  const conversation = conversationId
    ? session.conversations?.find((candidate) => candidate.id === conversationId)
    : undefined;
  const previouslyClearedEventIds = session.events.flatMap((event) =>
    event.type === "compact" && event.data?.kind === "microcompact" &&
      Array.isArray(event.data.clearedToolResultEventIds)
      ? event.data.clearedToolResultEventIds.filter((id): id is string => typeof id === "string")
      : [],
  );
  const projectionSourceEvents = conversationId
    ? projectConversationEvents(
        session.events.filter((event) =>
          event.type !== "compact" && event.type !== "assistantDraft" &&
          event.data?.uiProjection !== true && event.data?.modelProjectionExcluded !== true,
        ),
        conversationId,
        { compactedThroughSequence: conversation?.compactedThroughSequence },
      )
    : projectUnscopedConversationEvents(
        context.events.filter((event) => event.data?.modelProjectionExcluded !== true),
      );
  // The persisted event stream remains complete. For the model projection, old
  // completed tool payloads from the active turn may be thinned as well; otherwise
  // one long Agent loop grows without bound because the latest user turn is active.
  const projection = thinProjectAgentToolResults(
    projectionSourceEvents, {
    clearedEventIds: previouslyClearedEventIds,
    protectLatestUserTurn: false,
  });
  const modelEvents = projectProjectAgentToolResultsForModel(projection.events);
  return {
    ...context,
    conversationSummary: conversation?.summary ?? "",
    conversationCompactedThroughSequence: conversation?.compactedThroughSequence ?? 0,
    interactionMode: session.context.interactionMode ?? "default",
    activePlan: session.context.activePlan ?? "",
    taskPlan: session.taskPlan,
    events: modelEvents,
    clearedToolResultEventIds: projection.clearedEventIds,
    newlyClearedToolResultEventIds: projection.newlyClearedEventIds,
    microcompactTokensSaved: projection.estimatedTokensSaved,
    newMicrocompactTokensSaved: projection.newlyEstimatedTokensSaved,
    estimatedConversationTokens: estimateProjectAgentTextTokens(context.summary) +
      estimateProjectAgentTextTokens(conversation?.summary ?? "") +
      estimateProjectAgentTextTokens(JSON.stringify(session.taskPlan)) + modelEvents.reduce(
      (total, event) => total + estimateProjectAgentEventTokens(event),
      0,
    ),
    estimatedTokens: estimateProjectAgentTextTokens(context.summary) +
      estimateProjectAgentTextTokens(JSON.stringify(session.taskPlan)) + modelEvents.reduce(
      (total, event) => total + estimateProjectAgentEventTokens(event),
      0,
    ),
  };
}

export async function recordProjectAgentCompactionFailure(input: {
  projectId: string;
  code: string;
  conversationId?: string;
}, dataDir = getZenmeDataDir()) {
  validateProjectId(input.projectId);
  const code = input.code.trim().slice(0, 100);
  if (!code) throw new ProjectAgentSessionError("压缩失败代码无效", "invalid_input");
  let result!: { consecutiveFailures: number; canRetry: boolean };
  await mutateSession(input.projectId, dataDir, (session) => {
    const conversation = input.conversationId
      ? session.conversations?.find((candidate) => candidate.id === input.conversationId)
      : undefined;
    if (input.conversationId && !conversation) {
      throw new ProjectAgentSessionError("Conversation 不存在", "invalid_input");
    }
    const previousFailures = conversation
      ? conversation.consecutiveCompactionFailures ?? 0
      : session.context.consecutiveCompactionFailures;
    const failures = Math.min(
      MAX_CONSECUTIVE_COMPACTION_FAILURES,
      previousFailures + 1,
    );
    const now = new Date().toISOString();
    if (conversation) {
      conversation.consecutiveCompactionFailures = failures;
      conversation.lastCompactionFailureCode = code;
      if (failures >= MAX_CONSECUTIVE_COMPACTION_FAILURES) conversation.compactionBlockedAt = now;
      conversation.updatedAt = now;
    } else {
      session.context.consecutiveCompactionFailures = failures;
      session.context.lastCompactionFailureCode = code;
      if (failures >= MAX_CONSECUTIVE_COMPACTION_FAILURES) session.context.compactionBlockedAt = now;
    }
    session.updatedAt = now;
    result = { consecutiveFailures: failures, canRetry: failures < MAX_CONSECUTIVE_COMPACTION_FAILURES };
    return session;
  });
  return result;
}

export function canAttemptProjectAgentCompaction(session: ProjectAgentSession, conversationId?: string) {
  if (conversationId) {
    const conversation = session.conversations?.find((candidate) => candidate.id === conversationId);
    return Boolean(conversation) &&
      (conversation.consecutiveCompactionFailures ?? 0) < MAX_CONSECUTIVE_COMPACTION_FAILURES;
  }
  return session.context.consecutiveCompactionFailures < MAX_CONSECUTIVE_COMPACTION_FAILURES;
}

export function calculateProjectAgentContextBudget(
  contextWindowTokens: number,
  modelMaxOutputTokens = 20_000,
): ProjectAgentContextBudget {
  if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens < 8_192) {
    throw new ProjectAgentSessionError("模型上下文窗口无效", "invalid_input");
  }
  if (!Number.isSafeInteger(modelMaxOutputTokens) || modelMaxOutputTokens < 1) {
    throw new ProjectAgentSessionError("模型最大输出无效", "invalid_input");
  }
  const reservedOutputTokens = Math.min(
    modelMaxOutputTokens,
    20_000,
    Math.floor(contextWindowTokens * 0.25),
  );
  const effectiveContextWindowTokens = contextWindowTokens - reservedOutputTokens;
  const compactBufferTokens = Math.min(13_000, Math.floor(effectiveContextWindowTokens / 3));
  return {
    contextWindowTokens,
    reservedOutputTokens,
    effectiveContextWindowTokens,
    compactBufferTokens,
    compactAtTokens: effectiveContextWindowTokens - compactBufferTokens,
  };
}

export function shouldCompactProjectAgentContext(input: {
  contextWindowTokens: number;
  effectiveTokens: number;
}) {
  validateRequiredTokenCount(input.effectiveTokens, "effectiveTokens");
  return input.effectiveTokens >= calculateProjectAgentContextBudget(input.contextWindowTokens).compactAtTokens;
}

function mutateSession<T>(
  projectId: string,
  dataDir: string,
  mutate: (session: ProjectAgentSession) => T | Promise<T>,
) {
  const filePath = sessionPath(projectId, dataDir);
  const previous = mutationLocks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    if (!await getLocalProject(projectId, dataDir)) {
      throw new ProjectAgentSessionError("项目不存在", "project_not_found");
    }
    const session = await readJsonFile<ProjectAgentSession>(filePath, {
      defaultValue: createEmptySession(projectId),
      normalize: normalizeSession,
    });
    const result = await mutate(session);
    await writeJsonFile(filePath, session);
    return result;
  });
  mutationLocks.set(filePath, next);
  return next.finally(() => {
    if (mutationLocks.get(filePath) === next) mutationLocks.delete(filePath);
  }) as Promise<T>;
}

function createEmptySession(projectId: string): ProjectAgentSession {
  const now = new Date().toISOString();
  return {
    version: PROJECT_AGENT_SESSION_VERSION,
    id: crypto.randomUUID(),
    projectId,
    conversations: [],
    events: [],
    compactCheckpoints: [],
    taskPlan: [],
    context: emptyContext(),
    createdAt: now,
    updatedAt: now,
  };
}

function emptyContext(): ProjectAgentContextState {
  return {
    modelId: null,
    interactionMode: "default",
    contextWindowTokens: null,
    inputTokens: 0,
    outputTokens: 0,
    estimatedEffectiveTokens: 0,
    compactedThroughSequence: 0,
    activeSummary: "",
    consecutiveCompactionFailures: 0,
  };
}

function normalizeSession(value: unknown): ProjectAgentSession | null {
  if (!isObject(value) || value.version !== PROJECT_AGENT_SESSION_VERSION) return null;
  if (
    typeof value.id !== "string" || typeof value.projectId !== "string" ||
    !Array.isArray(value.events) || !Array.isArray(value.compactCheckpoints) ||
    !isObject(value.context) || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string"
  ) return null;
  const events = value.events.filter(isEvent).slice(0, MAX_EVENTS);
  const compactCheckpoints = value.compactCheckpoints.filter(isCheckpoint).slice(0, MAX_CHECKPOINTS);
  const conversations = Array.isArray(value.conversations)
    ? value.conversations.filter(isConversation)
    : [];
  return {
    ...value,
    version: PROJECT_AGENT_SESSION_VERSION,
    id: value.id,
    projectId: value.projectId,
    conversations,
    events,
    compactCheckpoints,
    taskPlan: normalizeTaskPlan(value.taskPlan),
    context: normalizeContext(value.context, events),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  } as ProjectAgentSession;
}

function isConversation(value: unknown): value is ProjectAgentConversation {
  return isObject(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string";
}

function normalizeContext(value: Record<string, unknown>, events: ProjectAgentEvent[]): ProjectAgentContextState {
  const maximumSequence = events.at(-1)?.sequence ?? 0;
  return {
    ...value,
    modelId: typeof value.modelId === "string" ? value.modelId : null,
    interactionMode: value.interactionMode === "plan" ? "plan" : "default",
    activePlan: typeof value.activePlan === "string" ? value.activePlan.slice(0, MAX_SUMMARY_LENGTH) : undefined,
    activeWorktree: normalizeActiveWorktree(value.activeWorktree),
    permissionMode: normalizePermissionMode(value.permissionMode),
    contextWindowTokens: safeCountOrNull(value.contextWindowTokens),
    inputTokens: safeCount(value.inputTokens),
    outputTokens: safeCount(value.outputTokens),
    estimatedEffectiveTokens: safeCount(value.estimatedEffectiveTokens),
    compactedThroughSequence: Math.min(safeCount(value.compactedThroughSequence), maximumSequence),
    activeSummary: typeof value.activeSummary === "string" ? value.activeSummary.slice(0, MAX_SUMMARY_LENGTH) : "",
    consecutiveCompactionFailures: Math.min(
      MAX_CONSECUTIVE_COMPACTION_FAILURES,
      safeCount(value.consecutiveCompactionFailures),
    ),
    compactionBlockedAt: typeof value.compactionBlockedAt === "string" ? value.compactionBlockedAt : undefined,
    lastCompactionFailureCode: typeof value.lastCompactionFailureCode === "string"
      ? value.lastCompactionFailureCode.slice(0, 100)
      : undefined,
    lastCompactedAt: typeof value.lastCompactedAt === "string" ? value.lastCompactedAt : undefined,
    skillHooks: normalizeProjectAgentHooks(value.skillHooks, { preserveRuntimeMetadata: true }),
    consumedHookIds: Array.isArray(value.consumedHookIds)
      ? [...new Set(value.consumedHookIds.filter((item): item is string => typeof item === "string" && /^[a-f0-9]{64}$/.test(item)))].slice(-2_000)
      : [],
  };
}

function normalizePermissionMode(value: unknown) {
  return value === "untrusted" || value === "onRequest" || value === "neverAsk" ? value : undefined;
}

function normalizeActiveWorktree(value: unknown): ProjectAgentContextState["activeWorktree"] {
  if (!isObject(value) || typeof value.originalRootId !== "string" || typeof value.path !== "string" ||
    typeof value.branch !== "string" || typeof value.headCommit !== "string" || typeof value.gitRoot !== "string" ||
    !["active", "kept", "cleaned"].includes(String(value.state))) return undefined;
  return {
    originalRootId: value.originalRootId,
    rootId: typeof value.rootId === "string" ? value.rootId : undefined,
    path: value.path,
    branch: value.branch,
    headCommit: value.headCommit,
    gitRoot: value.gitRoot,
    state: value.state as "active" | "kept" | "cleaned",
  };
}

function isEvent(value: unknown): value is ProjectAgentEvent {
  return isObject(value) && typeof value.id === "string" && Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) > 0 && typeof value.turnId === "string" && isEventType(value.type) &&
    typeof value.createdAt === "string" && (value.content === undefined || typeof value.content === "string") &&
    (value.data === undefined || isObject(value.data));
}

function isCheckpoint(value: unknown): value is ProjectAgentCompactCheckpoint {
  return isObject(value) && typeof value.id === "string" && typeof value.summary === "string" &&
    Number.isSafeInteger(value.compactedThroughSequence) && Number(value.compactedThroughSequence) > 0 &&
    Number.isSafeInteger(value.sourceTokenEstimate) && Number(value.sourceTokenEstimate) >= 0 &&
    typeof value.createdAt === "string";
}

function isEventType(value: unknown): value is ProjectAgentEventType {
  return typeof value === "string" && [
    "user", "assistant", "assistantDraft", "thinking", "toolCall", "toolResult", "approval", "status", "compact", "memory", "todo",
  ].includes(value);
}

function requiredTaskText(value: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new ProjectAgentSessionError("Agent 任务内容无效", "invalid_input");
  }
  return value.trim();
}

function optionalTaskText(value: string | undefined, maximum: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) {
    throw new ProjectAgentSessionError("Agent 任务内容无效", "invalid_input");
  }
  return value.trim() || undefined;
}

function normalizeTaskIds(values: string[] | undefined) {
  if (values === undefined) return [];
  if (!Array.isArray(values) || values.length > 100 || values.some((value) => typeof value !== "string" || !value.trim() || value.length > 500)) {
    throw new ProjectAgentSessionError("Agent 任务依赖无效", "invalid_input");
  }
  return Array.from(new Set(values.map((value) => value.trim())));
}

function assertTaskIdsExist(tasks: ProjectAgentTaskItem[], ids: string[]) {
  const known = new Set(tasks.map((task) => task.id));
  if (ids.some((id) => !known.has(id))) throw new ProjectAgentSessionError("Agent 任务依赖不存在", "invalid_input");
}

function assertAcyclicTaskDependencies(tasks: ProjectAgentTaskItem[]) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new ProjectAgentSessionError("Agent 任务依赖形成循环", "invalid_input");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.blockedBy ?? []) {
      if (!byId.has(dependency)) throw new ProjectAgentSessionError("Agent 任务依赖不存在", "invalid_input");
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const task of tasks) visit(task.id);
}

function normalizeTaskPlan(value: unknown): ProjectAgentTaskItem[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((item) => {
    if (!isObject(item) || typeof item.id !== "string" || !item.id.trim() ||
      typeof item.content !== "string" || !item.content.trim() ||
      !["pending", "in_progress", "completed"].includes(String(item.status))) return [];
    return [{
      id: item.id.slice(0, 500),
      content: item.content.slice(0, 10_000),
      status: item.status as ProjectAgentTaskItem["status"],
      ...(typeof item.description === "string" && item.description.trim() ? { description: item.description.slice(0, 100_000) } : {}),
      ...(typeof item.activeForm === "string" && item.activeForm.trim() ? { activeForm: item.activeForm.slice(0, 10_000) } : {}),
      ...(typeof item.owner === "string" && item.owner.trim() ? { owner: item.owner.slice(0, 500) } : {}),
      ...(Array.isArray(item.blockedBy) ? { blockedBy: Array.from(new Set(item.blockedBy.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).map((id) => id.slice(0, 500)))).slice(0, 100) } : {}),
      ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
      ...(typeof item.updatedAt === "string" ? { updatedAt: item.updatedAt } : {}),
    }];
  });
}

function isPendingCompactionStatus(value: unknown) {
  return value === "pending" || value === "proposed" || value === "waitingApproval";
}

function isRunningCompactionStatus(value: unknown) {
  return value === "queued" || value === "running";
}

function validateProjectId(projectId: string) {
  try {
    assertSafePathSegment(projectId, "projectId");
  } catch {
    throw new ProjectAgentSessionError("项目参数无效", "invalid_input");
  }
}

function validateEventInput(input: { type: ProjectAgentEventType; content?: string; data?: Record<string, unknown> }) {
  if (!isEventType(input.type) || (input.content !== undefined && input.content.length > MAX_EVENT_CONTENT_LENGTH) ||
    (input.data !== undefined && (!isObject(input.data) || serializedLength(input.data) > MAX_EVENT_DATA_LENGTH))) {
    throw new ProjectAgentSessionError("Agent 事件无效", "invalid_input");
  }
  if (["user", "assistant", "assistantDraft", "thinking"].includes(input.type) && !input.content?.trim()) {
    throw new ProjectAgentSessionError("消息事件不能为空", "invalid_input");
  }
}

function serializedLength(value: Record<string, unknown>) {
  try {
    return JSON.stringify(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validateTokenCount(value: number | null | undefined, label: string, nullable = false) {
  if (value === undefined || (nullable && value === null)) return;
  if (value === null) {
    throw new ProjectAgentSessionError(`${label} 无效`, "invalid_input");
  }
  validateRequiredTokenCount(value, label);
}

function validateRequiredTokenCount(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ProjectAgentSessionError(`${label} 无效`, "invalid_input");
  }
}

function normalizeModelId(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim().slice(0, 500);
  return normalized || null;
}

function safeCount(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeCountOrNull(value: unknown) {
  return value === null ? null : safeCount(value) || null;
}

function sessionPath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "agent", "session.json");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
