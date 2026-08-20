import vm from "node:vm";

import { parse } from "acorn";

import {
  AgentWorkflowJournal,
  agentWorkflowCacheKey,
  createAgentWorkflowJournalEntryId,
  type AgentWorkflowJournalSnapshot,
} from "@/lib/agent/workflow-journal";
import type {
  AgentWorkflowAgentOptions,
  AgentWorkflowMeta,
  AgentWorkflowOutcome,
  AgentWorkflowProgressEvent,
} from "@/lib/agent/workflow-types";

const MAX_SCRIPT_BYTES = 100_000;
const DEFAULT_MAX_AGENTS = 64;
const DEFAULT_MAX_FANOUT = 64;
const DEFAULT_CONCURRENCY = 4;
const SYNC_TIMEOUT_MS = 1_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = Record<string, any>; // Acorn nodes are inspected structurally and never executed.

export type PreparedAgentWorkflow = {
  meta: AgentWorkflowMeta;
  scriptBody: string;
  vmScript: vm.Script;
};

export type ExecuteAgentWorkflowInput = {
  prepared: PreparedAgentWorkflow;
  runId: string;
  args?: unknown;
  signal?: AbortSignal;
  journal?: AgentWorkflowJournal;
  resumeSnapshot?: AgentWorkflowJournalSnapshot;
  maxAgents?: number;
  maxFanout?: number;
  concurrency?: number;
  onProgress?: (event: AgentWorkflowProgressEvent) => void;
  runAgent: (input: {
    prompt: string;
    options: AgentWorkflowAgentOptions;
    index: number;
    runId: string;
    signal?: AbortSignal;
  }) => Promise<{ agentId?: string; value: unknown }>;
  runNestedWorkflow?: (nameOrReference: unknown, args: unknown) => Promise<unknown>;
};

export function prepareAgentWorkflow(script: string):
  | { ok: true; value: PreparedAgentWorkflow }
  | { ok: false; error: string } {
  if (Buffer.byteLength(script, "utf8") > MAX_SCRIPT_BYTES) {
    return { ok: false, error: `Workflow 脚本超过 ${MAX_SCRIPT_BYTES} 字节` };
  }
  const parsed = parseWorkflowMeta(script);
  if (!parsed.ok) return parsed;
  try {
    const vmScript = new vm.Script(`(async () => {\n${parsed.scriptBody}\n})()`, {
      filename: "agent-workflow.js",
      importModuleDynamically: () => {
        throw new Error("Workflow 脚本不能 import 模块");
      },
    });
    return { ok: true, value: { ...parsed, vmScript } };
  } catch (error) {
    return { ok: false, error: `Workflow 脚本语法错误：${describeError(error)}` };
  }
}

