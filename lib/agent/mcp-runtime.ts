import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type ElicitRequestParams,
  type ElicitResult,
  type Transport,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import type {
  ProjectAgentMcpServerConfig,
  ProjectAgentMcpServerSpec,
} from "@/lib/agent/project-agent-mcp";
import { getLocalSettings, type McpServerConfig } from "@/lib/local/settings";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceRootCapability, resolveWorkspaceRoot, type WorkspaceResolvedRoot } from "@/lib/workspace/types";
import { loadProjectPluginMcpServers, loadProjectPluginMcpServersWithFailures } from "@/lib/agent/project-plugin-hooks";
import { isProjectCustomizationRestricted } from "@/lib/agent/project-customization-policy";
import { isProjectMcpServerAllowed, loadProjectMcpPolicy } from "@/lib/agent/project-mcp-policy";

const MAX_MCP_TOOLS = 200;
const MAX_MCP_RESOURCES = 500;
const MAX_MCP_RESULT_CHARACTERS = 100_000;

export type McpToolName = `mcp__${string}__${string}`;

export type ProjectMcpTool = {
  name: McpToolName;
  serverId: string;
  serverName: string;
  remoteName: string;
  description: string;
  parameters: Record<string, unknown>;
  readOnly: boolean;
};

type Connection = {
  client: Client;
  configKey: string;
  elicitationCompletionHandler?: ProjectMcpElicitationCompleteHandler;
  elicitationHandler?: ProjectMcpElicitationHandler;
  callQueue: Promise<void>;
  scope?: string;
  tools: ProjectMcpTool[];
};

export type ProjectMcpElicitationRequest = {
  serverId: string;
  serverName: string;
  params: ElicitRequestParams;
};

export type ProjectMcpElicitationHandler = (
  request: ProjectMcpElicitationRequest,
) => Promise<ElicitResult>;

export type ProjectMcpElicitationCompleteHandler = (input: {
  serverId: string;
  serverName: string;
  elicitationId: string;
}) => Promise<void> | void;

type InlineMcpServerConfig = {
  id: string;
  name: string;
  enabled: true;
  access: "full";
  connectTimeoutMs: number;
  callTimeoutMs: number;
  inline: true;
  config: ProjectAgentMcpServerConfig;
  scope: string;
};

type RuntimeMcpServerConfig = McpServerConfig | InlineMcpServerConfig;

export type AgentMcpRuntimeSelection = {
  specs?: ProjectAgentMcpServerSpec[];
  customizationSource?: "policy" | "project" | "user" | "plugin";
  managedDirectories?: string[];
  homeDir?: string;
  /** Stable Agent Execution id. Inline clients never escape this scope. */
  connectionScope?: string;
};

type McpRuntime = {
  connections: Map<string, Promise<Connection>>;
};

const globalRuntime = globalThis as typeof globalThis & { __zenmeMcpRuntime?: McpRuntime };
const runtime = globalRuntime.__zenmeMcpRuntime ?? { connections: new Map() };
globalRuntime.__zenmeMcpRuntime = runtime;

export function isMcpToolName(value: unknown): value is McpToolName {
  return typeof value === "string" && /^mcp__[a-z0-9_]{1,100}__[a-z0-9_]{1,100}$/i.test(value);
}

export function parseProjectMcpToolCall(
  tools: readonly ProjectMcpTool[],
  name: unknown,
  argumentsValue: unknown,
): { name: McpToolName; arguments: Record<string, unknown> } | null {
  if (!isMcpToolName(name) || !isRecord(argumentsValue)) return null;
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool || !matchesJsonSchema(argumentsValue, tool.parameters)) return null;
  return { name, arguments: argumentsValue };
}

