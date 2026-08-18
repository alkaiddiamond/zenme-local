import crypto from "node:crypto";

import { readJsonFile, writeJsonFile } from "@/lib/local/atomic-json";
import { getProjectDir, getZenmeDataDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalProject } from "@/lib/local/project-repository";
import {
  CONTINUOUS_GLOBAL_AGENT_VERSION,
  type ContinuousAgentRun,
  type ContinuousAgentSuggestion,
  type ContinuousAgentSuggestionInput,
  type ContinuousGlobalAgentMode,
  type ContinuousGlobalAgentState,
  type ContinuousProjectEvent,
  type ContinuousProjectEventType,
} from "@/lib/global-agent/continuous-types";

const locks = new Map<string, Promise<unknown>>();
const MAX_EVENTS = 10_000;
const MAX_RUNS = 2_000;
const MAX_SUGGESTIONS = 2_000;
const MAX_EVENT_DATA_CHARACTERS = 100_000;
const MAX_SUMMARY_CHARACTERS = 200_000;
const HOUR_MS = 60 * 60 * 1_000;
const EVENT_TYPES: ContinuousProjectEventType[] = [
  "workspace.changed", "changeSet.changed", "execution.changed", "task.changed",
  "memory.changed", "knowledge.changed", "canvas.lifecycleChanged", "manual.requested",
];
const EVENT_SOURCES: ContinuousProjectEvent["source"][] = [
  "workspace", "changeSet", "execution", "task", "memory", "knowledge", "canvas", "user",
];

export class ContinuousGlobalAgentError extends Error {
  constructor(message: string, readonly code: "project_not_found" | "invalid_input" | "invalid_status" | "budget_exhausted") {
    super(message);
    this.name = "ContinuousGlobalAgentError";
  }
}

export async function getContinuousGlobalAgentState(projectId: string, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(projectId, "projectId");
  if (!await getLocalProject(projectId, dataDir)) {
    throw new ContinuousGlobalAgentError("项目不存在", "project_not_found");
  }
  return mutate(projectId, dataDir, (state) => state);
}

export async function listConfiguredContinuousGlobalAgentStates(
  projectIds: readonly string[],
  dataDir = getZenmeDataDir(),
) {
  const uniqueProjectIds = [...new Set(projectIds.map((projectId) => projectId.trim()).filter(Boolean))].slice(0, 1_000);
  const states = await Promise.all(uniqueProjectIds.map(async (projectId) => {
    try {
      assertSafePathSegment(projectId, "projectId");
      const state = await readJsonFile<ContinuousGlobalAgentState | null>(storePath(projectId, dataDir), {
        defaultValue: null,
        normalize: normalizeState,
      });
      return state?.mode === "enabled" ? state : null;
    } catch {
      return null;
    }
  }));
  return states.filter((state): state is ContinuousGlobalAgentState => Boolean(state));
}

export async function getAcceptedContinuousAgentSuggestions(projectId: string, dataDir = getZenmeDataDir()) {
  const state = await getContinuousGlobalAgentState(projectId, dataDir);
  return state.suggestions
    .filter((suggestion) => suggestion.status === "accepted")
    .slice(-20)
    .map((suggestion) => ({
      ...suggestion,
      rationale: [...suggestion.rationale],
      sourceEventIds: [...suggestion.sourceEventIds],
    }));
}

export async function configureContinuousGlobalAgent(input: {
  projectId: string;
  mode?: ContinuousGlobalAgentMode;
  modelId?: string | null;
  budget?: Partial<ContinuousGlobalAgentState["budget"]>;
}, dataDir = getZenmeDataDir()) {
  assertSafePathSegment(input.projectId, "projectId");
  if (input.mode !== undefined && !["disabled", "paused", "enabled"].includes(input.mode)) invalid();
  if (input.modelId !== undefined && input.modelId !== null && (typeof input.modelId !== "string" || input.modelId.length > 500)) invalid();
  return mutate(input.projectId, dataDir, (state) => {
    if (input.mode) {
      state.mode = input.mode;
      state.status = input.mode === "disabled" ? "disabled" : input.mode === "paused" ? "paused" : runtimeStatus(state);
      if (input.mode !== "enabled" && state.checkpoint.activeRun?.status === "running") {
        state.checkpoint.activeRun.cancelRequestedAt = new Date().toISOString();
      }
    }
    if (input.modelId !== undefined) state.modelId = input.modelId?.trim() || null;
    if (input.budget) state.budget = normalizeBudget({ ...state.budget, ...input.budget });
    state.updatedAt = new Date().toISOString();
    return state;
  });
}

