import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentCallableToolName } from "@/lib/agent/types";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability } from "@/lib/workspace/types";
import { getDefaultManagedSettingsDirectories } from "@/lib/agent/managed-settings";

const MAX_SETTINGS_BYTES = 1_048_576;
const MAX_RULES_PER_BEHAVIOR = 1_000;

export type ProjectPermissionBehavior = "allow" | "ask" | "deny";

export type ProjectPermissionRule = {
  behavior: ProjectPermissionBehavior;
  content?: string;
  source: "policy" | "user" | "project" | "local";
  toolName: string;
};

export async function loadProjectPermissionRules(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string; managedDirectories?: string[] } = {},
): Promise<ProjectPermissionRule[]> {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const homeDir = options.homeDir ?? os.homedir();
  const managedDirectories = options.managedDirectories ?? getDefaultManagedSettingsDirectories();
  const managedSettings = await loadFirstManagedPermissionSettings(managedDirectories);
  const sources = [
    { filePath: path.join(homeDir, ".claude", "settings.json"), source: "user" as const },
    { filePath: path.join(homeDir, ".zenme", "settings.json"), source: "user" as const },
    ...(binding && canUseWorkspaceCapability(binding, "read")
      ? [
          { filePath: path.join(binding.realPath, ".claude", "settings.json"), source: "project" as const },
          { filePath: path.join(binding.realPath, ".zenme", "settings.json"), source: "project" as const },
          { filePath: path.join(binding.realPath, ".claude", "settings.local.json"), source: "local" as const },
          { filePath: path.join(binding.realPath, ".zenme", "settings.local.json"), source: "local" as const },
        ]
      : []),
  ];
  const editableRules = (await Promise.all(sources.map(async (entry) =>
    readPermissionRules(entry.filePath, entry.source)))).flat();
  return managedSettings.allowManagedPermissionRulesOnly
    ? managedSettings.rules
    : [...editableRules, ...managedSettings.rules];
}

export function evaluateProjectToolPermission(input: {
  content?: string;
  name: AgentCallableToolName;
  rules: readonly ProjectPermissionRule[];
}): ProjectPermissionBehavior | undefined {
  const matches = input.rules.filter((rule) =>
    toolNamesMatch(rule.toolName, input.name) &&
    (rule.content === undefined ||
      (input.content !== undefined && shellRuleMatches(rule.content, input.content))));
  if (matches.some((rule) => rule.behavior === "deny")) return "deny";
  if (matches.some((rule) => rule.behavior === "ask")) return "ask";
  if (matches.some((rule) => rule.behavior === "allow")) return "allow";
  return undefined;
}

export function isProjectToolBlanketDenied(
  name: AgentCallableToolName,
  rules: readonly ProjectPermissionRule[],
) {
  return rules.some((rule) =>
    rule.behavior === "deny" && rule.content === undefined && toolNamesMatch(rule.toolName, name));
}

export function parseProjectPermissionRule(
  value: string,
  behavior: ProjectPermissionBehavior,
  source: ProjectPermissionRule["source"],
): ProjectPermissionRule | undefined {
  const normalized = value.trim();
  if (!normalized || normalized.length > 8_192) return undefined;
  const open = firstUnescaped(normalized, "(");
  const close = lastUnescaped(normalized, ")");
  if (open <= 0 || close !== normalized.length - 1 || close <= open) {
    return { behavior, source, toolName: normalized };
  }
  const toolName = normalized.slice(0, open).trim();
  if (!toolName) return undefined;
  const rawContent = normalized.slice(open + 1, close);
  return {
    behavior,
    source,
    toolName,
    ...(rawContent && rawContent !== "*" ? { content: unescapeRuleContent(rawContent) } : {}),
  };
}

export function shellRuleMatches(rule: string, command: string) {
  const trimmedRule = rule.trim();
  const trimmedCommand = command.trim();
  const legacyPrefix = trimmedRule.match(/^(.+):\*$/u)?.[1];
  if (legacyPrefix !== undefined) {
    return trimmedCommand === legacyPrefix || trimmedCommand.startsWith(`${legacyPrefix} `);
  }
  if (!hasUnescapedWildcard(trimmedRule)) return trimmedCommand === trimmedRule;
  const pattern = wildcardRegExp(trimmedRule);
  return new RegExp(`^${pattern}$`, process.platform === "win32" ? "isu" : "su").test(trimmedCommand);
}