export async function listProjectMcpTools(
  projectId: string,
  dataDir = getZenmeDataDir(),
  rootId?: string,
  selection?: AgentMcpRuntimeSelection,
): Promise<{ tools: ProjectMcpTool[]; failures: Array<{ serverId: string; serverName: string; error: string }> }> {
  const settings = await getLocalSettings(dataDir);
  const pluginResult = await loadProjectPluginMcpServersWithFailures(projectId, dataDir);
  const restricted = await isProjectCustomizationRestricted(projectId, dataDir, "mcp", {
    managedDirectories: selection?.managedDirectories,
  });
  const selected = applyProjectMcpCustomizationPolicy({
    restricted,
    settingsServers: settings.mcpServers,
    pluginSpecs: pluginResult.servers,
    agentSpecs: selection?.specs,
    agentSource: selection?.customizationSource,
  });
  const resolved = resolveAgentMcpServers(selected.settingsServers, {
    ...selection,
    specs: selected.specs,
  });
  const policy = await loadProjectMcpPolicy(projectId, dataDir, {
    homeDir: selection?.homeDir,
    managedDirectories: selection?.managedDirectories,
    rootId,
  });
  const policyResult = filterRuntimeMcpServersByPolicy(resolved.servers, policy);
  const enabled = policyResult.servers;
  const settled = await Promise.all(enabled.map(async (server) => {
    try {
      const connection = await getConnection(projectId, server, dataDir, rootId);
      return { tools: connection.tools };
    } catch (error) {
      return { failure: { serverId: server.id, serverName: server.name, error: safeMessage(error) } };
    }
  }));
  return {
    tools: settled.flatMap((entry) => entry.tools ?? []).slice(0, MAX_MCP_TOOLS),
    failures: [
      ...pluginResult.failures.map((failure) => ({
        serverId: failure.pluginId,
        serverName: failure.pluginName,
        error: failure.error,
      })),
      ...resolved.failures,
      ...policyResult.failures,
      ...settled.flatMap((entry) => entry.failure ? [entry.failure] : []),
    ],
  };
}

export function searchProjectMcpTools(
  tools: readonly ProjectMcpTool[],
  query: string,
  maxResults = 10,
) {
  const terms = query.toLocaleLowerCase().match(/[a-z0-9_]+|[\u3400-\u9fff]/g) ?? [];
  return tools
    .map((tool) => {
      const haystack = `${tool.name} ${tool.serverName} ${tool.remoteName} ${tool.description}`.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name))
    .slice(0, Math.max(1, Math.min(30, maxResults)))
    .map(({ tool }) => ({
      name: tool.name,
      description: tool.description,
      permission: tool.readOnly ? "read" as const : "execute" as const,
      requiresWorkspace: true,
      parameters: tool.parameters,
      serverName: tool.serverName,
    }));
}

export async function callProjectMcpTool(input: {
  projectId: string;
  name: McpToolName;
  arguments: Record<string, unknown>;
  signal?: AbortSignal;
  rootId?: string;
  agentMcpServers?: ProjectAgentMcpServerSpec[];
  agentCustomizationSource?: "policy" | "project" | "user" | "plugin";
  managedDirectories?: string[];
  homeDir?: string;
  connectionScope?: string;
  onElicitation?: ProjectMcpElicitationHandler;
  onElicitationComplete?: ProjectMcpElicitationCompleteHandler;
}, dataDir = getZenmeDataDir()) {
  const settings = await getLocalSettings(dataDir);
  const pluginSpecs = await loadProjectPluginMcpServers(input.projectId, dataDir);
  const restricted = await isProjectCustomizationRestricted(input.projectId, dataDir, "mcp", {
    managedDirectories: input.managedDirectories,
  });
  const selected = applyProjectMcpCustomizationPolicy({
    restricted,
    settingsServers: settings.mcpServers,
    pluginSpecs,
    agentSpecs: input.agentMcpServers,
    agentSource: input.agentCustomizationSource,
  });
  const resolved = resolveAgentMcpServers(selected.settingsServers, {
    specs: selected.specs,
    connectionScope: input.connectionScope,
  });
  const policy = await loadProjectMcpPolicy(input.projectId, dataDir, {
    homeDir: input.homeDir,
    managedDirectories: input.managedDirectories,
    rootId: input.rootId,
  });
  const policyResult = filterRuntimeMcpServersByPolicy(resolved.servers, policy);
  for (const server of policyResult.servers) {
    const connection = await getConnection(input.projectId, server, dataDir, input.rootId);
    const tool = connection.tools.find((candidate) => candidate.name === input.name);
    if (!tool) continue;
    if (!tool.readOnly && server.access !== "full") {
      throw new Error(`MCP 服务“${server.name}”仅获只读权限，工具“${tool.remoteName}”已拒绝`);
    }
    const result = await serializeMcpToolCall(connection, input.onElicitation, input.onElicitationComplete, () => withTimeout(
      connection.client.callTool({ name: tool.remoteName, arguments: input.arguments }, { signal: input.signal }),
      server.callTimeoutMs,
      `MCP 工具“${tool.remoteName}”调用超时`,
    )) as { content?: unknown; structuredContent?: unknown; isError?: boolean };
    const normalized = normalizeToolResult(result);
    if (result.isError) throw new Error(normalized.text || `MCP 工具“${tool.remoteName}”执行失败`);
    return normalized;
  }
  throw new Error(`MCP 工具不存在或服务未启用：${input.name}`);
}

