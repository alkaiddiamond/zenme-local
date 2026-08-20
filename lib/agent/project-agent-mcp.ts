export type ProjectAgentMcpStdioConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type ProjectAgentMcpRemoteConfig = {
  type: "http" | "sse";
  url: string;
  headers?: Record<string, string>;
};

export type ProjectAgentMcpSdkConfig = {
  type: "sdk";
  name: string;
};

export type ProjectAgentMcpServerConfig =
  | ProjectAgentMcpStdioConfig
  | ProjectAgentMcpRemoteConfig
  | ProjectAgentMcpSdkConfig;

/**
 * cc-haha accepts either the name of an inherited MCP server or an inline,
 * Agent-private server definition. Inline clients live only for that Agent run.
 */
export type ProjectAgentMcpServerSpec =
  | string
  | Record<string, ProjectAgentMcpServerConfig>;

const MAX_AGENT_MCP_SERVERS = 50;
const MAX_ARGUMENTS = 100;
const MAX_ENVIRONMENT_ENTRIES = 200;

export function normalizeProjectAgentMcpServers(value: unknown): ProjectAgentMcpServerSpec[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized: ProjectAgentMcpServerSpec[] = [];
  for (const item of value) {
    if (normalized.length >= MAX_AGENT_MCP_SERVERS) break;
    if (typeof item === "string") {
      const name = item.trim();
      if (isServerName(name)) normalized.push(name);
      continue;
    }
    if (!isRecord(item)) continue;
    const entries = Object.entries(item).flatMap(([name, config]) => {
      const parsed = normalizeConfig(config);
      return isServerName(name) && parsed ? [[name, parsed] as const] : [];
    });
    for (const [name, config] of entries) {
      if (normalized.length >= MAX_AGENT_MCP_SERVERS) break;
      normalized.push({ [name]: config });
    }
  }
  return normalized.length ? normalized : undefined;
}

function normalizeConfig(value: unknown): ProjectAgentMcpServerConfig | null {
  if (!isRecord(value)) return null;
  const type = typeof value.type === "string" ? value.type.trim().toLowerCase() : "stdio";
  if (type === "stdio") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command || command.length > 4_096) return null;
    return {
      type: "stdio",
      command,
      ...(stringArray(value.args, MAX_ARGUMENTS) ? { args: stringArray(value.args, MAX_ARGUMENTS) } : {}),
      ...(stringRecord(value.env, MAX_ENVIRONMENT_ENTRIES) ? { env: stringRecord(value.env, MAX_ENVIRONMENT_ENTRIES) } : {}),
    };
  }
  if (type === "http" || type === "sse") {
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (!isHttpUrl(url)) return null;
    return {
      type,
      url,
      ...(stringRecord(value.headers, MAX_ENVIRONMENT_ENTRIES) ? { headers: stringRecord(value.headers, MAX_ENVIRONMENT_ENTRIES) } : {}),
    };
  }
  if (type === "sdk") {
    const name = typeof value.name === "string" ? value.name.trim() : "";
    return isServerName(name) ? { type, name } : null;
  }
  return null;
}

function isServerName(value: string) {
  return Boolean(value) && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function stringArray(value: unknown, limit: number) {
  if (!Array.isArray(value) || value.length > limit || !value.every((item) => typeof item === "string" && item.length <= 32_768)) return undefined;
  return value as string[];
}

function stringRecord(value: unknown, limit: number) {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value);
  if (entries.length > limit || entries.some(([key, item]) => !key || key.length > 256 || typeof item !== "string" || item.length > 32_768)) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