async function readPermissionRules(filePath: string, source: ProjectPermissionRule["source"]) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) return [];
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed) || !isRecord(parsed.permissions)) return [];
    const rules: ProjectPermissionRule[] = [];
    for (const behavior of ["allow", "ask", "deny"] as const) {
      const values = Array.isArray(parsed.permissions[behavior])
        ? parsed.permissions[behavior].slice(0, MAX_RULES_PER_BEHAVIOR)
        : [];
      for (const value of values) {
        if (typeof value !== "string") continue;
        const rule = parseProjectPermissionRule(value, behavior, source);
        if (rule) rules.push(rule);
      }
    }
    return rules;
  } catch (error) {
    if (error instanceof SyntaxError || isMissingFileError(error)) return [];
    throw error;
  }
}

async function loadFirstManagedPermissionSettings(directories: readonly string[]) {
  for (const directory of directories) {
    const settings = await readManagedPermissionSettings(directory);
    if (settings.found) return settings;
  }
  return { allowManagedPermissionRulesOnly: false, found: false, rules: [] as ProjectPermissionRule[] };
}

async function readManagedPermissionSettings(directory: string) {
  const filePaths = [path.join(directory, "managed-settings.json")];
  try {
    const entries = await fs.readdir(path.join(directory, "managed-settings.d"), { withFileTypes: true });
    filePaths.push(...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .map((entry) => path.join(directory, "managed-settings.d", entry.name))
      .sort((left, right) => left.localeCompare(right)));
  } catch (error) {
    if (!isMissingOrUnreadableFileError(error)) throw error;
  }
  const rules: ProjectPermissionRule[] = [];
  let allowManagedPermissionRulesOnly = false;
  let found = false;
  for (const filePath of filePaths) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) continue;
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!isRecord(parsed)) continue;
      found ||= Object.keys(parsed).length > 0;
      if (typeof parsed.allowManagedPermissionRulesOnly === "boolean") {
        allowManagedPermissionRulesOnly = parsed.allowManagedPermissionRulesOnly;
      }
      if (!isRecord(parsed.permissions)) continue;
      for (const behavior of ["allow", "ask", "deny"] as const) {
        const values = Array.isArray(parsed.permissions[behavior])
          ? parsed.permissions[behavior].slice(0, MAX_RULES_PER_BEHAVIOR)
          : [];
        for (const value of values) {
          if (typeof value !== "string") continue;
          const rule = parseProjectPermissionRule(value, behavior, "policy");
          if (rule && !rules.some((candidate) => samePermissionRule(candidate, rule))) rules.push(rule);
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError || isMissingOrUnreadableFileError(error)) continue;
      throw error;
    }
  }
  return { allowManagedPermissionRulesOnly, found, rules };
}

function samePermissionRule(left: ProjectPermissionRule, right: ProjectPermissionRule) {
  return left.behavior === right.behavior && left.toolName === right.toolName && left.content === right.content;
}

function toolNamesMatch(ruleName: string, name: AgentCallableToolName) {
  const normalized = ruleName.replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
  if (normalized === name.toLowerCase()) return true;
  if (normalized.startsWith("mcp__") && name.toLowerCase().startsWith(`${normalized}__`)) return true;
  const aliases: Partial<Record<AgentCallableToolName, string[]>> = {
    agent_spawn: ["agent", "task"],
    apply_patch: ["edit"],
    edit_file: ["edit"],
    glob_files: ["glob"],
    notebook_edit: ["notebookedit"],
    read_file: ["read"],
    search_files: ["grep"],
    shell_command: ["bash", "powershell", "shellcommand"],
    task_output: ["taskoutput", "bashoutputtool", "agentoutputtool"],
    task_stop: ["taskstop", "killshell"],
    web_fetch: ["webfetch"],
    web_search: ["websearch"],
    write_file: ["write"],
  };
  return aliases[name]?.includes(normalized) ?? false;
}

function firstUnescaped(value: string, character: string) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === character && precedingBackslashes(value, index) % 2 === 0) return index;
  }
  return -1;
}

function lastUnescaped(value: string, character: string) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === character && precedingBackslashes(value, index) % 2 === 0) return index;
  }
  return -1;
}

function precedingBackslashes(value: string, index: number) {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) count += 1;
  return count;
}

function unescapeRuleContent(value: string) {
  return value.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
}

function hasUnescapedWildcard(value: string) {
  if (value.endsWith(":*")) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "*" && precedingBackslashes(value, index) % 2 === 0) return true;
  }
  return false;
}

function wildcardRegExp(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && value[index + 1] === "*") {
      result += "\\*";
      index += 1;
    } else if (character === "*") {
      result += ".*";
    } else {
      result += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  if (result.endsWith(" .*") && (result.match(/\.\*/g) ?? []).length === 1) {
    return `${result.slice(0, -3)}(?: .*)?`;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingFileError(error: unknown) {
  return error instanceof Error && "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isMissingOrUnreadableFileError(error: unknown) {
  return error instanceof Error && "code" in error &&
    ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code));
}