export async function listProjectMcpResources(input: {
  projectId: string;
  server?: string;
  rootId?: string;
  managedDirectories?: string[];
  homeDir?: string;
}, dataDir = getZenmeDataDir()) {
  const servers = await selectedServers(input.projectId, input.server, dataDir, false, {
    managedDirectories: input.managedDirectories,
    homeDir: input.homeDir,
    rootId: input.rootId,
  });
  const settled = await Promise.all(servers.map(async (server) => {
    try {
      const connection = await getConnection(input.projectId, server, dataDir, input.rootId);
      const resources: Array<{ serverId: string; serverName: string; uri: string; name?: string; description?: string; mimeType?: string }> = [];
      let cursor: string | undefined;
      do {
        const listed = await withTimeout(
          connection.client.listResources(cursor ? { cursor } : undefined),
          server.callTimeoutMs,
          `MCP 服务“${server.name}”资源发现超时`,
        );
        for (const resource of listed.resources) {
          if (!resource.uri || resources.length >= MAX_MCP_RESOURCES) break;
          resources.push({
            serverId: server.id,
            serverName: server.name,
            uri: boundText(resource.uri),
            ...(resource.name ? { name: boundText(resource.name) } : {}),
            ...(resource.description ? { description: boundText(resource.description) } : {}),
            ...(resource.mimeType ? { mimeType: boundText(resource.mimeType) } : {}),
          });
        }
        cursor = resources.length < MAX_MCP_RESOURCES ? listed.nextCursor : undefined;
      } while (cursor);
      return { resources };
    } catch (error) {
      return { failure: { serverId: server.id, serverName: server.name, error: safeMessage(error) } };
    }
  }));
  return {
    resources: settled.flatMap((entry) => entry.resources ?? []).slice(0, MAX_MCP_RESOURCES),
    failures: settled.flatMap((entry) => entry.failure ? [entry.failure] : []),
  };
}

export async function readProjectMcpResource(input: {
  projectId: string;
  server: string;
  uri: string;
  rootId?: string;
  managedDirectories?: string[];
  homeDir?: string;
}, dataDir = getZenmeDataDir()) {
  const [server] = await selectedServers(input.projectId, input.server, dataDir, true, {
    managedDirectories: input.managedDirectories,
    homeDir: input.homeDir,
    rootId: input.rootId,
  });
  const connection = await getConnection(input.projectId, server, dataDir, input.rootId);
  const result = await withTimeout(
    connection.client.readResource({ uri: input.uri }),
    server.callTimeoutMs,
    `MCP 资源“${input.uri}”读取超时`,
  );
  const normalized = normalizeResourceContents(result.contents);
  return {
    serverId: server.id,
    serverName: server.name,
    uri: input.uri,
    ...normalized,
  };
}

async function getConnection(projectId: string, server: RuntimeMcpServerConfig, dataDir: string, rootId?: string): Promise<Connection> {
  const root = await resolveProjectMcpWorkspaceRoot(projectId, dataDir, rootId);
  const { cacheKey, configKey } = createMcpConnectionIdentity({ dataDir, projectId, root, server });
  const current = runtime.connections.get(cacheKey);
  if (current) {
    const connection = await current;
    if (connection.configKey === configKey) return connection;
    await connection.client.close().catch(() => undefined);
    runtime.connections.delete(cacheKey);
  }
  const pending = connectServer(server, root.realPath, configKey).catch((error) => {
    runtime.connections.delete(cacheKey);
    throw error;
  });
  runtime.connections.set(cacheKey, pending);
  return pending;
}

export async function resolveProjectMcpWorkspaceRoot(
  projectId: string,
  dataDir: string,
  rootId?: string,
): Promise<WorkspaceResolvedRoot> {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  const root = binding ? resolveWorkspaceRoot(binding, rootId) : null;
  if (!root || !canUseWorkspaceRootCapability(root, "read") || !canUseWorkspaceRootCapability(root, "execute")) {
    throw new Error("MCP 服务需要已解析且已授权读取和执行命令的 Workspace Root");
  }
  return root;
}

