import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectProjectPluginMcpb, isProjectPluginMcpbSource } from "@/lib/agent/project-plugin-mcpb";
import {
  loadPluginMcpServerOptionsFromFiles,
  loadPluginOptionsFromFiles,
  normalizeProjectPluginOptionSchema,
  normalizeProjectPluginOptionValue,
  type PluginOptionSchema,
  type ProjectPluginOptions,
} from "@/lib/agent/project-plugin-options";
import {
  loadEnabledProjectPlugins,
  type EnabledProjectPlugin,
  type PluginSettingSource,
} from "@/lib/agent/project-plugin-hooks";
import { writeJsonFile } from "@/lib/local/atomic-json";

const MAX_CONFIG_BYTES = 1_048_576;

export type AgentPluginConfigurationView = {
  configuredKeys: string[];
  id: string;
  kind: "plugin" | "mcpServer";
  label: string;
  missing: string[];
  schema: PluginOptionSchema;
  serverName?: string;
  source?: string;
  values: Record<string, string | number | boolean | string[]>;
};

export type AgentPluginView = {
  configurations: AgentPluginConfigurationView[];
  errors: Array<{ source: string; error: string }>;
  id: string;
  name: string;
};

export async function listAgentPlugins(input: {
  dataDir: string;
  homeDir?: string;
}): Promise<AgentPluginView[]> {
  const homeDir = input.homeDir ?? os.homedir();
  const paths = configPaths(input.dataDir, homeDir);
  const plugins = await loadEnabledProjectPlugins({ homeDir, settingSources: paths.settingSources });
  return Promise.all(plugins.map((plugin) => describePlugin(plugin, paths)));
}

export async function saveAgentPluginConfiguration(input: {
  configurationId: string;
  dataDir: string;
  homeDir?: string;
  pluginId: string;
  values: Record<string, unknown>;
}) {
  const homeDir = input.homeDir ?? os.homedir();
  const paths = configPaths(input.dataDir, homeDir);
  const plugins = await loadEnabledProjectPlugins({ homeDir, settingSources: paths.settingSources });
  const plugin = plugins.find((candidate) => candidate.id === input.pluginId);
  if (!plugin) throw new Error("插件不存在或未启用");
  const described = await describePlugin(plugin, paths);
  const configuration = described.configurations.find((candidate) => candidate.id === input.configurationId);
  if (!configuration) throw new Error("插件配置项不存在");

  const current = await loadConfigurationOptions(plugin, configuration, paths);
  const merged: Record<string, unknown> = { ...current.values };
  for (const [key, value] of Object.entries(input.values)) {
    const field = configuration.schema[key];
    if (!field) throw new Error(`未知插件配置项：${key}`);
    if (field.sensitive && value === "") continue;
    if (value === null) {
      delete merged[key];
      continue;
    }
    const normalized = normalizeProjectPluginOptionValue(value, field);
    if (normalized === undefined) throw new Error(`插件配置“${field.title ?? key}”格式无效`);
    merged[key] = normalized;
  }
  for (const [key, field] of Object.entries(configuration.schema)) {
    if (field.required && normalizeProjectPluginOptionValue(merged[key] ?? field.default, field) === undefined) {
      throw new Error(`插件缺少必需配置：${field.title ?? key}`);
    }
  }

  const storageKey = configuration.kind === "plugin"
    ? plugin.id
    : `${plugin.id}/${configuration.serverName}`;
  const sensitive: Record<string, unknown> = {};
  const nonSensitive: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(configuration.schema)) {
    const value = merged[key];
    if (value === undefined) continue;
    (field.sensitive ? sensitive : nonSensitive)[key] = value;
  }

  // Match cc-haha's ordering: secure storage first, then scrub plaintext.
  await updateSecretBucket(paths.credentialsFile, storageKey, configuration.schema, sensitive);
  await updateSettingsBucket(paths.zenmeSettingsFile, plugin.id, configuration, nonSensitive);
  await fs.chmod(paths.credentialsFile, 0o600).catch(() => undefined);
  const { notifyProjectConfigFileChanged } = await import("@/lib/agent/project-config-change-runtime");
  await notifyProjectConfigFileChanged(paths.credentialsFile);
  await notifyProjectConfigFileChanged(paths.zenmeSettingsFile);
  return listAgentPlugins({ dataDir: input.dataDir, homeDir });
}

