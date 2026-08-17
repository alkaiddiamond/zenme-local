import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import type { EnabledProjectPlugin } from "@/lib/agent/project-plugin-hooks";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability } from "@/lib/workspace/types";

const MAX_FILE_BYTES = 1_048_576;
const optionCache = new Map<string, Promise<ProjectPluginOptions>>();

export type PluginOptionSchema = Record<string, {
  description?: string;
  default?: unknown;
  max?: number;
  min?: number;
  multiple?: boolean;
  required?: boolean;
  sensitive?: boolean;
  title?: string;
  type: "string" | "number" | "boolean" | "directory" | "file";
}>;

export type ProjectPluginOptions = {
  missing: string[];
  schema: PluginOptionSchema;
  values: Record<string, string | number | boolean | string[]>;
};

export async function loadProjectPluginOptions(
  projectId: string,
  dataDir: string,
  plugin: EnabledProjectPlugin,
  options: { homeDir?: string } = {},
) {
  const generation = getProjectConfigGeneration(projectId, dataDir);
  const key = JSON.stringify([path.resolve(dataDir), projectId, plugin.id, options.homeDir ?? "", generation ?? null]);
  if (generation !== undefined) {
    const cached = optionCache.get(key);
    if (cached) return cached;
  }
  const pending = loadOptionsUncached(projectId, dataDir, plugin, options);
  if (generation !== undefined) {
    optionCache.set(key, pending);
    pending.catch(() => optionCache.delete(key));
    pruneCache();
  }
  return pending;
}

async function loadOptionsUncached(
  projectId: string,
  dataDir: string,
  plugin: EnabledProjectPlugin,
  options: { homeDir?: string },
): Promise<ProjectPluginOptions> {
  const homeDir = options.homeDir ?? os.homedir();
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const settingFiles = [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(homeDir, ".zenme", "settings.json"),
    ...(binding && canUseWorkspaceCapability(binding, "read") ? [
      path.join(binding.realPath, ".claude", "settings.json"),
      path.join(binding.realPath, ".zenme", "settings.json"),
      path.join(binding.realPath, ".claude", "settings.local.json"),
      path.join(binding.realPath, ".zenme", "settings.local.json"),
    ] : []),
  ];
  return loadPluginOptionsFromFiles(plugin, settingFiles, credentialFiles(dataDir, homeDir));
}

export async function loadPluginOptionsFromFiles(
  plugin: EnabledProjectPlugin,
  settingFiles: readonly string[],
  credentialFilePaths: readonly string[],
): Promise<ProjectPluginOptions> {
  const schema = normalizeProjectPluginOptionSchema(plugin.manifest?.userConfig);
  if (!Object.keys(schema).length) return { missing: [], schema, values: {} };
  const values: Record<string, unknown> = {};
  for (const filePath of settingFiles) {
    const settings = await readBoundedJson(filePath);
    const configured: Record<string, unknown> | undefined = isRecord(settings) && isRecord(settings.pluginConfigs) && isRecord(settings.pluginConfigs[plugin.id])
      ? settings.pluginConfigs[plugin.id] as Record<string, unknown>
      : undefined;
    if (configured && isRecord(configured.options)) Object.assign(values, configured.options);
  }
  for (const filePath of credentialFilePaths) {
    const credentials = await readBoundedJson(filePath);
    const secrets = isRecord(credentials) && isRecord(credentials.pluginSecrets) && isRecord(credentials.pluginSecrets[plugin.id])
      ? credentials.pluginSecrets[plugin.id]
      : undefined;
    if (secrets) Object.assign(values, secrets);
  }
  const normalized: ProjectPluginOptions["values"] = {};
  const missing: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const value = values[key] ?? field.default;
    const valid = normalizeProjectPluginOptionValue(value, field);
    if (valid !== undefined) normalized[key] = valid;
    else if (field.required) missing.push(key);
  }
  return { missing, schema, values: normalized };
}

export async function loadProjectPluginMcpServerOptions(
  projectId: string,
  dataDir: string,
  plugin: EnabledProjectPlugin,
  serverName: string,
  schemaValue: unknown,
  options: { homeDir?: string } = {},
): Promise<ProjectPluginOptions> {
  const homeDir = options.homeDir ?? os.homedir();
  const binding = await getLocalWorkspaceBinding(projectId, dataDir).catch(() => null);
  const settingFiles = [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(homeDir, ".zenme", "settings.json"),
    ...(binding && canUseWorkspaceCapability(binding, "read") ? [
      path.join(binding.realPath, ".claude", "settings.json"),
      path.join(binding.realPath, ".zenme", "settings.json"),
      path.join(binding.realPath, ".claude", "settings.local.json"),
      path.join(binding.realPath, ".zenme", "settings.local.json"),
    ] : []),
  ];
  return loadPluginMcpServerOptionsFromFiles(
    plugin,
    serverName,
    schemaValue,
    settingFiles,
    credentialFiles(dataDir, homeDir),
  );
}