export function createMcpConnectionIdentity(input: {
  dataDir: string;
  projectId: string;
  root: WorkspaceResolvedRoot;
  server: RuntimeMcpServerConfig;
}) {
  const scope = isInlineServer(input.server) ? input.server.scope : "global";
  return {
    configKey: JSON.stringify([
      serverConfigIdentity(input.server),
      input.server.access,
      input.root.id,
      input.root.realPath,
    ]),
    cacheKey: `${input.dataDir}\u0000${input.projectId}\u0000${input.root.id}\u0000${scope}\u0000${input.server.id}`,
  };
}

async function connectServer(server: RuntimeMcpServerConfig, cwd: string, configKey: string): Promise<Connection> {
  const client = new Client(
    { name: "zenme-local", version: "0.1.2" },
    { capabilities: { elicitation: { form: { applyDefaults: true }, url: {} } } },
  );
  const connection: Connection = {
    client,
    configKey,
    callQueue: Promise.resolve(),
    tools: [],
  };
  client.setRequestHandler("elicitation/create", async (request) => {
    const handler = connection.elicitationHandler;
    if (!handler) return { action: "cancel" };
    return handler({ serverId: server.id, serverName: server.name, params: request.params });
  });
  client.setNotificationHandler("notifications/elicitation/complete", async (notification) => {
    const handler = connection.elicitationCompletionHandler;
    const elicitationId = isRecord(notification.params) && typeof notification.params.elicitationId === "string"
      ? notification.params.elicitationId
      : "";
    if (!handler || !elicitationId) return;
    await handler({
      serverId: server.id,
      serverName: server.name,
      elicitationId,
    });
  });
  const transport = createTransport(server, cwd);
  try {
    await withTimeout(client.connect(transport), server.connectTimeoutMs, `MCP 服务“${server.name}”连接超时`);
    const listed = await withTimeout(client.listTools(), server.connectTimeoutMs, `MCP 服务“${server.name}”工具发现超时`);
    const usedNames = new Set<string>();
    const tools = listed.tools.slice(0, MAX_MCP_TOOLS).flatMap((tool) => {
      const remoteName = tool.name?.trim();
      if (!remoteName) return [];
      const name = uniqueQualifiedName(server.name, remoteName, usedNames);
      const readOnly = tool.annotations?.readOnlyHint === true;
      if (server.access === "readOnly" && !readOnly) return [];
      return [{
        name,
        serverId: server.id,
        serverName: server.name,
        remoteName,
        description: String(tool.description ?? `调用 ${server.name} 的 ${remoteName}`).slice(0, 2_048),
        parameters: normalizeInputSchema(tool.inputSchema),
        readOnly,
      } satisfies ProjectMcpTool];
    });
    connection.tools = tools;
    if (isInlineServer(server)) connection.scope = server.scope;
    return connection;
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
}

async function serializeMcpToolCall<T>(
  connection: Connection,
  elicitationHandler: ProjectMcpElicitationHandler | undefined,
  elicitationCompletionHandler: ProjectMcpElicitationCompleteHandler | undefined,
  call: () => Promise<T>,
) {
  const previous = connection.callQueue;
  let release!: () => void;
  connection.callQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  connection.elicitationHandler = elicitationHandler;
  connection.elicitationCompletionHandler = elicitationCompletionHandler;
  try {
    return await call();
  } finally {
    connection.elicitationHandler = undefined;
    connection.elicitationCompletionHandler = undefined;
    release();
  }
}

export async function closeAgentMcpConnections(projectId: string, connectionScope: string, dataDir = getZenmeDataDir()) {
  if (!connectionScope.trim()) return;
  const prefix = `${dataDir}\u0000${projectId}\u0000`;
  const marker = `\u0000${connectionScope}\u0000`;
  const matches = [...runtime.connections.entries()].filter(([key]) => key.startsWith(prefix) && key.includes(marker));
  await Promise.all(matches.map(async ([key, pending]) => {
    runtime.connections.delete(key);
    const connection = await pending.catch(() => null);
    if (connection?.scope === connectionScope) await connection.client.close().catch(() => undefined);
  }));
}

function resolveAgentMcpServers(
  configured: McpServerConfig[],
  selection?: AgentMcpRuntimeSelection,
): {
  servers: RuntimeMcpServerConfig[];
  failures: Array<{ serverId: string; serverName: string; error: string }>;
} {
  const inherited = configured.filter((server) => server.enabled);
  const servers: RuntimeMcpServerConfig[] = [...inherited];
  const failures: Array<{ serverId: string; serverName: string; error: string }> = [];
  const scope = selection?.connectionScope?.trim();
  for (const [index, spec] of (selection?.specs ?? []).entries()) {
    if (typeof spec === "string") {
      const match = findConfiguredServer(inherited, spec);
      if (!match) failures.push({ serverId: spec, serverName: spec, error: `Agent 引用的 MCP 服务不存在或未启用：${spec}` });
      continue;
    }
    for (const [name, config] of Object.entries(spec)) {
      if (config.type === "sdk") {
        const match = findConfiguredServer(inherited, config.name);
        if (!match) failures.push({ serverId: name, serverName: name, error: `Zenme 当前没有可继承的 SDK MCP 服务：${config.name}` });
        continue;
      }
      if (!scope) {
        failures.push({ serverId: name, serverName: name, error: "Agent 内联 MCP 缺少 Execution 连接作用域" });
        continue;
      }
      servers.push({
        id: `agent-${index}-${normalizeName(name)}`,
        name,
        enabled: true,
        access: "full",
        connectTimeoutMs: 30_000,
        callTimeoutMs: 120_000,
        inline: true,
        config,
        scope,
      });
    }
  }
  return { servers, failures };
}

function findConfiguredServer(servers: McpServerConfig[], selector: string) {
  const normalized = selector.trim().toLocaleLowerCase();
  return servers.find((server) => server.id.toLocaleLowerCase() === normalized || server.name.toLocaleLowerCase() === normalized);
}

function createTransport(server: RuntimeMcpServerConfig, cwd: string): Transport {
  if (!isInlineServer(server)) {
    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      cwd,
      stderr: "pipe",
      maxBufferSize: 10 * 1024 * 1024,
    });
  }
  const config = server.config;
  if (config.type === "http") {
    return new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
  }
  if (config.type === "sse") {
    return new SSEClientTransport(new URL(config.url), {
      requestInit: config.headers ? { headers: config.headers } : undefined,
      eventSourceInit: config.headers ? { fetch: (url, init) => fetch(url, { ...init, headers: config.headers }) } : undefined,
    });
  }
  if (config.type === "sdk") throw new Error(`SDK MCP 服务必须继承现有连接：${config.name}`);
  if (!("command" in config)) throw new Error(`Agent MCP 传输类型无效：${server.name}`);
  return new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env,
    cwd,
    stderr: "pipe",
    maxBufferSize: 10 * 1024 * 1024,
  });
}

