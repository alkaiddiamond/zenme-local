import type { ProjectPluginOptions } from "@/lib/agent/project-plugin-options";
import crypto from "node:crypto";

export const PROJECT_AGENT_HOOK_EVENTS = [
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "UserPromptSubmit",
  "SessionStart", "SessionEnd", "Stop", "StopFailure", "SubagentStart", "SubagentStop",
  "PreCompact", "PostCompact", "PermissionRequest", "PermissionDenied", "Setup", "TeammateIdle",
  "TaskCreated", "TaskCompleted", "Elicitation", "ElicitationResult", "ConfigChange",
  "WorktreeCreate", "WorktreeRemove", "InstructionsLoaded", "CwdChanged", "FileChanged",
] as const;

export type ProjectAgentHookEvent = typeof PROJECT_AGENT_HOOK_EVENTS[number];

type ProjectAgentHookBase = {
  if?: string;
  timeout?: number;
  statusMessage?: string;
  once?: boolean;
};

export type ProjectAgentHook = ProjectAgentHookBase & (
  | { type: "command"; command: string; shell?: "bash" | "powershell"; async?: boolean; asyncRewake?: boolean }
  | { type: "prompt" | "agent"; prompt: string; model?: string }
  | { type: "http"; url: string; headers?: Record<string, string>; allowedEnvVars?: string[] }
);

export type ProjectAgentHookMatcher = {
  matcher?: string;
  hooks: ProjectAgentHook[];
  /** Present only for hooks loaded from an explicitly enabled installed plugin. */
  pluginRoot?: string;
  pluginId?: string;
  pluginDataRoot?: string;
  pluginOptions?: ProjectPluginOptions;
  /** Present for hooks registered from an invoked Skill. */
  skillRoot?: string;
};

export type ProjectAgentHooks = Partial<Record<ProjectAgentHookEvent, ProjectAgentHookMatcher[]>>;

/**
 * cc-haha resolves session/plugin hooks and Agent-frontmatter hooks into the
 * same event registry. Keep every matching source instead of letting a custom
 * Agent silently replace the Project lifecycle.
 */
