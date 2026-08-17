import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { normalizeProjectAgentHooks, type ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import { normalizeProjectAgentMcpServers, type ProjectAgentMcpServerSpec } from "@/lib/agent/project-agent-mcp";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability } from "@/lib/workspace/types";
import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import { loadPluginOptionsFromFiles, loadProjectPluginOptions, substitutePluginUserConfigRuntime, type ProjectPluginOptions } from "@/lib/agent/project-plugin-options";
import { isProjectPluginMcpbSource, loadProjectPluginMcpbServer } from "@/lib/agent/project-plugin-mcpb";

const MAX_PLUGIN_FILE_BYTES = 1_048_576;
const MAX_INSTALLED_PLUGINS_BYTES = 5_242_880;
const MAX_ENABLED_PLUGINS = 50;
const enabledPluginCache = new Map<string, Promise<EnabledProjectPlugin[]>>();
const pluginMcpCache = new Map<string, Promise<ProjectPluginMcpLoadResult>>();

type PluginScope = "managed" | "user" | "project" | "local";

export type PluginSettingSource = {
  filePath: string;
  scope: PluginScope;
};

export type EnabledProjectPlugin = {
  id: string;
  name: string;
  root: string;
  dataRoot: string;
  manifest?: Record<string, unknown>;
};

export type ProjectPluginMcpLoadFailure = {
  pluginId: string;
  pluginName: string;
  source: string;
  error: string;
};

export type ProjectPluginMcpLoadResult = {
  servers: ProjectAgentMcpServerSpec[];
  failures: ProjectPluginMcpLoadFailure[];
};

export function pluginComponentPaths(plugin: EnabledProjectPlugin, component: "skills" | "agents" | "commands" | "outputStyles") {
  const defaults = [path.join(plugin.root, component === "outputStyles" ? "output-styles" : component)];
  const declared = plugin.manifest?.[component];
  const values = Array.isArray(declared) ? declared : declared === undefined ? [] : [declared];
  const custom = values.flatMap((value) => {
    if (typeof value !== "string" || !value.trim()) return [];
    const target = path.resolve(plugin.root, value);
    return isInside(plugin.root, target) ? [target] : [];
  });
  return [...new Set([...defaults, ...custom])];
}

export async function loadProjectPluginMcpServers(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string } = {},
): Promise<ProjectAgentMcpServerSpec[]> {
  return (await loadProjectPluginMcpServersWithFailures(projectId, dataDir, options)).servers;
}

export async function loadProjectPluginMcpServersWithFailures(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string } = {},
): Promise<ProjectPluginMcpLoadResult> {
  const generation = getProjectConfigGeneration(projectId, dataDir);
  if (generation !== undefined) {
    const key = cacheKey(projectId, dataDir, options.homeDir, generation);
    const cached = pluginMcpCache.get(key);
    if (cached) return cached;
    const pending = loadProjectPluginMcpServersUncached(projectId, dataDir, options).catch((error) => {
      pluginMcpCache.delete(key);
      throw error;
    });
    pluginMcpCache.set(key, pending);
    pruneCache(pluginMcpCache);
    return pending;
  }
  return loadProjectPluginMcpServersUncached(projectId, dataDir, options);
}

