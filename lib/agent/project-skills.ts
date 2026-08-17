import fs from "node:fs/promises";
import path from "node:path";
import type { Dirent } from "node:fs";
import { load as parseYaml } from "js-yaml";

import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { loadEnabledPluginsForProject, pluginComponentPaths, type EnabledProjectPlugin } from "@/lib/agent/project-plugin-hooks";
import { loadProjectPluginOptions, substitutePluginUserConfigInContent } from "@/lib/agent/project-plugin-options";
import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import { loadProjectCustomizationPolicy } from "@/lib/agent/project-customization-policy";
import { normalizeProjectAgentHooks, type ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import { managedComponentDirectories } from "@/lib/agent/managed-settings";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import {
  canUseWorkspaceRootCapability,
  listWorkspaceRoots,
  resolveWorkspaceRoot,
} from "@/lib/workspace/types";

const MAX_SKILL_BYTES = 100_000;
const MAX_LISTING_CHARS = 8_000;

export type ProjectSkillSummary = {
  name: string;
  description: string;
  source: "policy" | "project" | "user" | "plugin";
  rootId?: string;
  rootDisplayName?: string;
  primary?: boolean;
  argumentHint?: string;
  command?: boolean;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  executionContext?: "fork";
  agent?: string;
};

type ProjectSkillRecord = ProjectSkillSummary & {
  directory: string;
  filePath: string;
  pluginDataRoot?: string;
  plugin?: EnabledProjectPlugin;
  pluginRoot?: string;
  raw: string;
  allowedTools: string[];
  argumentNames: string[];
  effort?: "low" | "medium" | "high" | "xhigh";
  model?: string;
  shell?: "bash" | "powershell";
  hooks?: ProjectAgentHooks;
};

const discoveredSkillCache = new Map<string, Promise<ProjectSkillRecord[]>>();

type ProjectSkillDiscoveryOptions = { homeDir?: string; managedDirectories?: string[] };

export async function listProjectSkills(projectId: string, dataDir: string, rootId?: string, options: ProjectSkillDiscoveryOptions = {}): Promise<ProjectSkillSummary[]> {
  return (await discoverProjectSkills(projectId, dataDir, rootId, options)).map(({ name, description, source, rootId: skillRootId, rootDisplayName, primary, argumentHint, command, disableModelInvocation, userInvocable, executionContext, agent }) => ({
    name,
    description,
    source,
    rootId: skillRootId,
    rootDisplayName,
    primary,
    argumentHint,
    command,
    disableModelInvocation,
    userInvocable,
    executionContext,
    agent,
  }));
}

export async function loadProjectSkill(input: {
  projectId: string;
  dataDir: string;
  skill: string;
  args?: string;
  rootId?: string;
  homeDir?: string;
  managedDirectories?: string[];
  invokedBy?: "model" | "user";
}) {
  const requestedName = input.skill.trim().replace(/^\//, "");
  assertSkillName(requestedName);
  const record = (await discoverProjectSkills(input.projectId, input.dataDir, input.rootId, {
    homeDir: input.homeDir,
    managedDirectories: input.managedDirectories,
  }))
    .find((candidate) => candidate.name === requestedName);
  if (!record) throw new Error(`未知技能：${requestedName}`);
  if ((input.invokedBy ?? "model") === "model" && record.disableModelInvocation) {
    throw new Error(`技能 ${requestedName} 已设置 disable-model-invocation，只能由用户直接调用`);
  }
  if (input.invokedBy === "user" && record.userInvocable === false) {
    throw new Error(`技能 ${requestedName} 已设置 user-invocable: false，只能由 Agent 调用`);
  }
  const raw = record.raw;
  const body = parseSkillMarkdown(record.plugin
    ? substitutePluginUserConfigInContent(raw, await loadProjectPluginOptions(input.projectId, input.dataDir, record.plugin, { homeDir: input.homeDir }))
    : raw).body;
  const normalizedDirectory = process.platform === "win32"
    ? record.directory.replaceAll("\\", "/")
    : record.directory;
  const args = input.args?.trim().slice(0, 10_000) ?? "";
  const expandedBody = substituteSkillArguments(body, args, record.argumentNames);
  const content = [
    `此技能的基础目录：${normalizedDirectory}`,
    expandedBody,
  ].filter(Boolean).join("\n\n")
    .replaceAll("${ZENME_SKILL_DIR}", normalizedDirectory)
    .replaceAll("${CLAUDE_SKILL_DIR}", normalizedDirectory)
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", normalizePromptPath(record.pluginRoot ?? record.directory))
    .replaceAll("${CLAUDE_PLUGIN_DATA}", normalizePromptPath(record.pluginDataRoot ?? record.directory));
  return {
    name: record.name,
    description: record.description,
    source: record.source,
    rootId: record.rootId,
    rootDisplayName: record.rootDisplayName,
    baseDirectory: normalizedDirectory,
    allowedTools: record.allowedTools,
    argumentHint: record.argumentHint,
    command: record.command,
    disableModelInvocation: record.disableModelInvocation,
    effort: record.effort,
    model: record.model,
    shell: record.shell,
    userInvocable: record.userInvocable,
    executionContext: record.executionContext,
    agent: record.agent,
    hooks: record.hooks,
    content,
  };
}

export async function resolveProjectSlashCommand(input: {
  projectId: string;
  dataDir: string;
  prompt: string;
  rootId?: string;
  homeDir?: string;
  managedDirectories?: string[];
}) {
  const parsed = parseSlashCommandInput(input.prompt);
  if (!parsed) return null;
  const records = await discoverProjectSkills(input.projectId, input.dataDir, input.rootId, {
    homeDir: input.homeDir,
    managedDirectories: input.managedDirectories,
  });
  const record = records.find((candidate) => candidate.name === parsed.name);
  if (!record) return null;
  const loaded = await loadProjectSkill({
    projectId: input.projectId,
    dataDir: input.dataDir,
    skill: parsed.name,
    args: parsed.args,
    rootId: input.rootId,
    homeDir: input.homeDir,
    managedDirectories: input.managedDirectories,
    invokedBy: "user",
  });
  return { ...loaded, invocationArgs: parsed.args };
}

export function formatProjectSkillListing(skills: ProjectSkillSummary[]) {
  if (!skills.length) return "";
  const content = skills.map((skill) => {
    const source = skill.rootId
      ? `Workspace Root「${skill.rootDisplayName}」，rootId=${skill.rootId}`
      : skill.source === "policy"
        ? "托管策略"
        : skill.source === "plugin"
          ? "插件"
          : "用户技能";
    return `- ${skill.name}: ${skill.description.slice(0, 250)}（${source}）`;
  }).join("\n");
  return content.length <= MAX_LISTING_CHARS ? content : `${content.slice(0, MAX_LISTING_CHARS - 1)}…`;
}

async function discoverProjectSkills(projectId: string, dataDir: string, requestedRootId?: string, options: ProjectSkillDiscoveryOptions = {}) {
  const generation = await getProjectConfigGeneration(projectId, dataDir);
  if (generation !== undefined) {
    const key = JSON.stringify([path.resolve(dataDir), projectId, requestedRootId ?? "", options.homeDir ?? "", options.managedDirectories ?? [], generation]);
    const cached = discoveredSkillCache.get(key);
    if (cached) return cached;
    const pending = discoverProjectSkillsUncached(projectId, dataDir, requestedRootId, options).catch((error) => {
      discoveredSkillCache.delete(key);
      throw error;
    });
    discoveredSkillCache.set(key, pending);
    while (discoveredSkillCache.size > 200) {
      const oldest = discoveredSkillCache.keys().next().value;
      if (typeof oldest !== "string") break;
      discoveredSkillCache.delete(oldest);
    }
    return pending;
  }
  return discoverProjectSkillsUncached(projectId, dataDir, requestedRootId, options);
}

async function discoverProjectSkillsUncached(projectId: string, dataDir: string, requestedRootId?: string, options: ProjectSkillDiscoveryOptions = {}) {
  const roots: Array<{
    directory: string;
    source: ProjectSkillRecord["source"];
    rootId?: string;
    rootDisplayName?: string;
    primary?: boolean;
    pluginName?: string;
    pluginDataRoot?: string;
    pluginRoot?: string;
    plugin?: EnabledProjectPlugin;
    commandMode?: boolean;
  }> = [];
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const customizationPolicy = await loadProjectCustomizationPolicy(projectId, dataDir, {
    managedDirectories: options.managedDirectories,
  });
  const pluginOnly = customizationPolicy.restrictedSurfaces.has("skills");
  const hooksPluginOnly = customizationPolicy.restrictedSurfaces.has("hooks");
  for (const directory of managedComponentDirectories("skills", options.managedDirectories)) {
    roots.push({ directory, source: "policy" });
  }
  for (const directory of managedComponentDirectories("commands", options.managedDirectories)) {
    roots.push({ directory, source: "policy", commandMode: true });
  }
  const workspaceRoots = binding
    ? requestedRootId
      ? [resolveWorkspaceRoot(binding, requestedRootId)].filter((root) => root && canUseWorkspaceRootCapability(root, "read"))
      : listWorkspaceRoots(binding).filter((root) => canUseWorkspaceRootCapability(root, "read"))
    : [];
  if (requestedRootId && workspaceRoots.length === 0) throw new Error("Workspace Root 不存在或未授权读取");
  for (const workspaceRoot of pluginOnly ? [] : workspaceRoots) {
    if (!workspaceRoot) continue;
    for (const relative of [[".zenme", "skills"], [".claude", "skills"], [".agents", "skills"]]) {
      roots.push({
        directory: path.join(workspaceRoot.realPath, ...relative),
        source: "project",
        rootId: workspaceRoot.id,
        rootDisplayName: workspaceRoot.displayName,
        primary: workspaceRoot.primary,
      });
    }
    for (const relative of [[".zenme", "commands"], [".claude", "commands"]]) {
      roots.push({
        directory: path.join(workspaceRoot.realPath, ...relative),
        source: "project",
        rootId: workspaceRoot.id,
        rootDisplayName: workspaceRoot.displayName,
        primary: workspaceRoot.primary,
        commandMode: true,
      });
    }
  }
  if (!pluginOnly) {
    roots.push({ directory: resolveInside(dataDir, "skills"), source: "user" });
    roots.push({ directory: resolveInside(dataDir, "commands"), source: "user", commandMode: true });
  }
  if (!requestedRootId) {
    for (const plugin of await loadEnabledPluginsForProject(projectId, dataDir, options)) {
      for (const directory of pluginComponentPaths(plugin, "skills")) {
        roots.push({ directory, source: "plugin", pluginName: plugin.name, pluginRoot: plugin.root, pluginDataRoot: plugin.dataRoot, plugin });
      }
      for (const directory of pluginComponentPaths(plugin, "commands")) {
        roots.push({
          directory,
          source: "plugin",
          pluginName: plugin.name,
          pluginRoot: plugin.root,
          pluginDataRoot: plugin.dataRoot,
          plugin,
          commandMode: true,
        });
      }
    }
  }

  const records: ProjectSkillRecord[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (root.commandMode) {
      const commands = await discoverMarkdownCommands(root, hooksPluginOnly);
      for (const command of commands) {
        const identity = `${root.rootId ?? "global"}:${command.name}`;
        if (seen.has(identity)) continue;
        if (root.source !== "policy" && records.some((record) => record.source === "policy" && record.name === command.name)) continue;
        if (root.source === "user" && records.some((record) => record.source === "project" && record.name === command.name)) continue;
        seen.add(identity);
        records.push(command);
      }
      continue;
    }
    const directFile = path.join(root.directory, "SKILL.md");
    try {
      const realRoot = await fs.realpath(root.directory);
      const realFile = await fs.realpath(directFile);
      if (isInside(realRoot, realFile)) {
        const raw = await readBoundedSkill(realFile);
        const parsed = parseSkillMarkdown(raw);
        const baseName = path.basename(root.directory);
        const name = root.pluginName ? `${root.pluginName}:${baseName}` : parsed.name || baseName;
        assertSkillName(name);
        const identity = `${root.rootId ?? "global"}:${name}`;
        if (!seen.has(identity) && !(root.source !== "policy" && records.some((record) => record.source === "policy" && record.name === name))) {
          seen.add(identity);
          records.push({
            name,
            description: parsed.description || firstUsefulLine(parsed.body) || "项目技能",
            source: root.source,
            rootId: root.rootId,
            rootDisplayName: root.rootDisplayName,
            primary: root.primary,
            directory: path.dirname(realFile),
            filePath: realFile,
            raw,
            pluginRoot: root.pluginRoot,
            pluginDataRoot: root.pluginDataRoot,
            plugin: root.plugin,
            allowedTools: parsed.allowedTools,
            argumentNames: parsed.argumentNames,
            argumentHint: parsed.argumentHint,
            command: false,
            disableModelInvocation: parsed.disableModelInvocation,
            effort: parsed.effort,
            model: parsed.model,
            shell: parsed.shell,
            userInvocable: parsed.userInvocable,
            executionContext: parsed.executionContext,
            agent: parsed.agent,
            hooks: hooksPluginOnly && root.source !== "policy" && root.source !== "plugin"
              ? undefined
              : withSkillRoot(parsed.hooks, path.dirname(realFile)),
          });
        }
        continue;
      }
    } catch {
      // A component root can instead contain multiple skill directories.
    }
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try { assertSkillName(entry.name); } catch { continue; }
      const filePath = path.join(root.directory, entry.name, "SKILL.md");
      try {
        const realRoot = await fs.realpath(root.directory);
        const realFile = await fs.realpath(filePath);
        if (!isInside(realRoot, realFile)) continue;
        const raw = await readBoundedSkill(realFile);
        const parsed = parseSkillMarkdown(raw);
        const name = root.pluginName ? `${root.pluginName}:${entry.name}` : parsed.name || entry.name;
        assertSkillName(name);
        const identity = `${root.rootId ?? "user"}:${name}`;
        if (seen.has(identity)) continue;
        if (root.source !== "policy" && records.some((record) => record.source === "policy" && record.name === name)) continue;
        if (root.source === "user" && records.some((record) => record.source === "project" && record.name === name)) continue;
        seen.add(identity);
        records.push({
          name,
          description: parsed.description || firstUsefulLine(parsed.body) || "项目技能",
          source: root.source,
          rootId: root.rootId,
          rootDisplayName: root.rootDisplayName,
          primary: root.primary,
          directory: path.dirname(realFile),
          filePath: realFile,
          raw,
          pluginRoot: root.pluginRoot,
          pluginDataRoot: root.pluginDataRoot,
          plugin: root.plugin,
          allowedTools: parsed.allowedTools,
          argumentNames: parsed.argumentNames,
          argumentHint: parsed.argumentHint,
          command: false,
          disableModelInvocation: parsed.disableModelInvocation,
          effort: parsed.effort,
          model: parsed.model,
          shell: parsed.shell,
          userInvocable: parsed.userInvocable,
          executionContext: parsed.executionContext,
          agent: parsed.agent,
          hooks: hooksPluginOnly && root.source !== "policy" && root.source !== "plugin"
            ? undefined
            : withSkillRoot(parsed.hooks, path.dirname(realFile)),
        });
      } catch {
        // Invalid, oversized and escaping skill files are not discoverable.
      }
    }
  }
  return records;
}

async function discoverMarkdownCommands(root: {
  directory: string;
  source: ProjectSkillRecord["source"];
  rootId?: string;
  rootDisplayName?: string;
  primary?: boolean;
  pluginName?: string;
  pluginRoot?: string;
  pluginDataRoot?: string;
  plugin?: EnabledProjectPlugin;
}, hooksPluginOnly = false) {
  const stat = await fs.stat(root.directory).catch(() => null);
  if (!stat) return [];
  const baseDirectory = stat.isFile() ? path.dirname(root.directory) : root.directory;
  const candidates = stat.isFile()
    ? [root.directory]
    : await walkMarkdownFiles(root.directory, 8, 500);
  const records: ProjectSkillRecord[] = [];
  for (const candidate of candidates) {
    try {
      const realBase = await fs.realpath(baseDirectory);
      const realFile = await fs.realpath(candidate);
      if (!isInside(realBase, realFile)) continue;
      const raw = await readBoundedSkill(realFile);
      const parsed = parseSkillMarkdown(raw);
      // realpath can expand Windows 8.3 path segments (for example ADMINI~1),
      // so both sides of the relative calculation must use canonical paths.
      const relative = path.relative(realBase, realFile);
      const baseName = path.basename(realFile).toLowerCase() === "skill.md"
        ? path.basename(path.dirname(realFile))
        : path.basename(realFile, path.extname(realFile));
      const namespaceParts = path.dirname(relative) === "."
        ? []
        : path.dirname(relative).split(path.sep).filter(Boolean);
      if (path.basename(realFile).toLowerCase() === "skill.md") namespaceParts.pop();
      const commandName = [...(root.pluginName ? [root.pluginName] : []), ...namespaceParts, baseName].join(":");
      assertSkillName(commandName);
      records.push({
        name: commandName,
        description: parsed.description || firstUsefulLine(parsed.body) || "提示命令",
        source: root.source,
        rootId: root.rootId,
        rootDisplayName: root.rootDisplayName,
        primary: root.primary,
        directory: path.dirname(realFile),
        filePath: realFile,
        raw,
        pluginRoot: root.pluginRoot,
        pluginDataRoot: root.pluginDataRoot,
        plugin: root.plugin,
        allowedTools: parsed.allowedTools,
        argumentNames: parsed.argumentNames,
        argumentHint: parsed.argumentHint,
        command: true,
        disableModelInvocation: parsed.disableModelInvocation,
        effort: parsed.effort,
        model: parsed.model,
        shell: parsed.shell,
        userInvocable: parsed.userInvocable,
        executionContext: parsed.executionContext,
        agent: parsed.agent,
        hooks: hooksPluginOnly && root.source !== "policy" && root.source !== "plugin"
          ? undefined
          : withSkillRoot(parsed.hooks, path.dirname(realFile)),
      });
    } catch {
      // Invalid, oversized and escaping command files are not discoverable.
    }
  }
  return records;
}

async function walkMarkdownFiles(directory: string, maxDepth: number, maxFiles: number) {
  const files: string[] = [];
  const visit = async (current: string, depth: number): Promise<void> => {
    if (depth > maxDepth || files.length >= maxFiles) return;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    const hasSkill = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "skill.md");
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const target = path.join(current, entry.name);
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") files.push(target);
      else if (entry.isDirectory() && !hasSkill) await visit(target, depth + 1);
    }
  };
  await visit(directory, 0);
  return files;
}

