import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import type { ProjectAgentHooks } from "@/lib/agent/project-agent-hooks";
import { getDefaultManagedSettingsDirectories, loadProjectAgentHooks } from "@/lib/agent/project-hook-config";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability } from "@/lib/workspace/types";
import { loadEnabledPluginsForProject, pluginComponentPaths } from "@/lib/agent/project-plugin-hooks";
import {
  clearProjectConfigGeneration,
  resetProjectConfigGenerationsForTests,
  setProjectConfigGeneration,
} from "@/lib/agent/project-config-generation";
import { disposeProjectPluginLspClients } from "@/lib/agent/project-plugin-lsp";

export { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";

export type ProjectConfigChangeSource =
  | "user_settings"
  | "project_settings"
  | "local_settings"
  | "policy_settings"
  | "skills";

export type ProjectConfigChangeEvent = {
  filePath: string;
  source: ProjectConfigChangeSource;
};

type RuntimeContext = {
  onConfigChange: (event: ProjectConfigChangeEvent, acceptedHooks: ProjectAgentHooks | undefined) => Promise<{ blocked: boolean }>;
};

type RuntimeEntry = {
  acceptedHooks?: ProjectAgentHooks;
  context: RuntimeContext;
  homeDir: string;
  managedDirectories: string[];
  processing: Promise<void>;
  projectId: string;
  ready: Promise<void>;
  dataDir: string;
  generation: number;
  targets: ProjectConfigTarget[];
  watcher: FSWatcher;
};

type ProjectConfigTarget = {
  filePath: string;
  source: ProjectConfigChangeSource;
  tree: boolean;
};

type ProjectConfigRuntime = {
  entries: Map<string, Promise<RuntimeEntry>>;
};

const globalRuntime = globalThis as typeof globalThis & { __zenmeProjectConfigRuntime?: ProjectConfigRuntime };
const runtime = globalRuntime.__zenmeProjectConfigRuntime ?? { entries: new Map() };
globalRuntime.__zenmeProjectConfigRuntime = runtime;
const suppressedWatcherPaths = new Map<string, number>();

export async function resolveProjectAgentHooksWithConfigChangeRuntime(input: {
  acceptedCandidate?: ProjectAgentHooks;
  dataDir: string;
  homeDir?: string;
  managedDirectories?: string[];
  onConfigChange: RuntimeContext["onConfigChange"];
  projectId: string;
  watchChanges?: boolean;
  waitUntilReady?: boolean;
}) {
  if (input.watchChanges === false) {
    setProjectConfigGeneration(input.projectId, input.dataDir, 0);
    return input.acceptedCandidate;
  }
  const key = runtimeKey(input.dataDir, input.projectId);
  let pending = runtime.entries.get(key);
  if (!pending) {
    pending = createEntry({
      acceptedHooks: input.acceptedCandidate,
      context: { onConfigChange: input.onConfigChange },
      dataDir: input.dataDir,
      homeDir: input.homeDir ?? os.homedir(),
      managedDirectories: input.managedDirectories ?? getDefaultManagedSettingsDirectories(),
      projectId: input.projectId,
    }).catch((error) => {
      runtime.entries.delete(key);
      throw error;
    });
    runtime.entries.set(key, pending);
  }
  const entry = await pending;
  entry.context = { onConfigChange: input.onConfigChange };
  if (input.waitUntilReady) await entry.ready;
  return entry.acceptedHooks;
}

export async function closeProjectConfigChangeRuntime(projectId: string, dataDir: string) {
  const key = runtimeKey(dataDir, projectId);
  const pending = runtime.entries.get(key);
  runtime.entries.delete(key);
  const entry = await pending?.catch(() => null);
  await entry?.watcher.close();
  disposeProjectPluginLspClients(projectId, dataDir);
  clearProjectConfigGeneration(projectId, dataDir);
}

export async function notifyProjectConfigFileChanged(filePath: string) {
  const entries = await Promise.all([...runtime.entries.values()].map((pending) => pending.catch(() => null)));
  await Promise.all(entries.flatMap((entry) => {
    if (!entry) return [];
    const event = matchTarget(entry.targets, filePath);
    if (!event) return [];
    suppressedWatcherPaths.set(suppressionKey(entry, filePath), Date.now() + 3_000);
    entry.processing = entry.processing.then(() => processConfigChange(entry, event)).catch(() => undefined);
    return [entry.processing];
  }));
}

export async function resetProjectConfigChangeRuntimeForTests() {
  const entries = [...runtime.entries.values()];
  runtime.entries.clear();
  suppressedWatcherPaths.clear();
  await Promise.all(entries.map(async (pending) => (await pending.catch(() => null))?.watcher.close()));
  resetProjectConfigGenerationsForTests();
}

async function createEntry(input: {
  acceptedHooks?: ProjectAgentHooks;
  context: RuntimeContext;
  dataDir: string;
  homeDir: string;
  managedDirectories: string[];
  projectId: string;
}): Promise<RuntimeEntry> {
  const targets = await projectConfigTargets(input.projectId, input.dataDir, input.homeDir, input.managedDirectories);
  const roots = await existingWatchRoots(targets);
  const watcher = chokidar.watch(roots, {
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    // Match cc-haha's native watcher boundary. Nested roots are collapsed
    // before registration because libuv's Windows watcher cannot safely own
    // the same tree twice. Three levels cover skills/<name>/SKILL.md.
    depth: 3,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    persistent: true,
    usePolling: false,
  });
  const ready = new Promise<void>((resolve) => watcher.once("ready", resolve));
  watcher.on("error", () => undefined);
  const entry: RuntimeEntry = {
    acceptedHooks: input.acceptedHooks,
    context: input.context,
    dataDir: input.dataDir,
    generation: 0,
    homeDir: input.homeDir,
    managedDirectories: input.managedDirectories,
    processing: Promise.resolve(),
    projectId: input.projectId,
    ready,
    targets,
    watcher,
  };
  const schedule = (filePath: string) => {
    const key = suppressionKey(entry, filePath);
    const suppressUntil = suppressedWatcherPaths.get(key) ?? 0;
    if (suppressUntil >= Date.now()) {
      suppressedWatcherPaths.delete(key);
      return;
    }
    if (suppressUntil) suppressedWatcherPaths.delete(key);
    const event = matchTarget(entry.targets, filePath);
    if (!event) return;
    entry.processing = entry.processing.then(() => processConfigChange(entry, event)).catch(() => undefined);
  };
  watcher.on("add", schedule);
  watcher.on("change", schedule);
  watcher.on("unlink", schedule);
  setProjectConfigGeneration(input.projectId, input.dataDir, 0);
  return entry;
}

async function existingWatchRoots(targets: ProjectConfigTarget[]) {
  const roots = await Promise.all(targets.map(async (target) => {
    const candidate = target.tree ? target.filePath : path.dirname(target.filePath);
    const stats = await fs.stat(candidate).catch(() => null);
    if (stats?.isDirectory()) return fs.realpath(candidate).catch(() => path.resolve(candidate));
    if (!target.tree) return null;
    const parent = path.dirname(candidate);
    const parentStats = await fs.stat(parent).catch(() => null);
    return parentStats?.isDirectory()
      ? fs.realpath(parent).catch(() => path.resolve(parent))
      : null;
  }));
  return collapseNestedWatchRoots([...new Set(roots.filter((root): root is string => Boolean(root)))]);
}

function collapseNestedWatchRoots(roots: string[]) {
  const sorted = roots.map((root) => path.resolve(root)).sort((left, right) => left.length - right.length);
  return sorted.filter((candidate, index) => !sorted.slice(0, index).some((parent) => isInside(parent, candidate)));
}

async function processConfigChange(entry: RuntimeEntry, event: ProjectConfigChangeEvent) {
  const outcome = await entry.context.onConfigChange(event, entry.acceptedHooks);
  if (outcome.blocked) return;
  entry.acceptedHooks = await loadProjectAgentHooks(entry.projectId, entry.dataDir, {
    homeDir: entry.homeDir,
    managedDirectories: entry.managedDirectories,
  });
  entry.generation += 1;
  disposeProjectPluginLspClients(entry.projectId, entry.dataDir);
  setProjectConfigGeneration(entry.projectId, entry.dataDir, entry.generation);
  entry.targets = await projectConfigTargets(entry.projectId, entry.dataDir, entry.homeDir, entry.managedDirectories);
  entry.watcher.add(await existingWatchRoots(entry.targets));
}

async function projectConfigTargets(
  projectId: string,
  dataDir: string,
  homeDir: string,
  managedDirectories: readonly string[],
): Promise<ProjectConfigTarget[]> {
  const targets: ProjectConfigTarget[] = [
    { filePath: path.join(homeDir, ".claude", "settings.json"), source: "user_settings", tree: false },
    { filePath: path.join(homeDir, ".zenme", "settings.json"), source: "user_settings", tree: false },
    { filePath: path.join(homeDir, ".claude", ".credentials.json"), source: "user_settings", tree: false },
    { filePath: path.join(homeDir, ".zenme", ".credentials.json"), source: "user_settings", tree: false },
    { filePath: path.join(dataDir, "plugin-credentials.json"), source: "user_settings", tree: false },
    { filePath: path.join(homeDir, ".claude", "skills"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".zenme", "skills"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".claude", "commands"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".zenme", "commands"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".claude", "agents"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".zenme", "agents"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".claude", "output-styles"), source: "skills", tree: true },
    { filePath: path.join(homeDir, ".zenme", "output-styles"), source: "skills", tree: true },
    ...managedDirectories.flatMap((directory) => [
      { filePath: path.join(directory, "managed-settings.json"), source: "policy_settings" as const, tree: false },
      { filePath: path.join(directory, "managed-settings.d"), source: "policy_settings" as const, tree: true },
      { filePath: path.join(directory, ".claude", "skills"), source: "policy_settings" as const, tree: true },
      { filePath: path.join(directory, ".claude", "commands"), source: "policy_settings" as const, tree: true },
      { filePath: path.join(directory, ".claude", "agents"), source: "policy_settings" as const, tree: true },
      { filePath: path.join(directory, ".claude", "output-styles"), source: "policy_settings" as const, tree: true },
    ]),
  ];
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  if (binding && canUseWorkspaceCapability(binding, "read")) targets.push(
    { filePath: path.join(binding.realPath, ".claude", "settings.json"), source: "project_settings", tree: false },
    { filePath: path.join(binding.realPath, ".zenme", "settings.json"), source: "project_settings", tree: false },
    { filePath: path.join(binding.realPath, ".claude", "settings.local.json"), source: "local_settings", tree: false },
    { filePath: path.join(binding.realPath, ".zenme", "settings.local.json"), source: "local_settings", tree: false },
    { filePath: path.join(binding.realPath, ".claude", "skills"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".zenme", "skills"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".claude", "commands"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".zenme", "commands"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".claude", "agents"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".zenme", "agents"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".claude", "output-styles"), source: "skills", tree: true },
    { filePath: path.join(binding.realPath, ".zenme", "output-styles"), source: "skills", tree: true },
  );
  for (const plugin of await loadEnabledPluginsForProject(projectId, dataDir, { homeDir })) {
    for (const component of ["skills", "commands", "agents", "outputStyles"] as const) {
      for (const filePath of pluginComponentPaths(plugin, component)) targets.push({ filePath, source: "skills", tree: true });
    }
    targets.push(
      { filePath: path.join(plugin.root, ".claude-plugin", "plugin.json"), source: "skills", tree: false },
      { filePath: path.join(plugin.root, ".mcp.json"), source: "skills", tree: false },
      { filePath: path.join(plugin.root, ".lsp.json"), source: "skills", tree: false },
    );
    for (const field of ["mcpServers", "lspServers", "hooks"] as const) {
      const declarations = plugin.manifest?.[field];
      for (const declaration of Array.isArray(declarations) ? declarations : declarations === undefined ? [] : [declarations]) {
        if (typeof declaration !== "string") continue;
        const filePath = path.resolve(plugin.root, declaration);
        if (isInside(plugin.root, filePath)) targets.push({ filePath, source: "skills", tree: false });
      }
    }
  }
  return targets;
}

function matchTarget(targets: ProjectConfigTarget[], filePath: string): ProjectConfigChangeEvent | null {
  const resolved = normalizePath(filePath);
  const target = targets.find((candidate) => {
    const expected = normalizePath(candidate.filePath);
    return candidate.tree ? resolved === expected || resolved.startsWith(`${expected}${path.sep}`) : resolved === expected;
  });
  return target ? { filePath: path.resolve(filePath), source: target.source } : null;
}

function normalizePath(value: string) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}

function isInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function runtimeKey(dataDir: string, projectId: string) {
  return `${dataDir}\u0000${projectId}`;
}

function suppressionKey(entry: Pick<RuntimeEntry, "dataDir" | "projectId">, filePath: string) {
  return `${runtimeKey(entry.dataDir, entry.projectId)}\u0000${normalizePath(filePath)}`;
}
