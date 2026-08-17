import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  normalizeProjectAgentHooks,
  type ProjectAgentHookEvent,
  type ProjectAgentHookMatcher,
  type ProjectAgentHooks,
} from "@/lib/agent/project-agent-hooks";
import { loadEnabledProjectPluginHooks } from "@/lib/agent/project-plugin-hooks";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability } from "@/lib/workspace/types";
import { getDefaultManagedSettingsDirectories } from "@/lib/agent/managed-settings";
import { isProjectCustomizationRestricted } from "@/lib/agent/project-customization-policy";

export { getDefaultManagedSettingsDirectories } from "@/lib/agent/managed-settings";

const MAX_HOOK_SETTINGS_BYTES = 1_048_576;

/**
 * Loads the same checked-in and local hook settings locations used by
 * cc-haha/Claude Code, plus Zenme-native equivalents. Later files are more
 * specific and their matcher lists run after the broader configuration.
 */
export async function loadProjectAgentHooks(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string; managedDirectories?: string[] } = {},
): Promise<ProjectAgentHooks | undefined> {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const homeDir = options.homeDir ?? os.homedir();
  const managedSettings = await loadFirstManagedHookSettings(
    options.managedDirectories ?? getDefaultManagedSettingsDirectories(),
  );
  const pluginOnly = await isProjectCustomizationRestricted(projectId, dataDir, "hooks", {
    managedDirectories: options.managedDirectories,
  });
  if (managedSettings.disableAllHooks) return undefined;
  const files = [
    { filePath: path.join(homeDir, ".claude", "settings.json"), scope: "user" as const },
    { filePath: path.join(homeDir, ".zenme", "settings.json"), scope: "user" as const },
    ...(binding && canUseWorkspaceCapability(binding, "read")
      ? [
          { filePath: path.join(binding.realPath, ".claude", "settings.json"), scope: "project" as const },
          { filePath: path.join(binding.realPath, ".zenme", "settings.json"), scope: "project" as const },
          { filePath: path.join(binding.realPath, ".claude", "settings.local.json"), scope: "local" as const },
          { filePath: path.join(binding.realPath, ".zenme", "settings.local.json"), scope: "local" as const },
        ]
      : []),
  ];
  const [settingsHooks, pluginHooks] = await Promise.all([
    Promise.all(files.map((source) => readHooksFromSettings(source.filePath))),
    loadEnabledProjectPluginHooks({
      homeDir,
      settingSources: files,
      ...(binding && canUseWorkspaceCapability(binding, "read") ? { workspacePath: binding.realPath } : {}),
    }),
  ]);
  const sources = managedSettings.allowManagedHooksOnly
    ? [managedSettings.hooks]
    : pluginOnly
      ? [managedSettings.hooks, pluginHooks]
      : [managedSettings.hooks, ...settingsHooks, pluginHooks];
  return mergeProjectAgentHooks(sources.filter((hooks): hooks is ProjectAgentHooks => Boolean(hooks)));
}

export function mergeProjectAgentHooks(sources: readonly ProjectAgentHooks[]) {
  const merged: ProjectAgentHooks = {};
  for (const source of sources) {
    for (const [event, matchers] of Object.entries(source) as Array<[
      ProjectAgentHookEvent,
      ProjectAgentHookMatcher[] | undefined,
    ]>) {
      if (!matchers?.length) continue;
      merged[event] = [...(merged[event] ?? []), ...matchers];
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

async function readHooksFromSettings(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_HOOK_SETTINGS_BYTES) return undefined;
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed)) return undefined;
    return normalizeProjectAgentHooks(parsed.hooks);
  } catch (error) {
    if (isMissingFileError(error) || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function loadFirstManagedHookSettings(directories: readonly string[]) {
  for (const directory of directories) {
    const settings = await readManagedHookSettings(directory);
    if (settings.found) return settings;
  }
  return {
    allowManagedHooksOnly: false,
    disableAllHooks: false,
    found: false,
    hooks: undefined as ProjectAgentHooks | undefined,
  };
}

async function readManagedHookSettings(directory: string) {
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
  const hookSources: ProjectAgentHooks[] = [];
  let allowManagedHooksOnly = false;
  let disableAllHooks = false;
  let found = false;
  for (const filePath of filePaths) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_HOOK_SETTINGS_BYTES) continue;
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (!isRecord(parsed)) continue;
      found ||= Object.keys(parsed).length > 0;
      if (typeof parsed.allowManagedHooksOnly === "boolean") allowManagedHooksOnly = parsed.allowManagedHooksOnly;
      if (typeof parsed.disableAllHooks === "boolean") disableAllHooks = parsed.disableAllHooks;
      const hooks = normalizeProjectAgentHooks(parsed.hooks);
      if (hooks) hookSources.push(hooks);
    } catch (error) {
      if (error instanceof SyntaxError || isMissingOrUnreadableFileError(error)) continue;
      throw error;
    }
  }
  return {
    allowManagedHooksOnly,
    disableAllHooks,
    found,
    hooks: mergeProjectAgentHooks(hookSources),
  };
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