async function readBoundedSkill(filePath: string) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new Error("技能文件不可读取或超过 100 KB 限制");
  return fs.readFile(filePath, "utf8");
}

function parseSkillMarkdown(value: string) {
  const normalized = value.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return emptyParsedSkill(normalized.trim());
  const parsed = parseYaml(match[1], { json: true });
  const fields = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
  const effort = stringField(fields, "effort");
  return {
    name: stringField(fields, "name"),
    description: stringField(fields, "description"),
    body: normalized.slice(match[0].length).trim(),
    allowedTools: stringListField(fields, "allowed-tools", "allowedTools"),
    argumentHint: stringField(fields, "argument-hint", "argumentHint") || undefined,
    disableModelInvocation: booleanField(fields, "disable-model-invocation", "disableModelInvocation"),
    userInvocable: booleanField(fields, "user-invocable", "userInvocable"),
    executionContext: stringField(fields, "context") === "fork" ? "fork" as const : undefined,
    agent: stringField(fields, "agent") || undefined,
    argumentNames: argumentNamesField(fields, "arguments"),
    model: normalizeSkillModel(stringField(fields, "model")),
    shell: normalizeSkillShell(stringField(fields, "shell")),
    effort: ["low", "medium", "high", "xhigh"].includes(effort)
      ? effort as ProjectSkillRecord["effort"]
      : undefined,
    hooks: normalizeProjectAgentHooks(fields.hooks),
  };
}