async function loadProjectPluginMcpServersUncached(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string } = {},
): Promise<ProjectPluginMcpLoadResult> {
  const result: ProjectAgentMcpServerSpec[] = [];
  const failures: ProjectPluginMcpLoadFailure[] = [];
  for (const plugin of await loadEnabledPluginsForProject(projectId, dataDir, options)) {
    const pluginOptions = await loadProjectPluginOptions(projectId, dataDir, plugin, options);
    const sources: unknown[] = [];
    const bundledServers: Array<{ name: string; config: unknown }> = [];
    const defaultConfig = await readBoundedJson(path.join(plugin.root, ".mcp.json"), MAX_PLUGIN_FILE_BYTES);
    if (defaultConfig !== undefined) sources.push(defaultConfig);
    const declarations = plugin.manifest?.mcpServers;
    for (const declaration of Array.isArray(declarations) ? declarations : declarations === undefined ? [] : [declarations]) {
      if (typeof declaration === "string") {
        if (isProjectPluginMcpbSource(declaration)) {
          try {
            bundledServers.push(await loadProjectPluginMcpbServer({
              projectId,
              dataDir,
              plugin,
              source: declaration,
              homeDir: options.homeDir,
            }));
          } catch (error) {
            failures.push({
              pluginId: plugin.id,
              pluginName: plugin.name,
              source: declaration,
              error: safeMessage(error),
            });
          }
          continue;
        }
        const target = path.resolve(plugin.root, declaration);
        if (isInside(plugin.root, target)) {
          const parsed = await readBoundedJson(target, MAX_PLUGIN_FILE_BYTES);
          if (parsed !== undefined) sources.push(parsed);
        }
      } else {
        sources.push(declaration);
      }
    }
    const merged = new Map<string, unknown>();
    for (const source of sources) {
      const record = isRecord(source) && isRecord(source.mcpServers) ? source.mcpServers : source;
      if (!isRecord(record)) continue;
      for (const [name, config] of Object.entries(record)) merged.set(name, config);
    }
    for (const [name, rawConfig] of merged) {
      const qualifiedName = `${plugin.name}-${name}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
      const config = substitutePluginValues(rawConfig, plugin, pluginOptions);
      const [normalized] = normalizeProjectAgentMcpServers([{ [qualifiedName]: config }]) ?? [];
      if (normalized) result.push(normalized);
    }
    for (const bundled of bundledServers) {
      const qualifiedName = `${plugin.name}-${bundled.name}`.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 128);
      const [normalized] = normalizeProjectAgentMcpServers([{ [qualifiedName]: bundled.config }]) ?? [];
      if (normalized) result.push(normalized);
    }
  }
  return { servers: result.slice(0, 50), failures };
}

function substitutePluginValues(value: unknown, plugin: EnabledProjectPlugin, options: ProjectPluginOptions): unknown {
  if (typeof value === "string") {
    return substitutePluginUserConfigRuntime(value
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", plugin.root)
      .replaceAll("${CLAUDE_PLUGIN_DATA}", plugin.dataRoot), options);
  }
  if (Array.isArray(value)) return value.map((item) => substitutePluginValues(item, plugin, options));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substitutePluginValues(item, plugin, options)]));
  return value;
}

type PluginInstallation = {
  installPath: string;
  projectPath?: string;
  scope: PluginScope;
};

/**
 * Mirrors cc-haha's trust chain for Hook plugins: settings explicitly enable a
 * plugin id, installed_plugins.json supplies its managed cache path, and only
 * that plugin's declared Hook files are loaded. No arbitrary directory scan is
 * performed.
 */
export async function loadEnabledProjectPluginHooks(input: {
  homeDir: string;
  settingSources: readonly PluginSettingSource[];
  workspacePath?: string;
}): Promise<ProjectAgentHooks | undefined> {
  const plugins = await loadEnabledProjectPlugins(input);
  const pluginSources: ProjectAgentHooks[] = [];
  for (const plugin of plugins) {
    const pluginOptions = await loadPluginOptionsFromFiles(
      plugin,
      input.settingSources.map((source) => source.filePath),
      [path.join(input.homeDir, ".claude", ".credentials.json"), path.join(input.homeDir, ".zenme", ".credentials.json")],
    );
    const sources = await readPluginHookSources(plugin.root, plugin.manifest);
    for (const source of sources) {
      pluginSources.push(Object.fromEntries(Object.entries(source).map(([event, matchers]) => [
        event,
        matchers?.map((matcher) => ({
          ...matcher,
          pluginRoot: plugin.root,
          pluginId: plugin.id,
          pluginDataRoot: plugin.dataRoot,
          pluginOptions,
        })),
      ])) as ProjectAgentHooks);
    }
  }
  return mergeHooks(pluginSources);
}

export async function loadEnabledProjectPlugins(input: {
  homeDir: string;
  settingSources: readonly PluginSettingSource[];
  workspacePath?: string;
}): Promise<EnabledProjectPlugin[]> {
  const enabled = await readEnabledPlugins(input.settingSources);
  if (!enabled.size) return [];
  const pluginsDir = path.join(input.homeDir, ".claude", "plugins");
  const installed = await readInstalledPlugins(path.join(pluginsDir, "installed_plugins.json"));
  const result: EnabledProjectPlugin[] = [];
  for (const [pluginId, sourceScope] of [...enabled].slice(0, MAX_ENABLED_PLUGINS)) {
    const candidates = installed.get(pluginId) ?? [];
    const installation = await selectInstallation(candidates, sourceScope, input.workspacePath);
    if (!installation) continue;
    const pluginRoot = await trustedPluginRoot(pluginsDir, installation.installPath);
    if (!pluginRoot) continue;
    const pluginDataRoot = path.join(pluginsDir, "data", pluginId.replace(/[^A-Za-z0-9_-]/g, "-"));
    const manifest = await readBoundedJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"), MAX_PLUGIN_FILE_BYTES);
    const manifestRecord = isRecord(manifest) ? manifest : undefined;
    const manifestName = manifestRecord && typeof manifestRecord.name === "string" ? manifestRecord.name.trim() : "";
    const fallbackName = pluginId.split("@")[0];
    const name = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(manifestName) ? manifestName : fallbackName;
    result.push({ id: pluginId, name, root: pluginRoot, dataRoot: pluginDataRoot, manifest: manifestRecord });
  }
  return result;
}

export async function loadEnabledPluginsForProject(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string } = {},
) {
  const generation = getProjectConfigGeneration(projectId, dataDir);
  if (generation !== undefined) {
    const key = cacheKey(projectId, dataDir, options.homeDir, generation);
    const cached = enabledPluginCache.get(key);
    if (cached) return cached;
    const pending = loadEnabledPluginsForProjectUncached(projectId, dataDir, options).catch((error) => {
      enabledPluginCache.delete(key);
      throw error;
    });
    enabledPluginCache.set(key, pending);
    pruneCache(enabledPluginCache);
    return pending;
  }
  return loadEnabledPluginsForProjectUncached(projectId, dataDir, options);
}

async function loadEnabledPluginsForProjectUncached(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string } = {},
) {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const homeDir = options.homeDir ?? os.homedir();
  const settingSources: PluginSettingSource[] = [
    { filePath: path.join(homeDir, ".claude", "settings.json"), scope: "user" },
    { filePath: path.join(homeDir, ".zenme", "settings.json"), scope: "user" },
    ...(binding && canUseWorkspaceCapability(binding, "read") ? [
      { filePath: path.join(binding.realPath, ".claude", "settings.json"), scope: "project" as const },
      { filePath: path.join(binding.realPath, ".zenme", "settings.json"), scope: "project" as const },
      { filePath: path.join(binding.realPath, ".claude", "settings.local.json"), scope: "local" as const },
      { filePath: path.join(binding.realPath, ".zenme", "settings.local.json"), scope: "local" as const },
    ] : []),
  ];
  return loadEnabledProjectPlugins({
    homeDir,
    settingSources,
    ...(binding && canUseWorkspaceCapability(binding, "read") ? { workspacePath: binding.realPath } : {}),
  });
}

function cacheKey(projectId: string, dataDir: string, homeDir: string | undefined, generation: number) {
  return JSON.stringify([path.resolve(dataDir), projectId, homeDir ?? "", generation]);
}

function pruneCache(cache: Map<string, unknown>) {
  while (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

async function readEnabledPlugins(sources: readonly PluginSettingSource[]) {
  const enabled = new Map<string, PluginScope>();
  for (const source of sources) {
    const settings = await readBoundedJson(source.filePath, MAX_PLUGIN_FILE_BYTES);
    if (!isRecord(settings) || !isRecord(settings.enabledPlugins)) continue;
    for (const [pluginId, value] of Object.entries(settings.enabledPlugins)) {
      if (!isPluginId(pluginId) || (value !== true && value !== false && !Array.isArray(value))) continue;
      if (value === true || Array.isArray(value)) enabled.set(pluginId, source.scope);
      else enabled.delete(pluginId);
    }
  }
  return enabled;
}

async function readInstalledPlugins(filePath: string) {
  const parsed = await readBoundedJson(filePath, MAX_INSTALLED_PLUGINS_BYTES);
  const result = new Map<string, PluginInstallation[]>();
  if (!isRecord(parsed) || parsed.version !== 2 || !isRecord(parsed.plugins)) return result;
  for (const [pluginId, rawEntries] of Object.entries(parsed.plugins)) {
    if (!isPluginId(pluginId) || !Array.isArray(rawEntries)) continue;
    const entries = rawEntries.flatMap((entry): PluginInstallation[] => {
      if (!isRecord(entry) || !isPluginScope(entry.scope) || typeof entry.installPath !== "string" || !path.isAbsolute(entry.installPath)) return [];
      return [{
        scope: entry.scope,
        installPath: entry.installPath,
        ...(typeof entry.projectPath === "string" ? { projectPath: entry.projectPath } : {}),
      }];
    });
    if (entries.length) result.set(pluginId, entries);
  }
  return result;
}

async function selectInstallation(entries: PluginInstallation[], scope: PluginScope, workspacePath?: string) {
  const workspace = workspacePath ? await fs.realpath(workspacePath).catch(() => path.resolve(workspacePath)) : undefined;
  const exact = entries.find((entry) => entry.scope === scope && (
    scope === "user" || scope === "managed" ||
    Boolean(workspace && entry.projectPath && samePath(path.resolve(entry.projectPath), workspace))
  ));
  if (exact) return exact;
  return entries.find((entry) => entry.scope === "user" || entry.scope === "managed");
}

async function trustedPluginRoot(pluginsDir: string, installPath: string) {
  const [realPluginsDir, realInstallPath] = await Promise.all([
    fs.realpath(pluginsDir).catch(() => null),
    fs.realpath(installPath).catch(() => null),
  ]);
  if (!realPluginsDir || !realInstallPath || !isInside(realPluginsDir, realInstallPath)) return null;
  const stat = await fs.stat(realInstallPath).catch(() => null);
  return stat?.isDirectory() ? realInstallPath : null;
}

async function readPluginHookSources(pluginRoot: string, knownManifest?: Record<string, unknown>) {
  const sources: ProjectAgentHooks[] = [];
  const loaded = new Set<string>();
  await addHookFile(path.join(pluginRoot, "hooks", "hooks.json"), sources, loaded);
  const manifest = knownManifest ?? await readBoundedJson(path.join(pluginRoot, ".claude-plugin", "plugin.json"), MAX_PLUGIN_FILE_BYTES);
  if (!isRecord(manifest) || manifest.hooks === undefined) return sources;
  const declarations = Array.isArray(manifest.hooks) ? manifest.hooks : [manifest.hooks];
  for (const declaration of declarations.slice(0, 20)) {
    if (typeof declaration === "string") {
      const target = path.resolve(pluginRoot, declaration);
      if (isInside(pluginRoot, target)) await addHookFile(target, sources, loaded);
      continue;
    }
    const normalized = normalizeProjectAgentHooks(declaration);
    if (normalized) sources.push(normalized);
  }
  return sources;
}

async function addHookFile(filePath: string, sources: ProjectAgentHooks[], loaded: Set<string>) {
  const realPath = await fs.realpath(filePath).catch(() => null);
  if (!realPath || loaded.has(realPath)) return;
  const parsed = await readBoundedJson(realPath, MAX_PLUGIN_FILE_BYTES);
  if (!isRecord(parsed)) return;
  const normalized = normalizeProjectAgentHooks(parsed.hooks);
  if (!normalized) return;
  loaded.add(realPath);
  sources.push(normalized);
}

async function readBoundedJson(filePath: string, maxBytes: number): Promise<unknown> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError || isMissingFileError(error)) return undefined;
    throw error;
  }
}

function mergeHooks(sources: readonly ProjectAgentHooks[]) {
  const merged: ProjectAgentHooks = {};
  for (const source of sources) {
    for (const [event, matchers] of Object.entries(source)) {
      if (!matchers?.length) continue;
      const key = event as keyof ProjectAgentHooks;
      merged[key] = [...(merged[key] ?? []), ...matchers];
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function isPluginId(value: string) { return /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(value); }
function isPluginScope(value: unknown): value is PluginScope { return value === "managed" || value === "user" || value === "project" || value === "local"; }
function samePath(left: string, right: string) { return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right; }
function isInside(root: string, target: string) { const relative = path.relative(root, target); return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function isMissingFileError(error: unknown) { return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"); }
function safeMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