export async function appendContinuousProjectEvent(input: {
  projectId: string;
  type: ContinuousProjectEventType;
  source: ContinuousProjectEvent["source"];
  sourceId: string;
  idempotencyKey: string;
  data?: Record<string, unknown>;
}, dataDir = getZenmeDataDir()) {
  validateEvent(input);
  let appended!: ContinuousProjectEvent;
  return mutate(input.projectId, dataDir, (state) => {
    const existing = state.events.find((event) => event.idempotencyKey === input.idempotencyKey);
    if (existing) {
      appended = existing;
      return state;
    }
    const now = new Date().toISOString();
    appended = {
      id: crypto.randomUUID(),
      sequence: (state.events.at(-1)?.sequence ?? 0) + 1,
      type: input.type,
      source: input.source,
      sourceId: input.sourceId.trim(),
      idempotencyKey: input.idempotencyKey.trim(),
      createdAt: now,
      ...(input.data ? { data: input.data } : {}),
    };
    state.events.push(appended);
    if (state.events.length > MAX_EVENTS) {
      const processed = state.events.filter((event) => event.sequence <= state.checkpoint.lastProcessedSequence);
      const removable = Math.min(state.events.length - MAX_EVENTS, processed.length);
      state.events.splice(0, removable);
      if (state.events.length > MAX_EVENTS) throw new ContinuousGlobalAgentError("Continuous Agent 事件容量已满", "invalid_status");
    }
    state.updatedAt = now;
    return state;
  }).then(() => appended);
}

export async function claimContinuousAgentRun(
  projectId: string,
  dataDir = getZenmeDataDir(),
  now = new Date(),
  runtimeInstanceId?: string,
): Promise<{ run: ContinuousAgentRun; events: ContinuousProjectEvent[] } | null> {
  let claimed: { run: ContinuousAgentRun; events: ContinuousProjectEvent[] } | null = null;
  await mutate(projectId, dataDir, (state) => {
    rollBudgetWindow(state, now);
    if (state.mode !== "enabled") return state;
    interruptForeignActiveRun(state, runtimeInstanceId, now);
    if (state.checkpoint.activeRun?.status === "running") return state;
    if (state.checkpoint.cooldownUntil && Date.parse(state.checkpoint.cooldownUntil) > now.getTime()) {
      state.status = "backoff";
      return state;
    }
    if (state.checkpoint.runsInWindow >= state.budget.maxRunsPerHour || state.checkpoint.tokensInWindow >= state.budget.maxTokensPerHour) {
      state.status = "backoff";
      return state;
    }
    const events = state.events
      .filter((event) => event.sequence > state.checkpoint.lastProcessedSequence)
      .slice(0, state.budget.maxEventsPerRun);
    if (!events.length) {
      state.status = "idle";
      return state;
    }
    const run: ContinuousAgentRun = {
      id: crypto.randomUUID(),
      status: "running",
      ...(runtimeInstanceId ? { runtimeInstanceId } : {}),
      eventSequences: events.map((event) => event.sequence),
      startedAt: now.toISOString(),
    };
    state.checkpoint.activeRun = run;
    state.checkpoint.lastRunAt = run.startedAt;
    state.checkpoint.runsInWindow += 1;
    state.status = "running";
    state.updatedAt = run.startedAt;
    claimed = { run, events };
    return state;
  });
  return claimed;
}

export async function reconcileContinuousAgentRuntime(
  projectId: string,
  runtimeInstanceId: string,
  dataDir = getZenmeDataDir(),
  now = new Date(),
) {
  if (!runtimeInstanceId.trim()) invalid();
  return mutate(projectId, dataDir, (state) => {
    interruptForeignActiveRun(state, runtimeInstanceId, now);
    return state;
  });
}

