import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { load as parseYaml } from "js-yaml";

import { loadEnabledPluginsForProject, pluginComponentPaths } from "@/lib/agent/project-plugin-hooks";
import { loadProjectPluginOptions, substitutePluginUserConfigInContent } from "@/lib/agent/project-plugin-options";
import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import { getDefaultManagedSettingsDirectories, managedComponentDirectories } from "@/lib/agent/managed-settings";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability } from "@/lib/workspace/types";

const MAX_STYLE_BYTES = 100_000;
const activeStyleCache = new Map<string, Promise<ProjectOutputStyle | null>>();

export type ProjectOutputStyle = {
  description: string;
  keepCodingInstructions?: boolean;
  name: string;
  prompt: string;
  source: "policy" | "user" | "project" | "local" | "plugin";
  forceForPlugin?: boolean;
};

export async function loadActiveProjectOutputStyle(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string; managedDirectories?: string[] } = {},
): Promise<ProjectOutputStyle | null> {
  const generation = await getProjectConfigGeneration(projectId, dataDir);
  if (generation !== undefined) {
    const key = JSON.stringify([path.resolve(dataDir), projectId, options.homeDir ?? "", options.managedDirectories ?? [], generation]);
    const cached = activeStyleCache.get(key);
    if (cached) return cached;
    const pending = loadActiveProjectOutputStyleUncached(projectId, dataDir, options).catch((error) => {
      activeStyleCache.delete(key);
      throw error;
    });
    activeStyleCache.set(key, pending);
    while (activeStyleCache.size > 200) {
      const oldest = activeStyleCache.keys().next().value;
      if (typeof oldest !== "string") break;
      activeStyleCache.delete(oldest);
    }
    return pending;
  }
  return loadActiveProjectOutputStyleUncached(projectId, dataDir, options);
}

async function loadActiveProjectOutputStyleUncached(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string; managedDirectories?: string[] } = {},
): Promise<ProjectOutputStyle | null> {
  const homeDir = options.homeDir ?? os.homedir();
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const workspacePath = binding && canUseWorkspaceCapability(binding, "read") ? binding.realPath : undefined;
  const styles = new Map<string, ProjectOutputStyle>();
  for (const source of [
    { directory: path.join(homeDir, ".claude", "output-styles"), source: "user" as const },
    { directory: path.join(homeDir, ".zenme", "output-styles"), source: "user" as const },
    ...(workspacePath ? [
      { directory: path.join(workspacePath, ".claude", "output-styles"), source: "project" as const },
      { directory: path.join(workspacePath, ".zenme", "output-styles"), source: "project" as const },
    ] : []),
  ]) {
    for (const style of await loadStylesFromPath(source.directory, source.source)) styles.set(style.name, style);
  }
  for (const plugin of await loadEnabledPluginsForProject(projectId, dataDir, { homeDir })) {
    const pluginOptions = await loadProjectPluginOptions(projectId, dataDir, plugin, { homeDir });
    for (const candidate of pluginComponentPaths(plugin, "outputStyles")) {
      for (const style of await loadStylesFromPath(candidate, "plugin", (raw) => substitutePluginUserConfigInContent(raw, pluginOptions))) styles.set(style.name, style);
    }
  }
  const managedDirectories = options.managedDirectories ?? getDefaultManagedSettingsDirectories();
  for (const directory of managedComponentDirectories("output-styles", managedDirectories)) {
    for (const style of await loadStylesFromPath(directory, "policy")) styles.set(style.name, style);
  }
  const managedSelection = await selectedManagedOutputStyleName(managedDirectories);
  if (managedSelection.found) {
    return managedSelection.name && managedSelection.name !== "default"
      ? styles.get(managedSelection.name) ?? null
      : null;
  }
  const forced = [...styles.values()].find((style) => style.source === "plugin" && style.forceForPlugin);
  if (forced) return forced;
  const selectedName = await selectedOutputStyleName(homeDir, workspacePath);
  return selectedName && selectedName !== "default" ? styles.get(selectedName) ?? null : null;
}

async function selectedManagedOutputStyleName(directories: readonly string[]) {
  for (const directory of directories) {
    const files = [path.join(directory, "managed-settings.json")];
    const dropInDirectory = path.join(directory, "managed-settings.d");
    const entries = await fs.readdir(dropInDirectory, { withFileTypes: true }).catch(() => []);
    files.push(...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .map((entry) => path.join(dropInDirectory, entry.name))
      .sort((left, right) => left.localeCompare(right)));
    let found = false;
    let name: string | undefined;
    for (const filePath of files) {
      const value = await readJson(filePath);
      if (!value) continue;
      found ||= Object.keys(value).length > 0;
      if (typeof value.outputStyle === "string" && value.outputStyle.trim()) name = value.outputStyle.trim();
    }
    if (found) return { found, name };
  }
  return { found: false, name: undefined };
}

async function selectedOutputStyleName(homeDir: string, workspacePath?: string) {
  let selected: string | undefined;
  const settingsPaths = [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(homeDir, ".zenme", "settings.json"),
    ...(workspacePath ? [
      path.join(workspacePath, ".claude", "settings.json"),
      path.join(workspacePath, ".zenme", "settings.json"),
      path.join(workspacePath, ".claude", "settings.local.json"),
      path.join(workspacePath, ".zenme", "settings.local.json"),
    ] : []),
  ];
  for (const filePath of settingsPaths) {
    const value = await readJson(filePath);
    if (value && typeof value.outputStyle === "string" && value.outputStyle.trim()) selected = value.outputStyle.trim();
  }
  return selected;
}

async function loadStylesFromPath(target: string, source: ProjectOutputStyle["source"], transform: (raw: string) => string = (raw) => raw) {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return [];
  const files = stat.isFile()
    ? [target]
    : (await fs.readdir(target, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".md")
      .map((entry) => path.join(target, entry.name));
  const styles: ProjectOutputStyle[] = [];
  for (const filePath of files) {
    try {
      const fileStat = await fs.stat(filePath);
      if (!fileStat.isFile() || fileStat.size > MAX_STYLE_BYTES) continue;
      const parsed = parseMarkdown(transform(await fs.readFile(filePath, "utf8")));
      const fallbackName = path.basename(filePath, path.extname(filePath));
      const name = stringField(parsed.frontmatter.name) || fallbackName;
      if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/.test(name) || !parsed.body) continue;
      styles.push({
        name,
        description: stringField(parsed.frontmatter.description) || firstUsefulLine(parsed.body) || `Custom ${name} output style`,
        prompt: parsed.body,
        source,
        keepCodingInstructions: booleanField(parsed.frontmatter["keep-coding-instructions"]),
        forceForPlugin: source === "plugin" ? booleanField(parsed.frontmatter["force-for-plugin"]) : undefined,
      });
    } catch {
      // Invalid and oversized output styles are ignored independently.
    }
  }
  return styles;
}

function parseMarkdown(raw: string) {
  const normalized = raw.replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {} as Record<string, unknown>, body: normalized.trim() };
  const parsed = parseYaml(match[1], { json: true });
  return {
    frontmatter: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {},
    body: normalized.slice(match[0].length).trim(),
  };
}

async function readJson(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_STYLE_BYTES) return null;
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function stringField(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function booleanField(value: unknown) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}
function firstUsefulLine(value: string) {
  return value.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
}