async function describePlugin(plugin: EnabledProjectPlugin, paths: ConfigPaths): Promise<AgentPluginView> {
  const configurations: AgentPluginConfigurationView[] = [];
  const errors: AgentPluginView["errors"] = [];
  const pluginSchema = normalizeProjectPluginOptionSchema(plugin.manifest?.userConfig);
  if (Object.keys(pluginSchema).length) {
    const options = await loadPluginOptionsFromFiles(plugin, paths.settingFiles, paths.credentialFiles);
    configurations.push(toConfigurationView({ id: "plugin", kind: "plugin", label: "插件选项", schema: pluginSchema }, options));
  }
  const declarations = plugin.manifest?.mcpServers;
  for (const source of Array.isArray(declarations) ? declarations : declarations === undefined ? [] : [declarations]) {
    if (typeof source !== "string" || !isProjectPluginMcpbSource(source)) continue;
    try {
      const inspected = await inspectProjectPluginMcpb({ plugin, source });
      if (!Object.keys(inspected.schema).length) continue;
      const options = await loadPluginMcpServerOptionsFromFiles(
        plugin,
        inspected.manifest.name,
        inspected.manifest.user_config,
        paths.settingFiles,
        paths.credentialFiles,
      );
      configurations.push(toConfigurationView({
        id: `mcp:${inspected.manifest.name}`,
        kind: "mcpServer",
        label: inspected.name,
        schema: inspected.schema,
        serverName: inspected.manifest.name,
        source,
      }, options));
    } catch (error) {
      errors.push({ source, error: safeMessage(error) });
    }
  }
  return { id: plugin.id, name: plugin.name, configurations, errors };
}

function toConfigurationView(
  base: Omit<AgentPluginConfigurationView, "configuredKeys" | "missing" | "values">,
  options: ProjectPluginOptions,
): AgentPluginConfigurationView {
  return {
    ...base,
    configuredKeys: Object.keys(options.values),
    missing: options.missing,
    values: Object.fromEntries(Object.entries(options.values).filter(([key]) => !options.schema[key]?.sensitive)),
  };
}

async function loadConfigurationOptions(plugin: EnabledProjectPlugin, configuration: AgentPluginConfigurationView, paths: ConfigPaths) {
  if (configuration.kind === "plugin") return loadPluginOptionsFromFiles(plugin, paths.settingFiles, paths.credentialFiles);
  return loadPluginMcpServerOptionsFromFiles(
    plugin,
    configuration.serverName!,
    configuration.schema,
    paths.settingFiles,
    paths.credentialFiles,
  );
}

async function updateSecretBucket(filePath: string, storageKey: string, schema: PluginOptionSchema, values: Record<string, unknown>) {
  const root = await readObject(filePath);
  const pluginSecrets = isRecord(root.pluginSecrets) ? { ...root.pluginSecrets } : {};
  const existing = isRecord(pluginSecrets[storageKey]) ? { ...pluginSecrets[storageKey] } : {};
  for (const [key, field] of Object.entries(schema)) {
    if (field.sensitive) {
      if (key in values) existing[key] = values[key];
      else delete existing[key];
    } else {
      delete existing[key];
    }
  }
  if (Object.keys(existing).length) pluginSecrets[storageKey] = existing;
  else delete pluginSecrets[storageKey];
  await writeJsonFile(filePath, { ...root, pluginSecrets });
}

async function updateSettingsBucket(
  filePath: string,
  pluginId: string,
  configuration: AgentPluginConfigurationView,
  values: Record<string, unknown>,
) {
  const root = await readObject(filePath);
  const pluginConfigs = isRecord(root.pluginConfigs) ? { ...root.pluginConfigs } : {};
  const pluginConfig = isRecord(pluginConfigs[pluginId]) ? { ...pluginConfigs[pluginId] } : {};
  if (configuration.kind === "plugin") {
    pluginConfig.options = scrubAndMerge(pluginConfig.options, configuration.schema, values, false);
  } else {
    const mcpServers = isRecord(pluginConfig.mcpServers) ? { ...pluginConfig.mcpServers } : {};
    mcpServers[configuration.serverName!] = scrubAndMerge(mcpServers[configuration.serverName!], configuration.schema, values, false);
    pluginConfig.mcpServers = mcpServers;
  }
  pluginConfigs[pluginId] = pluginConfig;
  await writeJsonFile(filePath, { ...root, pluginConfigs });
}

function scrubAndMerge(existingValue: unknown, schema: PluginOptionSchema, values: Record<string, unknown>, sensitive: boolean) {
  const result = isRecord(existingValue) ? { ...existingValue } : {};
  for (const [key, field] of Object.entries(schema)) {
    if (Boolean(field.sensitive) !== sensitive) delete result[key];
    else if (key in values) result[key] = values[key];
    else delete result[key];
  }
  return result;
}

type ConfigPaths = ReturnType<typeof configPaths>;
function configPaths(dataDir: string, homeDir: string) {
  const claudeSettingsFile = path.join(homeDir, ".claude", "settings.json");
  const zenmeSettingsFile = path.join(homeDir, ".zenme", "settings.json");
  const credentialsFile = path.join(dataDir, "plugin-credentials.json");
  return {
    credentialsFile,
    zenmeSettingsFile,
    settingFiles: [claudeSettingsFile, zenmeSettingsFile],
    credentialFiles: [
      path.join(homeDir, ".claude", ".credentials.json"),
      path.join(homeDir, ".zenme", ".credentials.json"),
      credentialsFile,
    ],
    settingSources: [
      { filePath: claudeSettingsFile, scope: "user" },
      { filePath: zenmeSettingsFile, scope: "user" },
    ] satisfies PluginSettingSource[],
  };
}

async function readObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw new Error("插件配置文件无效或过大");
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
    if (!isRecord(parsed)) throw new Error("插件配置文件格式无效");
    return parsed;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return {};
    throw error;
  }
}

function safeMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