export async function completeContinuousAgentRun(input: {
  projectId: string;
  runId: string;
  contextSummary?: string;
  waitingItems?: string[];
  suggestions?: ContinuousAgentSuggestionInput[];
  inputTokens?: number;
  outputTokens?: number;
}, dataDir = getZenmeDataDir()) {
  return mutate(input.projectId, dataDir, (state) => {
    const active = requireActiveRun(state, input.runId);
    const now = new Date().toISOString();
    const cancelled = Boolean(active.cancelRequestedAt) || state.mode !== "enabled";
    active.status = cancelled ? "cancelled" : "completed";
    active.completedAt = now;
    active.inputTokens = normalizeCount(input.inputTokens);
    active.outputTokens = normalizeCount(input.outputTokens);
    state.runs.push({ ...active });
    state.runs = state.runs.slice(-MAX_RUNS);
    if (!cancelled) {
      state.checkpoint.lastProcessedSequence = Math.max(state.checkpoint.lastProcessedSequence, ...active.eventSequences);
      state.checkpoint.contextSummary = normalizeText(input.contextSummary, MAX_SUMMARY_CHARACTERS);
      state.checkpoint.waitingItems = normalizeStrings(input.waitingItems, 100, 2_000);
      state.checkpoint.tokensInWindow += (active.inputTokens ?? 0) + (active.outputTokens ?? 0);
      state.checkpoint.consecutiveFailures = 0;
      delete state.checkpoint.cooldownUntil;
      addSuggestions(state, active.id, input.suggestions ?? [], now);
    }
    delete state.checkpoint.activeRun;
    state.status = state.mode === "enabled" ? "idle" : state.mode === "paused" ? "paused" : "disabled";
    state.updatedAt = now;
    return state;
  });
}

export async function failContinuousAgentRun(input: {
  projectId: string;
  runId: string;
  error: string;
}, dataDir = getZenmeDataDir(), now = new Date()) {
  return mutate(input.projectId, dataDir, (state) => {
    const active = requireActiveRun(state, input.runId);
    active.status = active.cancelRequestedAt || state.mode !== "enabled" ? "cancelled" : "failed";
    active.error = normalizeText(input.error, 10_000);
    active.completedAt = now.toISOString();
    state.runs.push({ ...active });
    state.runs = state.runs.slice(-MAX_RUNS);
    delete state.checkpoint.activeRun;
    if (active.status === "failed") {
      state.checkpoint.consecutiveFailures += 1;
      const delayMs = Math.min(state.budget.cooldownMs * (2 ** (state.checkpoint.consecutiveFailures - 1)), HOUR_MS);
      state.checkpoint.cooldownUntil = new Date(now.getTime() + delayMs).toISOString();
      state.status = "backoff";
    } else {
      state.status = state.mode === "paused" ? "paused" : "disabled";
    }
    state.updatedAt = active.completedAt;
    return state;
  });
}

export async function updateContinuousAgentSuggestion(input: {
  projectId: string;
  suggestionId: string;
  status: ContinuousAgentSuggestion["status"];
}, dataDir = getZenmeDataDir()) {
  return mutate(input.projectId, dataDir, (state) => {
    const suggestion = state.suggestions.find((item) => item.id === input.suggestionId);
    if (!suggestion || !["candidate", "accepted", "rejected", "dismissed"].includes(input.status)) invalid();
    suggestion.status = input.status;
    suggestion.updatedAt = new Date().toISOString();
    state.updatedAt = suggestion.updatedAt;
    return suggestion;
  });
}

function addSuggestions(state: ContinuousGlobalAgentState, runId: string, values: ContinuousAgentSuggestionInput[], now: string) {
  for (const value of values.slice(0, 50)) {
    if (!validSuggestion(value) || state.suggestions.some((item) => item.idempotencyKey === value.idempotencyKey)) continue;
    state.suggestions.push({
      id: crypto.randomUUID(),
      runId,
      kind: value.kind,
      title: normalizeText(value.title, 500),
      summary: normalizeText(value.summary, 20_000),
      rationale: normalizeStrings(value.rationale, 20, 2_000),
      sourceEventIds: normalizeStrings(value.sourceEventIds, 100, 200),
      idempotencyKey: value.idempotencyKey,
      status: "candidate",
      createdAt: now,
      updatedAt: now,
    });
  }
  state.suggestions = state.suggestions.slice(-MAX_SUGGESTIONS);
}

async function mutate<T>(projectId: string, dataDir: string, fn: (state: ContinuousGlobalAgentState) => T | Promise<T>) {
  assertSafePathSegment(projectId, "projectId");
  const filePath = storePath(projectId, dataDir);
  const previous = locks.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    if (!await getLocalProject(projectId, dataDir)) throw new ContinuousGlobalAgentError("项目不存在", "project_not_found");
    const state = await readJsonFile(filePath, { defaultValue: defaultState(projectId), normalize: normalizeState });
    const result = await fn(state);
    await writeJsonFile(filePath, state);
    return result;
  });
  locks.set(filePath, next);
  try { return await next; }
  finally { if (locks.get(filePath) === next) locks.delete(filePath); }
}