export async function executeAgentWorkflow(input: ExecuteAgentWorkflowInput): Promise<AgentWorkflowOutcome> {
  const startedAt = Date.now();
  const failures: string[] = [];
  const logs: string[] = [];
  const limiter = createLimiter(input.concurrency ?? DEFAULT_CONCURRENCY);
  const maxAgents = input.maxAgents ?? DEFAULT_MAX_AGENTS;
  const maxFanout = input.maxFanout ?? DEFAULT_MAX_FANOUT;
  let agentCount = 0;
  let previousCacheKey = "";
  let cacheExhausted = false;
  let currentPhase: string | undefined;
  const phaseIndexes = new Map<string, number>();

  const emit = (event: AgentWorkflowProgressEvent) => {
    if (event.type === "workflow_log" && logs.length < 1_000) logs.push(event.message);
    input.onProgress?.(event);
  };
  const phase = (title: unknown, kind: "meta" | "script" = "script") => {
    const normalized = safeString(title).trim();
    if (!normalized) return;
    currentPhase = normalized;
    if (phaseIndexes.has(normalized)) return;
    const index = phaseIndexes.size + 1;
    phaseIndexes.set(normalized, index);
    emit({ type: "workflow_phase", index, title: normalized, kind });
  };
  for (const item of input.prepared.meta.phases ?? []) phase(item.title, "meta");
  currentPhase = undefined;

  const agent = async (rawPrompt: unknown, rawOptions?: unknown) => {
    input.signal?.throwIfAborted();
    if (agentCount >= maxAgents) throw new Error(`Workflow 最多允许 ${maxAgents} 个 Agent`);
    const prompt = safeString(rawPrompt);
    const options = readAgentOptions(rawOptions);
    const index = ++agentCount;
    const label = (options.label ?? prompt).replace(/\s+/g, " ").trim().slice(0, 120) || `Agent ${index}`;
    const effectivePhase = options.phase ?? currentPhase;
    const cacheKey = input.journal ? agentWorkflowCacheKey(prompt, options, previousCacheKey) : undefined;
    if (cacheKey) previousCacheKey = cacheKey;

    if (cacheKey && !cacheExhausted) {
      const cached = input.resumeSnapshot?.results.get(cacheKey);
      if (cached) {
        emit({ type: "workflow_agent", index, label, state: "succeeded", cached: true, phase: effectivePhase, model: options.model, resultPreview: preview(cached.result) });
        return cached.result;
      }
      cacheExhausted = true;
    }

    emit({ type: "workflow_agent", index, label, state: "queued", phase: effectivePhase, model: options.model });
    return limiter(async () => {
      input.signal?.throwIfAborted();
      const agentStartedAt = Date.now();
      emit({ type: "workflow_agent", index, label, state: "running", phase: effectivePhase, model: options.model, startedAt: agentStartedAt });
      const fallbackAgentId = createAgentWorkflowJournalEntryId();
      try {
        if (cacheKey) await input.journal?.append({ type: "started", key: cacheKey, agentId: fallbackAgentId });
        const result = await input.runAgent({ prompt, options, index, runId: input.runId, signal: input.signal });
        const agentId = result.agentId ?? fallbackAgentId;
        if (cacheKey) await input.journal?.append({ type: "result", key: cacheKey, agentId, result: result.value });
        emit({
          type: "workflow_agent", index, label, state: "succeeded", phase: effectivePhase,
          model: options.model, startedAt: agentStartedAt, durationMs: Date.now() - agentStartedAt,
          resultPreview: preview(result.value),
        });
        return result.value;
      } catch (error) {
        const message = describeError(error);
        emit({
          type: "workflow_agent", index, label, state: "failed", phase: effectivePhase,
          model: options.model, startedAt: agentStartedAt, durationMs: Date.now() - agentStartedAt, error: message,
        });
        throw error;
      }
    });
  };

  const parallel = async (value: unknown) => {
    const thunks = readArray(value, "parallel() 需要函数数组", maxFanout);
    if (thunks.some((item) => typeof item !== "function")) {
      throw new TypeError("parallel() 需要函数数组；请传入 () => agent(...)，不要直接传 Promise");
    }
    return collectSettled(await Promise.allSettled(thunks.map((thunk) => Promise.resolve((thunk as () => unknown)()))), "parallel", failures, emit);
  };

  const pipeline = async (value: unknown, ...rawStages: unknown[]) => {
    const items = readArray(value, "pipeline() 第一个参数必须是数组", maxFanout);
    const stages = rawStages.flat();
    if (stages.some((stage) => typeof stage !== "function")) throw new TypeError("pipeline() 的 stage 必须是函数");
    const settled = await Promise.allSettled(items.map(async (item, index) => {
      let current = item;
      for (const stage of stages) {
        if (current === null) break;
        current = await (stage as (current: unknown, original: unknown, index: number) => unknown)(current, item, index);
      }
      return current;
    }));
    return collectSettled(settled, "pipeline", failures, emit);
  };

  const sandbox = createWorkflowSandbox({
    agent,
    parallel,
    pipeline,
    phase: (...values: unknown[]) => phase(values[0], values[1] === "meta" ? "meta" : values[1] === "script" ? "script" : undefined),
    log: (message) => emit({ type: "workflow_log", message: safeString(message) }),
    args: input.args,
    runNestedWorkflow: input.runNestedWorkflow,
  });
  try {
    const pending = input.prepared.vmScript.runInContext(sandbox.context, { timeout: SYNC_TIMEOUT_MS });
    const result = await raceAbort(sandbox.awaitValue(pending), input.signal);
    await input.journal?.flush();
    return { result: sandbox.exportValue(result), agentCount, failures, logs, durationMs: Date.now() - startedAt };
  } catch (error) {
    await input.journal?.flush().catch(() => undefined);
    return { result: null, agentCount, failures, logs, durationMs: Date.now() - startedAt, error: describeError(error) };
  }
}