export function mergeProjectAgentHooks(...sources: Array<ProjectAgentHooks | undefined>): ProjectAgentHooks | undefined {
  const merged: ProjectAgentHooks = {};
  for (const source of sources) {
    if (!source) continue;
    for (const event of PROJECT_AGENT_HOOK_EVENTS) {
      const matchers = source[event];
      if (!matchers?.length) continue;
      merged[event] = [...(merged[event] ?? []), ...matchers];
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

export function projectAgentHookId(
  event: ProjectAgentHookEvent,
  matcher: ProjectAgentHookMatcher,
  hook: ProjectAgentHook,
) {
  return crypto.createHash("sha256").update(JSON.stringify({
    event,
    matcher: matcher.matcher ?? "",
    pluginRoot: matcher.pluginRoot ?? "",
    pluginId: matcher.pluginId ?? "",
    pluginDataRoot: matcher.pluginDataRoot ?? "",
    skillRoot: matcher.skillRoot ?? "",
    hook,
  })).digest("hex");
}

export function omitConsumedProjectAgentHooks(
  hooks: ProjectAgentHooks | undefined,
  consumedIds: Iterable<string>,
): ProjectAgentHooks | undefined {
  if (!hooks) return undefined;
  const consumed = new Set(consumedIds);
  const result: ProjectAgentHooks = {};
  for (const event of PROJECT_AGENT_HOOK_EVENTS) {
    const matchers = hooks[event]?.flatMap((matcher) => {
      const remaining = matcher.hooks.filter((hook) => !consumed.has(projectAgentHookId(event, matcher, hook)));
      return remaining.length ? [{ ...matcher, hooks: remaining }] : [];
    });
    if (matchers?.length) result[event] = matchers;
  }
  return Object.keys(result).length ? result : undefined;
}

const EVENT_SET = new Set<string>(PROJECT_AGENT_HOOK_EVENTS);

export function normalizeProjectAgentHooks(
  value: unknown,
  options: { preserveRuntimeMetadata?: boolean } = {},
): ProjectAgentHooks | undefined {
  if (!isRecord(value)) return undefined;
  const result: ProjectAgentHooks = {};
  let totalHooks = 0;
  for (const [event, rawMatchers] of Object.entries(value)) {
    if (!EVENT_SET.has(event) || !Array.isArray(rawMatchers)) continue;
    const matchers = rawMatchers.slice(0, 50).flatMap((rawMatcher) => {
      if (!isRecord(rawMatcher) || !Array.isArray(rawMatcher.hooks)) return [];
      const hooks = rawMatcher.hooks.slice(0, 50).flatMap(normalizeHook);
      totalHooks += hooks.length;
      if (!hooks.length || totalHooks > 200) return [];
      const matcher = optionalString(rawMatcher.matcher, 500);
      const metadata = options.preserveRuntimeMetadata ? {
        ...(optionalString(rawMatcher.pluginRoot, 4_096) ? { pluginRoot: optionalString(rawMatcher.pluginRoot, 4_096) } : {}),
        ...(optionalString(rawMatcher.pluginId, 500) ? { pluginId: optionalString(rawMatcher.pluginId, 500) } : {}),
        ...(optionalString(rawMatcher.pluginDataRoot, 4_096) ? { pluginDataRoot: optionalString(rawMatcher.pluginDataRoot, 4_096) } : {}),
        ...(optionalString(rawMatcher.skillRoot, 4_096) ? { skillRoot: optionalString(rawMatcher.skillRoot, 4_096) } : {}),
      } : {};
      return [{ ...(matcher ? { matcher } : {}), ...metadata, hooks }];
    });
    if (matchers.length) result[event as ProjectAgentHookEvent] = matchers;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeHook(value: unknown): ProjectAgentHook[] {
  if (!isRecord(value)) return [];
  const type = optionalString(value.type, 20);
  const base = {
    ...(optionalString(value.if, 1_000) ? { if: optionalString(value.if, 1_000) } : {}),
    ...(positiveNumber(value.timeout) ? { timeout: positiveNumber(value.timeout) } : {}),
    ...(optionalString(value.statusMessage, 500) ? { statusMessage: optionalString(value.statusMessage, 500) } : {}),
    ...(typeof value.once === "boolean" ? { once: value.once } : {}),
  };
  if (type === "command") {
    const command = optionalString(value.command, 20_000);
    if (!command) return [];
    const shell = value.shell === "bash" || value.shell === "powershell" ? value.shell : undefined;
    return [{ ...base, type, command, ...(shell ? { shell } : {}), ...(typeof value.async === "boolean" ? { async: value.async } : {}), ...(typeof value.asyncRewake === "boolean" ? { asyncRewake: value.asyncRewake } : {}) }];
  }
  if (type === "prompt" || type === "agent") {
    const prompt = optionalString(value.prompt, 50_000);
    if (!prompt) return [];
    const model = optionalString(value.model, 500);
    return [{ ...base, type, prompt, ...(model ? { model } : {}) }];
  }
  if (type === "http") {
    const url = optionalString(value.url, 4_096);
    if (!url || !isHttpUrl(url)) return [];
    const headers = isRecord(value.headers)
      ? Object.fromEntries(Object.entries(value.headers).slice(0, 50).flatMap(([key, header]) => {
          const normalized = optionalString(header, 4_096);
          return normalized ? [[key.slice(0, 200), normalized]] : [];
        }))
      : undefined;
    const allowedEnvVars = Array.isArray(value.allowedEnvVars)
      ? value.allowedEnvVars.filter((item): item is string => typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item)).slice(0, 50)
      : undefined;
    return [{ ...base, type, url, ...(headers && Object.keys(headers).length ? { headers } : {}), ...(allowedEnvVars?.length ? { allowedEnvVars } : {}) }];
  }
  return [];
}

function optionalString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(3_600, value)
    : undefined;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
