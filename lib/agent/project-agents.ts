import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { load as parseYaml } from "js-yaml";

import type { AgentWorkspaceToolName } from "@/lib/agent/types";
import { getAgentToolDefinition } from "@/lib/agent/tool-registry";
import { BUILT_IN_PROJECT_AGENTS } from "@/lib/agent/built-in-agents";
import {
  normalizeProjectAgentMcpServers,
  type ProjectAgentMcpServerSpec,
} from "@/lib/agent/project-agent-mcp";
import { normalizeProjectAgentHooks, type ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import { loadEnabledPluginsForProject, pluginComponentPaths, type EnabledProjectPlugin } from "@/lib/agent/project-plugin-hooks";
import { loadProjectPluginOptions, substitutePluginUserConfigInContent } from "@/lib/agent/project-plugin-options";
import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import { loadProjectCustomizationPolicy } from "@/lib/agent/project-customization-policy";
import { managedComponentDirectories } from "@/lib/agent/managed-settings";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import type { ZenmeSessionPermissionMode } from "@/lib/local/settings";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceRootCapability, listWorkspaceRoots, resolveWorkspaceRoot } from "@/lib/workspace/types";

const MAX_AGENT_BYTES = 100_000;
const MAX_LISTING_CHARS = 8_000;
const discoveredAgentCache = new Map<string, Promise<ProjectAgentDefinition[]>>();

export type ProjectAgentDefinition = {
  agentType: string;
  description: string;
  systemPrompt: string;
  source: "built-in" | "policy" | "project" | "user" | "plugin";
  rootId?: string;
  rootDisplayName?: string;
  primary?: boolean;
  tools?: AgentWorkspaceToolName[];
  disallowedTools?: AgentWorkspaceToolName[];
  skills?: string[];
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTurns?: number;
  background?: boolean;
  memory?: "user" | "project" | "local";
  isolation?: "worktree";
  permissionMode?: ZenmeSessionPermissionMode;
  hooks?: ProjectAgentHooks;
  criticalSystemReminder?: string;
  color?: "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "pink" | "cyan";
  mcpServers?: ProjectAgentMcpServerSpec[];
  initialPrompt?: string;
  filePath: string;
};

const TOOL_ALIASES: Record<string, AgentWorkspaceToolName[]> = {
  agent: ["agent_spawn"],
  bash: ["shell_command"],
  edit: ["edit_file", "apply_patch"],
  glob: ["glob_files"],
  grep: ["search_files"],
  imageedit: ["image_edit"],
  imagegen: ["image_gen"],
  lsp: ["code_intelligence", "code_diagnostics"],
  notebookedit: ["notebook_edit"],
  powershell: ["shell_command"],
  read: ["read_file", "view_image"],
  sendmessage: ["send_message"],
  skill: ["skill"],
  taskcreate: ["task_create"],
  taskget: ["task_get"],
  tasklist: ["task_list"],
  taskupdate: ["task_update"],
  todowrite: [],
  webfetch: ["web_fetch"],
  websearch: ["web_search"],
  write: ["write_file"],
};

type ProjectAgentDiscoveryOptions = { homeDir?: string; managedDirectories?: string[] };

export async function listProjectAgentDefinitions(projectId: string, dataDir: string, rootId?: string, options: ProjectAgentDiscoveryOptions = {}) {
  return discoverProjectAgents(projectId, dataDir, rootId, options);
}

export async function loadProjectAgentDefinition(input: {
  projectId: string;
  dataDir: string;
  agentType: string;
  rootId?: string;
  homeDir?: string;
  managedDirectories?: string[];
}) {
  const requested = input.agentType.trim();
  assertAgentName(requested);
  const definitions = await discoverProjectAgents(input.projectId, input.dataDir, input.rootId, {
    homeDir: input.homeDir,
    managedDirectories: input.managedDirectories,
  });
  const match = definitions.find((definition) => definition.agentType === requested);
  if (!match) throw new Error(`未知 Agent 类型：${requested}`);
  return match;
}

export function formatProjectAgentDefinitionListing(definitions: ProjectAgentDefinition[]) {
  if (!definitions.length) return "";
  const content = definitions.map((definition) => {
    const location = definition.rootId
      ? `Workspace Root「${definition.rootDisplayName}」，rootId=${definition.rootId}`
      : definition.source === "built-in"
        ? "Zenme 内建 Agent"
        : definition.source === "policy" ? "托管策略 Agent" : definition.source === "plugin" ? "插件 Agent" : "用户 Agent";
    return `- ${definition.agentType}: ${definition.description.slice(0, 250)}（${location}）`;
  }).join("\n");
  return content.length <= MAX_LISTING_CHARS ? content : `${content.slice(0, MAX_LISTING_CHARS - 1)}…`;
}