function parseWorkflowMeta(script: string):
  | { ok: true; meta: AgentWorkflowMeta; scriptBody: string }
  | { ok: false; error: string } {
  let program: Node;
  try {
    program = parse(script, { ecmaVersion: "latest", sourceType: "module", allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true }) as Node;
  } catch (error) {
    return { ok: false, error: `Workflow 脚本解析失败：${describeError(error)}` };
  }
  const first = program.body?.[0] as Node | undefined;
  const declaration = first?.type === "ExportNamedDeclaration" ? first.declaration as Node | undefined : undefined;
  const declarator = declaration?.type === "VariableDeclaration" && declaration.kind === "const" && declaration.declarations?.length === 1
    ? declaration.declarations[0] as Node
    : undefined;
  if (declarator?.id?.type !== "Identifier" || declarator.id.name !== "meta" || declarator.init?.type !== "ObjectExpression") {
    return { ok: false, error: "Workflow 第一条语句必须是 export const meta = { name, description, phases }" };
  }
  let raw: unknown;
  try {
    raw = evaluateLiteral(declarator.init as Node);
  } catch (error) {
    return { ok: false, error: `Workflow meta 必须是纯字面量：${describeError(error)}` };
  }
  const validated = validateMeta(raw);
  if (!validated.ok) return validated;
  return { ok: true, meta: validated.meta, scriptBody: script.slice(first!.end as number).replace(/^[;\s]*\n/, "").trimStart() };
}

function evaluateLiteral(node: Node): unknown {
  if (node.type === "Literal") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis.map((item: Node) => item.value.cooked ?? "").join("");
  if (node.type === "ArrayExpression") return node.elements.map((item: Node | null) => {
    if (!item || item.type === "SpreadElement") throw new Error("不允许稀疏数组或 spread");
    return evaluateLiteral(item);
  });
  if (node.type === "ObjectExpression") {
    const result: Record<string, unknown> = {};
    for (const property of node.properties as Node[]) {
      if (property.type !== "Property" || property.computed || property.kind !== "init" || property.method) throw new Error("只允许普通 key: value");
      const key = property.key.type === "Identifier" ? property.key.name : String(property.key.value);
      result[key] = evaluateLiteral(property.value as Node);
    }
    return result;
  }
  if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal") return -Number(node.argument.value);
  throw new Error(`不支持 ${String(node.type)}`);
}

function validateMeta(value: unknown): { ok: true; meta: AgentWorkflowMeta } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Workflow meta 必须是对象" };
  const raw = value as Record<string, unknown>;
  if (typeof raw.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(raw.name)) return { ok: false, error: "meta.name 必须是安全的非空名称" };
  if (typeof raw.description !== "string" || !raw.description.trim()) return { ok: false, error: "meta.description 必须是非空字符串" };
  const meta: AgentWorkflowMeta = { name: raw.name, description: raw.description };
  if (typeof raw.title === "string") meta.title = raw.title;
  if (typeof raw.whenToUse === "string") meta.whenToUse = raw.whenToUse;
  if (typeof raw.model === "string") meta.model = raw.model;
  if (raw.phases !== undefined) {
    if (!Array.isArray(raw.phases)) return { ok: false, error: "meta.phases 必须是数组" };
    meta.phases = [];
    for (const item of raw.phases) {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).title !== "string") return { ok: false, error: "每个 phase 必须有 title" };
      const phase = item as Record<string, unknown>;
      meta.phases.push({ title: phase.title as string, ...(typeof phase.detail === "string" ? { detail: phase.detail } : {}), ...(typeof phase.model === "string" ? { model: phase.model } : {}) });
    }
  }
  return { ok: true, meta };
}