function serverConfigIdentity(server: RuntimeMcpServerConfig) {
  return isInlineServer(server) ? server.config : [server.command, server.args];
}

function isInlineServer(server: RuntimeMcpServerConfig): server is InlineMcpServerConfig {
  return "inline" in server && server.inline === true;
}

function uniqueQualifiedName(serverName: string, toolName: string, used: Set<string>) {
  const prefix = `mcp__${normalizeName(serverName)}__${normalizeName(toolName)}`;
  let candidate = prefix.slice(0, 200) as McpToolName;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${prefix.slice(0, 190)}_${suffix}` as McpToolName;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100) || "tool";
}

function normalizeToolResult(result: { content?: unknown; structuredContent?: unknown }) {
  const textParts = Array.isArray(result.content)
    ? result.content.flatMap((item) => isRecord(item) && item.type === "text" && typeof item.text === "string" ? [item.text] : [])
    : [];
  const text = boundText(textParts.join("\n"));
  return {
    text,
    ...(result.structuredContent !== undefined ? { structuredContent: boundJson(result.structuredContent) } : {}),
  };
}

export function normalizeResourceContents(value: unknown) {
  if (!Array.isArray(value)) return { contents: [], truncated: false };
  let remaining = MAX_MCP_RESULT_CHARACTERS;
  let truncated = false;
  const contents: Array<{ uri: string; mimeType?: string; text?: string; binary?: true }> = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.uri !== "string") continue;
    const base = {
      uri: boundText(item.uri),
      ...(typeof item.mimeType === "string" ? { mimeType: boundText(item.mimeType) } : {}),
    };
    if (typeof item.text === "string") {
      const text = item.text.slice(0, Math.max(0, remaining));
      remaining -= text.length;
      if (text.length < item.text.length) truncated = true;
      contents.push({ ...base, text });
      continue;
    }
    if (typeof item.blob === "string") contents.push({ ...base, binary: true });
  }
  return { contents, truncated };
}

async function selectedServers(
  projectId: string,
  serverSelector: string | undefined,
  dataDir: string,
  requireExact = false,
  options: { managedDirectories?: string[]; homeDir?: string; rootId?: string } = {},
) {
  const settings = await getLocalSettings(dataDir);
  const restricted = await isProjectCustomizationRestricted(projectId, dataDir, "mcp", {
    managedDirectories: options.managedDirectories,
  });
  const policy = await loadProjectMcpPolicy(projectId, dataDir, options);
  const enabled = filterRuntimeMcpServersByPolicy(
    (restricted ? [] : settings.mcpServers).filter((server) => server.enabled),
    policy,
  ).servers;
  if (!serverSelector?.trim()) return enabled;
  const selector = serverSelector.trim().toLocaleLowerCase();
  const selected = enabled.filter((server) => server.id.toLocaleLowerCase() === selector || server.name.toLocaleLowerCase() === selector);
  if ((requireExact || serverSelector) && selected.length !== 1) {
    throw new Error(selected.length === 0
      ? `MCP 服务不存在或未启用：${serverSelector}`
      : `MCP 服务名称不唯一，请使用 serverId：${serverSelector}`);
  }
  return selected;
}

export function filterRuntimeMcpServersByPolicy(
  servers: RuntimeMcpServerConfig[],
  policy: Awaited<ReturnType<typeof loadProjectMcpPolicy>>,
) {
  const allowed: RuntimeMcpServerConfig[] = [];
  const failures: Array<{ serverId: string; serverName: string; error: string }> = [];
  for (const server of servers) {
    const candidate = isInlineServer(server)
      ? server.config.type === "http" || server.config.type === "sse"
        ? { name: server.name, url: server.config.url }
        : "command" in server.config
          ? { name: server.name, command: server.config.command, args: server.config.args ?? [] }
          : { name: server.name }
      : { name: server.name, command: server.command, args: server.args };
    if (isProjectMcpServerAllowed(policy, candidate)) allowed.push(server);
    else failures.push({
      serverId: server.id,
      serverName: server.name,
      error: `MCP 服务“${server.name}”被管理策略阻止`,
    });
  }
  return { servers: allowed, failures };
}

export function applyProjectMcpCustomizationPolicy(input: {
  restricted: boolean;
  settingsServers: McpServerConfig[];
  pluginSpecs: ProjectAgentMcpServerSpec[];
  agentSpecs?: ProjectAgentMcpServerSpec[];
  agentSource?: "policy" | "project" | "user" | "plugin";
}) {
  const trustedAgentSpecs = !input.restricted || input.agentSource === "policy" || input.agentSource === "plugin"
    ? input.agentSpecs ?? []
    : [];
  return {
    settingsServers: input.restricted ? [] : input.settingsServers,
    specs: [...input.pluginSpecs, ...trustedAgentSpecs],
  };
}

function normalizeInputSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: "object", properties: {}, additionalProperties: true };
  try {
    if (JSON.stringify(value).length <= 50_000) return value;
  } catch {
    // Fall through to a bounded permissive schema for malformed servers.
  }
  return { type: "object", properties: {}, additionalProperties: true };
}

function boundJson(value: unknown) {
  try {
    return JSON.parse(boundText(JSON.stringify(value)));
  } catch {
    return { truncated: true };
  }
}

function boundText(value: string) {
  return value.length <= MAX_MCP_RESULT_CHARACTERS
    ? value
    : `${value.slice(0, MAX_MCP_RESULT_CHARACTERS)}\n… MCP 输出已截断`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesJsonSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) return false;
  if (schema.type === "object") {
    if (!isRecord(value)) return false;
    const required = Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [];
    if (required.some((key) => !(key in value))) return false;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    return Object.entries(value).every(([key, item]) => {
      const itemSchema = properties[key];
      return !isRecord(itemSchema) || matchesJsonSchema(item, itemSchema);
    });
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    return !isRecord(schema.items) || value.every((item) => matchesJsonSchema(item, schema.items as Record<string, unknown>));
  }
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "number") return typeof value === "number" && Number.isFinite(value);
  if (schema.type === "integer") return Number.isSafeInteger(value);
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "null") return value === null;
  return true;
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2_000) : "MCP 服务连接失败";
}