async function discoverProjectAgents(projectId: string, dataDir: string, requestedRootId?: string, options: ProjectAgentDiscoveryOptions = {}) {
  const generation = await getProjectConfigGeneration(projectId, dataDir);
  if (generation !== undefined) {
    const key = JSON.stringify([path.resolve(dataDir), projectId, requestedRootId ?? "", options.homeDir ?? "", options.managedDirectories ?? [], generation]);
    const cached = discoveredAgentCache.get(key);
    if (cached) return cached;
    const pending = discoverProjectAgentsUncached(projectId, dataDir, requestedRootId, options).catch((error) => {
      discoveredAgentCache.delete(key);
      throw error;
    });
    discoveredAgentCache.set(key, pending);
    pruneCache(discoveredAgentCache);
    return pending;
  }
  return discoverProjectAgentsUncached(projectId, dataDir, requestedRootId, options);
}

async function discoverProjectAgentsUncached(projectId: string, dataDir: string, requestedRootId?: string, options: ProjectAgentDiscoveryOptions = {}) {
  const roots: Array<{
    directory: string;
    directFile?: string;
    source: ProjectAgentDefinition["source"];
    rootId?: string;
    rootDisplayName?: string;
    primary?: boolean;
    pluginName?: string;
    plugin?: EnabledProjectPlugin;
  }> = [];
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const customizationPolicy = await loadProjectCustomizationPolicy(projectId, dataDir, {
    managedDirectories: options.managedDirectories,
  });
  const pluginOnly = customizationPolicy.restrictedSurfaces.has("agents");
  const hooksPluginOnly = customizationPolicy.restrictedSurfaces.has("hooks");
  const workspaceRoots = binding
    ? requestedRootId
      ? [resolveWorkspaceRoot(binding, requestedRootId)].filter((root) => root && canUseWorkspaceRootCapability(root, "read"))
      : listWorkspaceRoots(binding).filter((root) => canUseWorkspaceRootCapability(root, "read"))
    : [];
  if (requestedRootId && workspaceRoots.length === 0) throw new Error("Workspace Root 不存在或未授权读取");
  for (const root of pluginOnly ? [] : workspaceRoots) {
    if (!root) continue;
    roots.push(
      { directory: path.join(root.realPath, ".zenme", "agents"), source: "project", rootId: root.id, rootDisplayName: root.displayName, primary: root.primary },
      { directory: path.join(root.realPath, ".claude", "agents"), source: "project", rootId: root.id, rootDisplayName: root.displayName, primary: root.primary },
    );
  }
  if (!pluginOnly) roots.push({ directory: resolveInside(dataDir, "agents"), source: "user" });
  if (!requestedRootId) {
    for (const plugin of await loadEnabledPluginsForProject(projectId, dataDir, options)) {
      for (const candidate of pluginComponentPaths(plugin, "agents")) {
        const stat = await fs.stat(candidate).catch(() => null);
        roots.push(stat?.isFile()
          ? { directory: path.dirname(candidate), directFile: candidate, source: "plugin", pluginName: plugin.name, plugin }
          : { directory: candidate, source: "plugin", pluginName: plugin.name, plugin });
      }
    }
  }
  for (const directory of managedComponentDirectories("agents", options.managedDirectories)) {
    roots.push({ directory, source: "policy" });
  }

  const records: ProjectAgentDefinition[] = [];
  for (const root of roots) {
    let entries: Dirent[];
    try {
      entries = root.directFile
        ? [{ name: path.basename(root.directFile), isFile: () => true } as Dirent]
        : await fs.readdir(root.directory, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
      try {
        const fallbackName = path.basename(entry.name, path.extname(entry.name));
        assertAgentName(fallbackName);
        const realRoot = await fs.realpath(root.directory);
        const realFile = await fs.realpath(path.join(root.directory, entry.name));
        if (!isInside(realRoot, realFile)) continue;
        const stat = await fs.stat(realFile);
        if (!stat.isFile() || stat.size > MAX_AGENT_BYTES) continue;
        const raw = await fs.readFile(realFile, "utf8");
        const parsed = parseAgentMarkdown(root.plugin
          ? substitutePluginUserConfigInContent(raw, await loadProjectPluginOptions(projectId, dataDir, root.plugin, options))
          : raw, fallbackName);
        const namespaced = root.pluginName ? `${root.pluginName}:${parsed.agentType}` : parsed.agentType;
        assertAgentName(namespaced);
        records.push({
          ...parsed,
          ...(hooksPluginOnly && root.source !== "policy" && root.source !== "plugin" ? { hooks: undefined } : {}),
          agentType: namespaced,
          ...(root.pluginName ? {
            skills: parsed.skills?.map((skill) => skill.includes(":") ? skill : `${root.pluginName}:${skill}`),
            permissionMode: undefined,
            hooks: undefined,
            mcpServers: undefined,
          } : {}),
          source: root.source,
          rootId: root.rootId,
          rootDisplayName: root.rootDisplayName,
          primary: root.primary,
          filePath: realFile,
        });
      } catch {
        // Invalid, oversized and escaping definitions are not discoverable.
      }
    }
  }
  const result: ProjectAgentDefinition[] = [];
  for (const record of records.filter((item) => item.source === "project")) {
    if (!result.some((item) => item.rootId === record.rootId && item.agentType === record.agentType)) result.push(record);
  }
  for (const record of records.filter((item) => item.source === "user")) {
    if (!result.some((item) => item.agentType === record.agentType)) result.push(record);
  }
  for (const record of records.filter((item) => item.source === "plugin")) {
    if (!result.some((item) => item.agentType === record.agentType)) result.push(record);
  }
  for (const record of records.filter((item) => item.source === "policy")) {
    const retained = result.filter((item) => item.agentType !== record.agentType);
    retained.push(record);
    result.splice(0, result.length, ...retained);
  }
  for (const builtIn of BUILT_IN_PROJECT_AGENTS) {
    if (result.some((item) => item.agentType === builtIn.agentType)) continue;
    result.push({
      ...builtIn,
      source: "built-in",
      filePath: `<built-in:${builtIn.agentType}>`,
    });
  }
  return result;
}

function pruneCache(cache: Map<string, unknown>) {
  while (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

function parseAgentMarkdown(raw: string, fallbackName: string): Omit<ProjectAgentDefinition, "source" | "rootId" | "rootDisplayName" | "primary" | "filePath"> {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error("Agent 定义缺少 frontmatter");
  const fields = parseYamlFrontmatter(match[1]);
  const agentType = stringField(fields, "name") || fallbackName;
  const description = stringField(fields, "description");
  const systemPrompt = normalized.slice(match[0].length).trim();
  assertAgentName(agentType);
  if (!description || !systemPrompt) throw new Error("Agent 定义缺少 description 或 prompt");
  const effort = stringField(fields, "effort");
  const memory = stringField(fields, "memory");
  const permissionMode = normalizeAgentPermissionMode(field(fields, "permissionMode", "permission-mode"));
  const color = stringField(fields, "color");
  return {
    agentType,
    description,
    systemPrompt,
    tools: mapTools(stringListField(fields, "tools")),
    disallowedTools: mapTools(stringListField(fields, "disallowedTools", "disallowedtools", "disallowed-tools")),
    skills: stringListField(fields, "skills"),
    model: stringField(fields, "model") || undefined,
    effort: ["low", "medium", "high", "xhigh"].includes(effort) ? effort as ProjectAgentDefinition["effort"] : undefined,
    maxTurns: positiveIntegerField(field(fields, "maxTurns", "maxturns", "max-turns")),
    background: booleanField(field(fields, "background")),
    memory: ["user", "project", "local"].includes(memory) ? memory as ProjectAgentDefinition["memory"] : undefined,
    isolation: stringField(fields, "isolation") === "worktree" ? "worktree" : undefined,
    permissionMode,
    hooks: normalizeProjectAgentHooks(field(fields, "hooks")),
    criticalSystemReminder: stringField(fields, "criticalSystemReminder", "criticalSystemReminder_EXPERIMENTAL") || undefined,
    color: ["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"].includes(color) ? color as ProjectAgentDefinition["color"] : undefined,
    mcpServers: normalizeProjectAgentMcpServers(field(fields, "mcpServers", "mcp-servers")),
    initialPrompt: stringField(fields, "initialPrompt", "initialprompt", "initial-prompt") || undefined,
  };
}

function parseYamlFrontmatter(value: string): Record<string, unknown> {
  const parsed = parseYaml(value, { json: true });
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Agent frontmatter 必须是对象");
  return parsed as Record<string, unknown>;
}

function field(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (Object.hasOwn(fields, key)) return fields[key];
  return undefined;
}
function stringField(fields: Record<string, unknown>, ...keys: string[]) {
  const value = field(fields, ...keys);
  return typeof value === "string" ? value.trim() : "";
}
function stringListField(fields: Record<string, unknown>, ...keys: string[]) {
  const value = field(fields, ...keys);
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return entries.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}
function booleanField(value: unknown) { return typeof value === "boolean" ? value : undefined; }
function positiveIntegerField(value: unknown) { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined; }
function normalizeAgentPermissionMode(value: unknown): ZenmeSessionPermissionMode | undefined {
  if (value === "untrusted" || value === "onRequest" || value === "neverAsk") return value;
  if (value === "bypassPermissions" || value === "dontAsk") return "neverAsk";
  if (value === "plan" || value === "delegate") return "untrusted";
  if (value === "default" || value === "acceptEdits") return "onRequest";
  return undefined;
}
function mapTools(values: string[]) {
  if (!values.length) return undefined;
  const tools = values
    .flatMap((value) => TOOL_ALIASES[value.replace(/[^A-Za-z]/g, "").toLowerCase()] ?? [value as AgentWorkspaceToolName])
    .filter((tool) => getAgentToolDefinition(tool)?.internal !== true);
  return [...new Set(tools)];
}
function assertAgentName(value: string) {
  const parts = value.split(":");
  if (parts.length > 2 || parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part))) {
    throw new Error("Agent 名称无效");
  }
  if (parts.length === 1) assertSafePathSegment(value, "agent name");
}
function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