function createWorkflowSandbox(input: {
  agent: (...args: unknown[]) => Promise<unknown>;
  parallel: (...args: unknown[]) => Promise<unknown>;
  pipeline: (...args: unknown[]) => Promise<unknown>;
  phase: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
  args: unknown;
  runNestedWorkflow?: (nameOrReference: unknown, args: unknown) => Promise<unknown>;
}) {
  const context = vm.createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(`(() => { const D = Date; globalThis.Date = new Proxy(D, { construct(t,a,n){ if(a.length===0) throw new Error('Workflow 禁止读取当前时间'); return Reflect.construct(t,a,n); }, get(t,p,r){ if(p==='now') throw new Error('Workflow 禁止读取当前时间'); return Reflect.get(t,p,r); } }); Math.random=()=>{ throw new Error('Workflow 禁止随机数'); }; })()`, context);
  const wrapAsync = vm.runInContext("host => async (...args) => host(...args)", context) as (host: (...args: unknown[]) => Promise<unknown>) => unknown;
  const wrapSync = vm.runInContext("host => (...args) => host(...args)", context) as (host: (...args: unknown[]) => void) => unknown;
  const parseJson = vm.runInContext("json => JSON.parse(json)", context) as (json: string) => unknown;
  const awaitValue = vm.runInContext("async value => await value", context) as (value: unknown) => Promise<unknown>;
  Object.defineProperties(context, {
    agent: { value: wrapAsync(input.agent), enumerable: true },
    parallel: { value: wrapAsync(input.parallel), enumerable: true },
    pipeline: { value: wrapAsync(input.pipeline), enumerable: true },
    phase: { value: wrapSync(input.phase), enumerable: true },
    log: { value: wrapSync(input.log), enumerable: true },
    workflow: { value: input.runNestedWorkflow ? wrapAsync(input.runNestedWorkflow) : undefined, enumerable: true },
    args: { value: copyIntoVm(input.args, parseJson), enumerable: true },
  });
  return {
    context,
    awaitValue,
    exportValue: (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "function" ? undefined : item) ?? "null") as unknown,
  };
}

function copyIntoVm(value: unknown, parseJson: (json: string) => unknown) {
  if (value === undefined) return undefined;
  try { return parseJson(JSON.stringify(value)); } catch { return null; }
}

function readAgentOptions(value: unknown): AgentWorkflowAgentOptions {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const options: AgentWorkflowAgentOptions = {};
  for (const key of ["label", "phase", "model", "effort", "agentType"] as const) if (typeof source[key] === "string") options[key] = source[key];
  if (source.isolation === "worktree") options.isolation = "worktree";
  if (source.schema && typeof source.schema === "object") options.schema = JSON.parse(JSON.stringify(source.schema));
  return options;
}

function collectSettled(settled: PromiseSettledResult<unknown>[], kind: string, failures: string[], emit: (event: AgentWorkflowProgressEvent) => void) {
  return settled.map((entry, index) => {
    if (entry.status === "fulfilled") return entry.value;
    const message = `${kind}[${index}] 失败：${describeError(entry.reason)}`;
    failures.push(message);
    emit({ type: "workflow_log", message });
    return null;
  });
}

function readArray(value: unknown, message: string, max: number) {
  if (!Array.isArray(value)) throw new TypeError(message);
  if (value.length > max) throw new RangeError(`单次 fan-out 不能超过 ${max}`);
  return [...value];
}

function createLimiter(concurrency: number) {
  const limit = Math.max(1, Math.min(16, Math.floor(concurrency)));
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(task: () => Promise<T>) => {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try { return await task(); } finally { active -= 1; queue.shift()?.(); }
  };
}

async function raceAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return Promise.race([promise, new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Workflow 已停止")), { once: true }))]);
}

function preview(value: unknown) { const text = safeString(value).trim(); return text ? text.slice(0, 500) : undefined; }
function safeString(value: unknown) { if (typeof value === "string") return value; try { return JSON.stringify(value) ?? String(value); } catch { return "[unserializable]"; } }
function describeError(error: unknown) { return error instanceof Error ? error.message : String(error); }
