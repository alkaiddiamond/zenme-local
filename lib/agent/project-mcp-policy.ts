import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import { getDefaultManagedSettingsDirectories } from "@/lib/agent/managed-settings";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { resolveWorkspaceRoot } from "@/lib/workspace/types";

const MAX_SETTINGS_BYTES = 1_000_000;

export type ProjectMcpPolicyEntry =
  | { serverName: string }
  | { serverCommand: string[] }
  | { serverUrl: string };

export type ProjectMcpPolicy = {
  allowed?: ProjectMcpPolicyEntry[];
  denied?: ProjectMcpPolicyEntry[];
  allowManagedOnly: boolean;
};

export type ProjectMcpPolicyServer = {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
};

type SettingsLayer = {
  allowedDefined: boolean;
  allowed: ProjectMcpPolicyEntry[];
  denied: ProjectMcpPolicyEntry[];
  allowManagedOnly?: boolean;
};

const policyCache = new Map<string, Promise<ProjectMcpPolicy>>();

export async function loadProjectMcpPolicy(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string; managedDirectories?: string[]; rootId?: string } = {},
) {
  const homeDir = options.homeDir ?? os.homedir();
  const managedDirectories = options.managedDirectories ?? getDefaultManagedSettingsDirectories();
  const generation = getProjectConfigGeneration(projectId, dataDir);
  if (generation === undefined) {
    return loadProjectMcpPolicyUncached(projectId, dataDir, {
      homeDir,
      managedDirectories,
      rootId: options.rootId,
    });
  }
  const key = JSON.stringify([
    path.resolve(dataDir),
    projectId,
    options.rootId ?? "",
    path.resolve(homeDir),
    managedDirectories.map((directory) => path.resolve(directory)),
    generation,
  ]);
  const cached = policyCache.get(key);
  if (cached) return cached;
  const pending = loadProjectMcpPolicyUncached(projectId, dataDir, {
    homeDir,
    managedDirectories,
    rootId: options.rootId,
  }).catch((error) => {
    policyCache.delete(key);
    throw error;
  });
  policyCache.set(key, pending);
  while (policyCache.size > 200) {
    const oldest = policyCache.keys().next().value;
    if (typeof oldest !== "string") break;
    policyCache.delete(oldest);
  }
  return pending;
}

export function isProjectMcpServerAllowed(policy: ProjectMcpPolicy, server: ProjectMcpPolicyServer) {
  if ((policy.denied ?? []).some((entry) => matchesEntry(entry, server))) return false;
  if (policy.allowed === undefined) return true;
  if (policy.allowed.length === 0) return false;

  const command = server.command ? [server.command, ...(server.args ?? [])] : null;
  const hasCommandEntries = policy.allowed.some(isCommandEntry);
  const hasUrlEntries = policy.allowed.some(isUrlEntry);
  if (command) {
    return hasCommandEntries
      ? policy.allowed.some((entry) => isCommandEntry(entry) && arraysEqual(entry.serverCommand, command))
      : policy.allowed.some((entry) => isNameEntry(entry) && entry.serverName === server.name);
  }
  if (server.url) {
    return hasUrlEntries
      ? policy.allowed.some((entry) => isUrlEntry(entry) && urlMatchesPattern(server.url!, entry.serverUrl))
      : policy.allowed.some((entry) => isNameEntry(entry) && entry.serverName === server.name);
  }
  return policy.allowed.some((entry) => isNameEntry(entry) && entry.serverName === server.name);
}

async function loadProjectMcpPolicyUncached(
  projectId: string,
  dataDir: string,
  options: { homeDir: string; managedDirectories: string[]; rootId?: string },
) {
  const managed = await readFirstManagedLayer(options.managedDirectories);
  const editableFiles = [
    path.join(options.homeDir, ".claude", "settings.json"),
    path.join(options.homeDir, ".zenme", "settings.json"),
  ];
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  const root = binding ? resolveWorkspaceRoot(binding, options.rootId) : null;
  if (root?.status === "resolved") {
    editableFiles.push(
      path.join(root.realPath, ".claude", "settings.json"),
      path.join(root.realPath, ".zenme", "settings.json"),
      path.join(root.realPath, ".claude", "settings.local.json"),
      path.join(root.realPath, ".zenme", "settings.local.json"),
    );
  }
  const editable = mergeLayers(await Promise.all(editableFiles.map(readSettingsLayer)));
  const allowManagedOnly = managed.allowManagedOnly === true;
  const allowSource = allowManagedOnly ? managed : mergeLayers([managed, editable]);
  return {
    ...(allowSource.allowedDefined ? { allowed: allowSource.allowed } : {}),
    denied: [...managed.denied, ...editable.denied],
    allowManagedOnly,
  } satisfies ProjectMcpPolicy;
}