function defaultState(projectId: string): ContinuousGlobalAgentState {
  const now = new Date().toISOString();
  return {
    version: CONTINUOUS_GLOBAL_AGENT_VERSION,
    projectId,
    mode: "disabled",
    status: "disabled",
    modelId: null,
    budget: { maxRunsPerHour: 6, maxEventsPerRun: 50, maxTokensPerHour: 120_000, cooldownMs: 60_000 },
    checkpoint: {
      lastProcessedSequence: 0,
      contextSummary: "",
      waitingItems: [],
      consecutiveFailures: 0,
      windowStartedAt: now,
      runsInWindow: 0,
      tokensInWindow: 0,
    },
    events: [], runs: [], suggestions: [], createdAt: now, updatedAt: now,
  };
}

function normalizeState(value: unknown): ContinuousGlobalAgentState | null {
  if (!isRecord(value) || value.version !== CONTINUOUS_GLOBAL_AGENT_VERSION || typeof value.projectId !== "string") return null;
  const fallback = defaultState(value.projectId);
  const mode = ["disabled", "paused", "enabled"].includes(String(value.mode)) ? value.mode as ContinuousGlobalAgentMode : "disabled";
  const checkpoint = isRecord(value.checkpoint) ? value.checkpoint : {};
  return {
    ...value,
    version: CONTINUOUS_GLOBAL_AGENT_VERSION,
    projectId: value.projectId,
    mode,
    status: mode === "disabled" ? "disabled" : mode === "paused" ? "paused" : ["idle", "running", "backoff"].includes(String(value.status)) ? value.status as ContinuousGlobalAgentState["status"] : "idle",
    modelId: typeof value.modelId === "string" ? value.modelId.slice(0, 500) : null,
    budget: normalizeBudget(isRecord(value.budget) ? value.budget : fallback.budget),
    checkpoint: {
      lastProcessedSequence: normalizeCount(checkpoint.lastProcessedSequence),
      contextSummary: normalizeText(checkpoint.contextSummary, MAX_SUMMARY_CHARACTERS),
      waitingItems: normalizeStrings(checkpoint.waitingItems, 100, 2_000),
      consecutiveFailures: normalizeCount(checkpoint.consecutiveFailures),
      windowStartedAt: validDate(checkpoint.windowStartedAt) ?? fallback.checkpoint.windowStartedAt,
      runsInWindow: normalizeCount(checkpoint.runsInWindow),
      tokensInWindow: normalizeCount(checkpoint.tokensInWindow),
      ...(validDate(checkpoint.lastRunAt) ? { lastRunAt: String(checkpoint.lastRunAt) } : {}),
      ...(validDate(checkpoint.cooldownUntil) ? { cooldownUntil: String(checkpoint.cooldownUntil) } : {}),
      ...(isRun(checkpoint.activeRun) ? { activeRun: checkpoint.activeRun } : {}),
    },
    events: Array.isArray(value.events) ? value.events.filter(isEvent).slice(-MAX_EVENTS) : [],
    runs: Array.isArray(value.runs) ? value.runs.filter(isRun).slice(-MAX_RUNS) : [],
    suggestions: Array.isArray(value.suggestions) ? value.suggestions.filter(isSuggestion).slice(-MAX_SUGGESTIONS) : [],
    createdAt: validDate(value.createdAt) ?? fallback.createdAt,
    updatedAt: validDate(value.updatedAt) ?? fallback.updatedAt,
  };
}

function rollBudgetWindow(state: ContinuousGlobalAgentState, now: Date) {
  if (now.getTime() - Date.parse(state.checkpoint.windowStartedAt) < HOUR_MS) return;
  state.checkpoint.windowStartedAt = now.toISOString();
  state.checkpoint.runsInWindow = 0;
  state.checkpoint.tokensInWindow = 0;
}