function emptyParsedSkill(body: string) {
  return {
    name: "",
    description: "",
    body,
    allowedTools: [] as string[],
    argumentNames: [] as string[],
    argumentHint: undefined,
    disableModelInvocation: undefined,
    userInvocable: undefined,
    executionContext: undefined,
    agent: undefined,
    model: undefined,
    shell: undefined,
    effort: undefined,
    hooks: undefined,
  };
}

function normalizeSkillShell(value: string): ProjectSkillRecord["shell"] {
  if (!value) return undefined;
  if (value === "bash" || value === "powershell") return value;
  throw new Error(`Skill shell 无效：${value}；仅支持 bash 或 powershell`);
}

function withSkillRoot(hooks: ProjectAgentHooks | undefined, skillRoot: string): ProjectAgentHooks | undefined {
  if (!hooks) return undefined;
  return Object.fromEntries(Object.entries(hooks).map(([event, matchers]) => [
    event,
    matchers?.map((matcher) => ({ ...matcher, skillRoot })),
  ])) as ProjectAgentHooks;
}

function stringField(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    if (typeof value === "string") return value.trim();
  }
  return "";
}

function stringListField(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields[key];
    const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
    if (entries.length) return entries.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function booleanField(fields: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (typeof fields[key] === "boolean") return fields[key] as boolean;
  return undefined;
}

function parseSlashCommandInput(value: string) {
  const match = value.trim().match(/^\/([A-Za-z0-9][A-Za-z0-9._-]*(?::[A-Za-z0-9][A-Za-z0-9._-]*){0,7})(?:\s+([\s\S]*))?$/);
  return match ? { name: match[1], args: match[2]?.trim() ?? "" } : null;
}

function substituteSkillArguments(content: string, args: string, argumentNames: string[] = []) {
  const parsed = parseQuotedArguments(args);
  const original = content;
  for (let index = 0; index < argumentNames.length; index += 1) {
    const name = argumentNames[index];
    content = content.replace(new RegExp(`\\$${escapeRegExp(name)}(?![\\[\\w])`, "g"), parsed[index] ?? "");
  }
  content = content
    .replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, index: string) => parsed[Number(index)] ?? "")
    .replace(/\$(\d+)(?!\w)/g, (_match, index: string) => parsed[Number(index)] ?? "")
    .replaceAll("${ARGUMENTS}", args)
    .replaceAll("$ARGUMENTS", args);
  return content === original && args ? `${content}\n\nARGUMENTS: ${args}` : content;
}

function argumentNamesField(fields: Record<string, unknown>, key: string) {
  const value = fields[key];
  const entries = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s+/) : [];
  return entries
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && !/^\d+$/.test(item));
}

function normalizeSkillModel(value: string) {
  return value && value.toLowerCase() !== "inherit" ? value : undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseQuotedArguments(value: string) {
  const result: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;
  for (const character of value.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (current) result.push(current);
  return result;
}

function firstUsefulLine(body: string) {
  return body.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
}

function assertSkillName(value: string) {
  const parts = value.split(":");
  if (parts.length > 8 || parts.some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(part))) {
    throw new Error("技能名称无效");
  }
  if (parts.length === 1) assertSafePathSegment(value, "skill name");
}

function normalizePromptPath(value: string) {
  return process.platform === "win32" ? value.replaceAll("\\", "/") : value;
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