async function readFirstManagedLayer(directories: readonly string[]) {
  for (const directory of directories) {
    const files = [path.join(directory, "managed-settings.json")];
    const dropIn = path.join(directory, "managed-settings.d");
    const entries = await fs.readdir(dropIn, { withFileTypes: true }).catch((error) => {
      if (isMissingOrUnreadable(error)) return [];
      throw error;
    });
    files.push(...entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
      .map((entry) => path.join(dropIn, entry.name))
      .sort((left, right) => left.localeCompare(right)));
    const layers = await Promise.all(files.map(readSettingsLayer));
    if (layers.some((layer) => layer.allowedDefined || layer.denied.length > 0 || layer.allowManagedOnly !== undefined)) {
      return mergeLayers(layers);
    }
  }
  return emptyLayer();
}

async function readSettingsLayer(filePath: string): Promise<SettingsLayer> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) return emptyLayer();
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed)) return emptyLayer();
    return {
      allowedDefined: Array.isArray(parsed.allowedMcpServers),
      allowed: normalizeEntries(parsed.allowedMcpServers),
      denied: normalizeEntries(parsed.deniedMcpServers),
      ...(typeof parsed.allowManagedMcpServersOnly === "boolean"
        ? { allowManagedOnly: parsed.allowManagedMcpServersOnly }
        : {}),
    };
  } catch (error) {
    if (error instanceof SyntaxError || isMissingOrUnreadable(error)) return emptyLayer();
    throw error;
  }
}

function mergeLayers(layers: readonly SettingsLayer[]): SettingsLayer {
  let allowManagedOnly: boolean | undefined;
  for (const layer of layers) {
    if (layer.allowManagedOnly !== undefined) allowManagedOnly = layer.allowManagedOnly;
  }
  return {
    allowedDefined: layers.some((layer) => layer.allowedDefined),
    allowed: dedupe(layers.flatMap((layer) => layer.allowed)),
    denied: dedupe(layers.flatMap((layer) => layer.denied)),
    ...(allowManagedOnly !== undefined ? { allowManagedOnly } : {}),
  };
}

function normalizeEntries(value: unknown): ProjectMcpPolicyEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap<ProjectMcpPolicyEntry>((entry) => {
    if (!isRecord(entry)) return [];
    const defined = ["serverName", "serverCommand", "serverUrl"].filter((key) => entry[key] !== undefined);
    if (defined.length !== 1) return [];
    if (typeof entry.serverName === "string" && /^[a-zA-Z0-9_-]+$/.test(entry.serverName)) {
      return [{ serverName: entry.serverName }];
    }
    if (Array.isArray(entry.serverCommand) && entry.serverCommand.length > 0 && entry.serverCommand.every((part) => typeof part === "string")) {
      return [{ serverCommand: entry.serverCommand }];
    }
    if (typeof entry.serverUrl === "string" && entry.serverUrl.length > 0) return [{ serverUrl: entry.serverUrl }];
    return [];
  });
}

function matchesEntry(entry: ProjectMcpPolicyEntry, server: ProjectMcpPolicyServer) {
  if (isNameEntry(entry)) return entry.serverName === server.name;
  if (isCommandEntry(entry)) {
    return Boolean(server.command) && arraysEqual(entry.serverCommand, [server.command!, ...(server.args ?? [])]);
  }
  return Boolean(server.url) && urlMatchesPattern(server.url!, entry.serverUrl);
}

function urlMatchesPattern(url: string, pattern: string) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`).test(url);
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isNameEntry(entry: ProjectMcpPolicyEntry): entry is { serverName: string } {
  return "serverName" in entry;
}

function isCommandEntry(entry: ProjectMcpPolicyEntry): entry is { serverCommand: string[] } {
  return "serverCommand" in entry;
}

function isUrlEntry(entry: ProjectMcpPolicyEntry): entry is { serverUrl: string } {
  return "serverUrl" in entry;
}

function dedupe(entries: readonly ProjectMcpPolicyEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyLayer(): SettingsLayer {
  return { allowedDefined: false, allowed: [], denied: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingOrUnreadable(error: unknown) {
  return error instanceof Error && "code" in error &&
    ["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(String(error.code));
}