function interruptForeignActiveRun(
  state: ContinuousGlobalAgentState,
  runtimeInstanceId: string | undefined,
  now: Date,
) {
  const active = state.checkpoint.activeRun;
  if (!runtimeInstanceId || !active || active.status !== "running" || active.runtimeInstanceId === runtimeInstanceId) return;
  active.status = "failed";
  active.error = "本地服务已重启，上一轮 Continuous Agent 已安全中断并等待重试";
  active.completedAt = now.toISOString();
  state.runs.push({ ...active });
  state.runs = state.runs.slice(-MAX_RUNS);
  delete state.checkpoint.activeRun;
  state.status = state.mode === "enabled" ? "idle" : state.mode === "paused" ? "paused" : "disabled";
  state.updatedAt = active.completedAt;
}

function runtimeStatus(state: ContinuousGlobalAgentState): ContinuousGlobalAgentState["status"] {
  if (state.checkpoint.activeRun?.status === "running") return "running";
  if (state.checkpoint.cooldownUntil && Date.parse(state.checkpoint.cooldownUntil) > Date.now()) return "backoff";
  return "idle";
}

function requireActiveRun(state: ContinuousGlobalAgentState, runId: string) {
  const active = state.checkpoint.activeRun;
  if (!active || active.id !== runId || active.status !== "running") {
    throw new ContinuousGlobalAgentError("Continuous Agent Run 不处于运行状态", "invalid_status");
  }
  return active;
}

function normalizeBudget(value: Record<string, unknown>) {
  return {
    maxRunsPerHour: boundedInteger(value.maxRunsPerHour, 6, 1, 60),
    maxEventsPerRun: boundedInteger(value.maxEventsPerRun, 50, 1, 500),
    maxTokensPerHour: boundedInteger(value.maxTokensPerHour, 120_000, 1_000, 10_000_000),
    cooldownMs: boundedInteger(value.cooldownMs, 60_000, 1_000, HOUR_MS),
  };
}

function validateEvent(input: Parameters<typeof appendContinuousProjectEvent>[0]) {
  assertSafePathSegment(input.projectId, "projectId");
  if (!EVENT_TYPES.includes(input.type) || !EVENT_SOURCES.includes(input.source)) invalid();
  if (!input.sourceId?.trim() || input.sourceId.length > 1_000 || !input.idempotencyKey?.trim() || input.idempotencyKey.length > 2_000) invalid();
  if (input.data && jsonLength(input.data) > MAX_EVENT_DATA_CHARACTERS) invalid();
}

function validSuggestion(value: ContinuousAgentSuggestionInput) {
  return ["nextTask", "memoryCandidate", "knowledgeReview", "canvasConvergence"].includes(value.kind) &&
    Boolean(value.title.trim() && value.summary.trim() && value.idempotencyKey.trim());
}

function isEvent(value: unknown): value is ContinuousProjectEvent {
  return isRecord(value) && typeof value.id === "string" && Number.isSafeInteger(value.sequence) && Number(value.sequence) > 0 &&
    EVENT_TYPES.includes(value.type as ContinuousProjectEventType) && EVENT_SOURCES.includes(value.source as ContinuousProjectEvent["source"]) && typeof value.sourceId === "string" &&
    typeof value.idempotencyKey === "string" && Boolean(validDate(value.createdAt));
}

function isRun(value: unknown): value is ContinuousAgentRun {
  return isRecord(value) && typeof value.id === "string" && ["running", "completed", "failed", "cancelled"].includes(String(value.status)) &&
    Array.isArray(value.eventSequences) && value.eventSequences.every(Number.isSafeInteger) && Boolean(validDate(value.startedAt));
}

function isSuggestion(value: unknown): value is ContinuousAgentSuggestion {
  return isRecord(value) && typeof value.id === "string" && typeof value.runId === "string" && typeof value.title === "string" &&
    typeof value.summary === "string" && typeof value.idempotencyKey === "string" && ["candidate", "accepted", "rejected", "dismissed"].includes(String(value.status));
}

function storePath(projectId: string, dataDir: string) {
  return resolveInside(getProjectDir(projectId, dataDir), "global-agent", "continuous.json");
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return Number.isSafeInteger(value) ? Math.max(min, Math.min(max, value as number)) : fallback;
}
function normalizeCount(value: unknown) { return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0; }
function normalizeText(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function normalizeStrings(value: unknown, count: number, length: number) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, length)).filter(Boolean).slice(0, count) : []; }
function validDate(value: unknown) { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function jsonLength(value: unknown) { try { return JSON.stringify(value).length; } catch { return Number.POSITIVE_INFINITY; } }
function invalid(): never { throw new ContinuousGlobalAgentError("Continuous Agent 参数无效", "invalid_input"); }
