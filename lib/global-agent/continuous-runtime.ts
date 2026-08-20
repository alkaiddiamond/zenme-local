import { callProjectAgentModel } from "@/lib/agent/project-agent-model";
import { getProjectAgentSession } from "@/lib/agent/project-session-store";
import {
  claimContinuousAgentRun,
  completeContinuousAgentRun,
  failContinuousAgentRun,
  getContinuousGlobalAgentState,
} from "@/lib/global-agent/continuous-store";
import type { ContinuousAgentSuggestionInput, ContinuousProjectEvent } from "@/lib/global-agent/continuous-types";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalSettings } from "@/lib/local/settings";

export class ContinuousGlobalAgentRuntimeError extends Error {
  constructor(message: string, readonly code: "model_unavailable" | "invalid_output") {
    super(message);
    this.name = "ContinuousGlobalAgentRuntimeError";
  }
}

const continuousRuntimeInstanceKey = Symbol.for("zenme.continuous-global-agent-runtime-instance");

export function getContinuousGlobalAgentRuntimeInstanceId() {
  const existing = Reflect.get(globalThis, continuousRuntimeInstanceKey) as string | undefined;
  if (existing) return existing;
  const created = crypto.randomUUID();
  Reflect.set(globalThis, continuousRuntimeInstanceKey, created);
  return created;
}

export async function runContinuousGlobalAgentOnce(input: {
  projectId: string;
  signal?: AbortSignal;
}, options: {
  callModel?: typeof callProjectAgentModel;
  dataDir?: string;
} = {}) {
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const [state, session, settings] = await Promise.all([
    getContinuousGlobalAgentState(input.projectId, dataDir),
    getProjectAgentSession(input.projectId, dataDir),
    getLocalSettings(dataDir),
  ]);
  const model = state.modelId || session.context.modelId || settings.lastTextModelId || defaultModel(settings);
  if (!model) throw new ContinuousGlobalAgentRuntimeError("Continuous Agent 尚未配置可用模型", "model_unavailable");
  const claimed = await claimContinuousAgentRun(
    input.projectId,
    dataDir,
    new Date(),
    getContinuousGlobalAgentRuntimeInstanceId(),
  );
  if (!claimed) return { ran: false as const, state: await getContinuousGlobalAgentState(input.projectId, dataDir) };

  try {
    const response = await (options.callModel ?? callProjectAgentModel)({
      model,
      mode: "agent_planning",
      context: [
        "你是 Zenme Local 项目的持续观察 Agent。只分析事件并提出候选建议，不得执行命令、修改文件、写入记忆或替用户作出决定。",
        "建议必须由本轮事件支撑；没有可靠建议时返回空 suggestions。不要复述低价值运行噪声。",
        `上次检查点摘要：${state.checkpoint.contextSummary || "无"}`,
        `待处理事项：${JSON.stringify(state.checkpoint.waitingItems)}`,
        `本轮事件：${JSON.stringify(claimed.events.map(compactEvent))}`,
      ].join("\n\n"),
      prompt: [
        "整理本轮事件并只返回 JSON，不要 Markdown：",
        '{"summary":"更新后的项目状态摘要","waitingItems":["仍待处理事项"],"suggestions":[{"kind":"nextTask|memoryCandidate|knowledgeReview|canvasConvergence","title":"标题","summary":"建议内容","rationale":["依据"],"sourceEventIds":["事件 id"],"idempotencyKey":"稳定去重键"}]}',
      ].join("\n"),
      signal: input.signal,
      thinkingEnabled: settings.thinkingEnabled,
      reasoningEffort: settings.defaultReasoningEffort,
      modelSpeed: settings.defaultModelSpeed,
    });
    const parsed = parseContinuousAgentOutput(response.text, claimed.events);
    const next = await completeContinuousAgentRun({
      projectId: input.projectId,
      runId: claimed.run.id,
      contextSummary: parsed.summary,
      waitingItems: parsed.waitingItems,
      suggestions: parsed.suggestions,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    }, dataDir);
    return { ran: true as const, runId: claimed.run.id, state: next };
  } catch (error) {
    await failContinuousAgentRun({
      projectId: input.projectId,
      runId: claimed.run.id,
      error: error instanceof Error ? error.message : "Continuous Agent 评估失败",
    }, dataDir).catch(() => undefined);
    throw error;
  }
}

export function parseContinuousAgentOutput(text: string, events: ContinuousProjectEvent[]) {
  const candidate = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try { value = JSON.parse(candidate); }
  catch { throw new ContinuousGlobalAgentRuntimeError("Continuous Agent 返回了无效 JSON", "invalid_output"); }
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.waitingItems) || !Array.isArray(value.suggestions)) {
    throw new ContinuousGlobalAgentRuntimeError("Continuous Agent 返回结构无效", "invalid_output");
  }
  const eventIds = new Set(events.map((event) => event.id));
  const suggestions = value.suggestions.slice(0, 50).map((item) => normalizeSuggestion(item, eventIds));
  return {
    summary: value.summary.trim().slice(0, 200_000),
    waitingItems: stringArray(value.waitingItems, 100, 2_000),
    suggestions,
  };
}

function normalizeSuggestion(value: unknown, eventIds: Set<string>): ContinuousAgentSuggestionInput {
  if (!isRecord(value) || !["nextTask", "memoryCandidate", "knowledgeReview", "canvasConvergence"].includes(String(value.kind)) ||
    typeof value.title !== "string" || typeof value.summary !== "string" || typeof value.idempotencyKey !== "string") {
    throw new ContinuousGlobalAgentRuntimeError("Continuous Agent 建议结构无效", "invalid_output");
  }
  const sourceEventIds = stringArray(value.sourceEventIds, 100, 200).filter((id) => eventIds.has(id));
  if (!value.title.trim() || !value.summary.trim() || !value.idempotencyKey.trim() || !sourceEventIds.length) {
    throw new ContinuousGlobalAgentRuntimeError("Continuous Agent 建议缺少事件依据", "invalid_output");
  }
  return {
    kind: value.kind as ContinuousAgentSuggestionInput["kind"],
    title: value.title.trim().slice(0, 500),
    summary: value.summary.trim().slice(0, 20_000),
    rationale: stringArray(value.rationale, 20, 2_000),
    sourceEventIds,
    idempotencyKey: value.idempotencyKey.trim().slice(0, 2_000),
  };
}

function compactEvent(event: ContinuousProjectEvent) {
  return { id: event.id, sequence: event.sequence, type: event.type, source: event.source, sourceId: event.sourceId, createdAt: event.createdAt, data: event.data };
}

function defaultModel(settings: Awaited<ReturnType<typeof getLocalSettings>>) {
  const provider = settings.modelProviders.find((item) => item.enabled && item.isDefault) ?? settings.modelProviders.find((item) => item.enabled);
  return provider?.modelMapping.main ? `${provider.id}:${provider.modelMapping.main}` : null;
}

function stringArray(value: unknown, count: number, maxLength: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, maxLength)).filter(Boolean).slice(0, count) : [];
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
import crypto from "node:crypto";