export async function loadPluginMcpServerOptionsFromFiles(
  plugin: EnabledProjectPlugin,
  serverName: string,
  schemaValue: unknown,
  settingFiles: readonly string[],
  credentialFilePaths: readonly string[],
): Promise<ProjectPluginOptions> {
  const schema = normalizeProjectPluginOptionSchema(schemaValue);
  if (!Object.keys(schema).length) return { missing: [], schema, values: {} };
  const values: Record<string, unknown> = {};
  for (const filePath of settingFiles) {
    const settings = await readBoundedJson(filePath);
    const configured: Record<string, unknown> | undefined = isRecord(settings) && isRecord(settings.pluginConfigs) && isRecord(settings.pluginConfigs[plugin.id])
      ? settings.pluginConfigs[plugin.id] as Record<string, unknown>
      : undefined;
    const serverConfigs = configured && isRecord(configured.mcpServers) ? configured.mcpServers : undefined;
    if (serverConfigs && isRecord(serverConfigs[serverName])) Object.assign(values, serverConfigs[serverName]);
  }
  const secretKey = `${plugin.id}/${serverName}`;
  for (const filePath of credentialFilePaths) {
    const credentials = await readBoundedJson(filePath);
    const secrets = isRecord(credentials) && isRecord(credentials.pluginSecrets) && isRecord(credentials.pluginSecrets[secretKey])
      ? credentials.pluginSecrets[secretKey]
      : undefined;
    if (secrets) Object.assign(values, secrets);
  }
  return normalizeProjectPluginOptionValues(schema, values);
}

function credentialFiles(dataDir: string, homeDir: string) {
  return [
    path.join(homeDir, ".claude", ".credentials.json"),
    path.join(homeDir, ".zenme", ".credentials.json"),
    path.join(dataDir, "plugin-credentials.json"),
  ];
}

export function substitutePluginUserConfigRuntime(value: string, options: ProjectPluginOptions) {
  return value.replace(/\$\{user_config\.([^}]+)\}/g, (_match, key: string) => {
    const configured = options.values[key];
    if (configured === undefined) throw new Error(`插件缺少必需配置：${key}`);
    return Array.isArray(configured) ? configured.join(",") : String(configured);
  });
}

export function substitutePluginUserConfigInContent(content: string, options: ProjectPluginOptions) {
  return content.replace(/\$\{user_config\.([^}]+)\}/g, (match, key: string) => {
    if (options.schema[key]?.sensitive === true) return `[sensitive option '${key}' not available in skill content]`;
    const configured = options.values[key];
    if (configured === undefined) return match;
    return Array.isArray(configured) ? configured.join(",") : String(configured);
  });
}

export function normalizeProjectPluginOptionSchema(value: unknown): PluginOptionSchema {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, raw]) => {
    if (!/^[A-Za-z_]\w*$/.test(key) || !isRecord(raw) || !isOptionType(raw.type)) return [];
    return [[key, {
      type: raw.type,
      ...(typeof raw.title === "string" ? { title: raw.title.slice(0, 200) } : {}),
      ...(typeof raw.description === "string" ? { description: raw.description.slice(0, 2_000) } : {}),
      ...(raw.required === true ? { required: true } : {}),
      ...(raw.sensitive === true ? { sensitive: true } : {}),
      ...(raw.multiple === true ? { multiple: true } : {}),
      ...(typeof raw.min === "number" && Number.isFinite(raw.min) ? { min: raw.min } : {}),
      ...(typeof raw.max === "number" && Number.isFinite(raw.max) ? { max: raw.max } : {}),
      ...(raw.default !== undefined ? { default: raw.default } : {}),
    }]];
  }));
}

export function normalizeProjectPluginOptionValues(schema: PluginOptionSchema, values: Record<string, unknown>): ProjectPluginOptions {
  const normalized: ProjectPluginOptions["values"] = {};
  const missing: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const value = values[key] ?? field.default;
    const valid = normalizeProjectPluginOptionValue(value, field);
    if (valid !== undefined) normalized[key] = valid;
    else if (field.required) missing.push(key);
  }
  return { missing, schema, values: normalized };
}

export function normalizeProjectPluginOptionValue(value: unknown, field: PluginOptionSchema[string]) {
  if (field.type === "boolean") return typeof value === "boolean" ? value : undefined;
  if (field.type === "number") return typeof value === "number" && Number.isFinite(value) && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max) ? value : undefined;
  if (Array.isArray(value)) return field.multiple && value.every((item) => typeof item === "string") ? value.slice(0, 100) as string[] : undefined;
  return typeof value === "string" && (!field.required || value.length > 0) ? value : undefined;
}

async function readBoundedJson(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return undefined;
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) return undefined;
    throw error;
  }
}

function pruneCache() {
  while (optionCache.size > 200) {
    const oldest = optionCache.keys().next().value;
    if (typeof oldest !== "string") break;
    optionCache.delete(oldest);
  }
}

function isOptionType(value: unknown): value is PluginOptionSchema[string]["type"] {
  return value === "string" || value === "number" || value === "boolean" || value === "directory" || value === "file";
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
