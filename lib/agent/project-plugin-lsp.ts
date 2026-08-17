import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

import { buildCommandEnvironment } from "@/lib/agent/command-environment";
import type {
  CodeIntelligenceItem,
  CodeIntelligenceOperation,
  CodeIntelligenceResult,
} from "@/lib/agent/code-intelligence";
import type { CodeDiagnostic } from "@/lib/agent/code-diagnostics";
import { getProjectConfigGeneration } from "@/lib/agent/project-config-generation";
import {
  loadEnabledPluginsForProject,
  type EnabledProjectPlugin,
} from "@/lib/agent/project-plugin-hooks";
import {
  loadProjectPluginOptions,
  substitutePluginUserConfigRuntime,
  type ProjectPluginOptions,
} from "@/lib/agent/project-plugin-options";

const MAX_CONFIG_BYTES = 1_048_576;
const MAX_SERVERS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_RESULT_COUNT = 500;
const MAX_STDERR_BYTES = 32_768;
const DIAGNOSTIC_SETTLE_MS = 50;
const DIAGNOSTIC_WAIT_MS = 750;
const MAX_DIAGNOSTICS_PER_FILE = 10;
const MAX_TOTAL_DIAGNOSTICS = 30;

export type ProjectPluginLspServer = {
  args: string[];
  command: string;
  env: Record<string, string>;
  extensionToLanguage: Record<string, string>;
  id: string;
  initializationOptions?: unknown;
  pluginId: string;
  pluginName: string;
  settings?: unknown;
  startupTimeout: number;
  workspaceFolder?: string;
};

type ManagedLspClient = {
  child: ChildProcessWithoutNullStreams;
  connection: MessageConnection;
  diagnostics: Map<string, LspDiagnostic[]>;
  diagnosticWaiters: Map<string, Set<() => void>>;
  openedDocuments: Map<string, { content: string; version: number }>;
  ready: Promise<void>;
  server: ProjectPluginLspServer;
  stderr: string;
  workspacePath: string;
};

type LspDiagnostic = {
  code?: unknown;
  message: string;
  range: LspRange;
  severity?: number;
  source?: string;
};

export type ProjectPluginLspDiagnosticsResult = {
  available: boolean;
  diagnostics: CodeDiagnostic[];
  failures: string[];
  serverCount: number;
  truncated: boolean;
};

type LspClientStore = { clients: Map<string, ManagedLspClient> };
const globalStore = globalThis as typeof globalThis & { __zenmePluginLspClients?: LspClientStore };
const clientStore = globalStore.__zenmePluginLspClients ?? { clients: new Map() };
globalStore.__zenmePluginLspClients = clientStore;
const serverCache = new Map<string, Promise<ProjectPluginLspServer[]>>();

export async function loadProjectPluginLspServers(
  projectId: string,
  dataDir: string,
  options: { homeDir?: string } = {},
) {
  const generation = getProjectConfigGeneration(projectId, dataDir);
  const key = JSON.stringify([path.resolve(dataDir), projectId, options.homeDir ?? "", generation ?? null]);
  if (generation !== undefined) {
    const cached = serverCache.get(key);
    if (cached) return cached;
  }
  const pending = loadServersUncached(projectId, dataDir, options);
  if (generation !== undefined) {
    serverCache.set(key, pending);
    pending.catch(() => serverCache.delete(key));
    pruneMap(serverCache, 200);
  }
  return pending;
}

async function loadServersUncached(projectId: string, dataDir: string, options: { homeDir?: string }) {
  const result: ProjectPluginLspServer[] = [];
  for (const plugin of await loadEnabledPluginsForProject(projectId, dataDir, options)) {
    const pluginOptions = await loadProjectPluginOptions(projectId, dataDir, plugin, options);
    const sources: unknown[] = [];
    const defaultConfig = await readBoundedJson(path.join(plugin.root, ".lsp.json"));
    if (defaultConfig !== undefined) sources.push(defaultConfig);
    const declarations = plugin.manifest?.lspServers;
    for (const declaration of Array.isArray(declarations) ? declarations : declarations === undefined ? [] : [declarations]) {
      if (typeof declaration === "string") {
        const target = path.resolve(plugin.root, declaration);
        if (isInside(plugin.root, target)) {
          const parsed = await readBoundedJson(target);
          if (parsed !== undefined) sources.push(parsed);
        }
      } else {
        sources.push(declaration);
      }
    }
    const merged = new Map<string, unknown>();
    for (const source of sources) {
      if (!isRecord(source)) continue;
      for (const [name, config] of Object.entries(source)) merged.set(name, config);
    }
    for (const [name, config] of merged) {
      const normalized = normalizePluginLspServer(plugin, pluginOptions, name, config);
      if (normalized) result.push(normalized);
      if (result.length >= MAX_SERVERS) return result;
    }
  }
  return result;
}

export async function queryProjectPluginLspCodeIntelligence(input: {
  character: number;
  dataDir: string;
  filePath: string;
  homeDir?: string;
  line: number;
  maxResults?: number;
  operation: CodeIntelligenceOperation;
  overlay?: string | null;
  projectId: string;
  query?: string;
  rootPath: string;
}): Promise<CodeIntelligenceResult | undefined> {
  const relativeFilePath = normalizeRelativePath(input.filePath);
  const absoluteFilePath = path.resolve(input.rootPath, relativeFilePath);
  if (!isInside(input.rootPath, absoluteFilePath)) throw new Error("LSP 目标越过 Workspace 边界");
  const extension = path.extname(absoluteFilePath).toLowerCase();
  const servers = (await loadProjectPluginLspServers(input.projectId, input.dataDir, { homeDir: input.homeDir }))
    .filter((server) => server.extensionToLanguage[extension]);
  if (!servers.length) return undefined;
  const content = input.overlay === null
    ? null
    : input.overlay ?? await fs.readFile(absoluteFilePath, "utf8");
  if (content === null) {
    return unavailable(input, relativeFilePath, "目标文件已在当前 ChangeSet 中删除");
  }
  const reasons: string[] = [];
  for (const server of servers) {
    try {
      return await queryServer(server, { ...input, absoluteFilePath, content, relativeFilePath });
    } catch (error) {
      reasons.push(`${server.id}: ${errorMessage(error)}`);
    }
  }
  return unavailable(input, relativeFilePath, reasons.join("；") || "插件 LSP 不可用");
}

export async function collectProjectPluginLspDiagnostics(input: {
  dataDir: string;
  homeDir?: string;
  overlays?: Record<string, string | null>;
  projectId: string;
  relativePaths?: string[];
  rootPath: string;
}): Promise<ProjectPluginLspDiagnosticsResult> {
  const relativePaths = [...new Set((input.relativePaths ?? []).map(normalizeRelativePath))].slice(0, 100);
  if (!relativePaths.length) {
    return { available: false, diagnostics: [], failures: [], serverCount: 0, truncated: false };
  }
  const servers = await loadProjectPluginLspServers(input.projectId, input.dataDir, { homeDir: input.homeDir });
  const failures: string[] = [];
  const diagnostics: CodeDiagnostic[] = [];
  const usedServers = new Set<string>();
  const successfulServers = new Set<string>();
  await Promise.all(servers.map(async (server) => {
    const supportedPaths = relativePaths.filter((relativePath) => server.extensionToLanguage[path.extname(relativePath).toLowerCase()]);
    if (!supportedPaths.length) return;
    usedServers.add(server.id);
    try {
      const workspacePath = resolveWorkspaceFolder(input.rootPath, server.workspaceFolder);
      const generation = getProjectConfigGeneration(input.projectId, input.dataDir) ?? -1;
      const key = JSON.stringify([path.resolve(input.dataDir), input.projectId, generation, server.id, workspacePath]);
      const client = await getOrCreateClient(key, server, workspacePath);
      await client.ready;
      const published: Array<{ uri: string; diagnostics: LspDiagnostic[] }> = await Promise.all(supportedPaths.map(async (relativePath) => {
        const absoluteFilePath = path.resolve(input.rootPath, relativePath);
        if (!isInside(input.rootPath, absoluteFilePath)) throw new Error("LSP 诊断目标越过 Workspace 边界");
        const overlay = Object.hasOwn(input.overlays ?? {}, relativePath) ? input.overlays?.[relativePath] : undefined;
        if (overlay === null) return { uri: pathToFileURL(absoluteFilePath).href, diagnostics: [] as LspDiagnostic[] };
        const content = overlay ?? await fs.readFile(absoluteFilePath, "utf8");
        const uri = pathToFileURL(absoluteFilePath).href;
        if (client.openedDocuments.get(uri)?.content === content && client.diagnostics.has(uri)) {
          return { uri, diagnostics: client.diagnostics.get(uri) ?? [] };
        }
        const published = await waitForPublishedDiagnostics(client, uri, async () => {
          await synchronizeDocument(client, uri, content, server.extensionToLanguage[path.extname(relativePath).toLowerCase()], true);
        });
        return { uri, diagnostics: published };
      }));
      successfulServers.add(server.id);
      for (const item of published) {
        diagnostics.push(...item.diagnostics.flatMap((diagnostic) => convertLspDiagnostic(item.uri, diagnostic, input.rootPath, server)));
      }
    } catch (error) {
      failures.push(`${server.id}: ${errorMessage(error)}`);
    }
  }));
  const deduped = dedupeDiagnostics(diagnostics);
  const limited = limitDiagnostics(deduped);
  return {
    available: successfulServers.size > 0,
    diagnostics: limited,
    failures,
    serverCount: usedServers.size,
    truncated: limited.length < deduped.length,
  };
}

async function queryServer(
  server: ProjectPluginLspServer,
  input: Parameters<typeof queryProjectPluginLspCodeIntelligence>[0] & {
    absoluteFilePath: string;
    content: string;
    relativeFilePath: string;
  },
) {
  validatePosition(input.content, input.line, input.character);
  const workspacePath = resolveWorkspaceFolder(input.rootPath, server.workspaceFolder);
  const generation = getProjectConfigGeneration(input.projectId, input.dataDir) ?? -1;
  const key = JSON.stringify([path.resolve(input.dataDir), input.projectId, generation, server.id, workspacePath]);
  const client = await getOrCreateClient(key, server, workspacePath);
  await client.ready;
  const uri = pathToFileURL(input.absoluteFilePath).href;
  await synchronizeDocument(client, uri, input.content, server.extensionToLanguage[path.extname(input.absoluteFilePath).toLowerCase()]);
  const position = { line: input.line - 1, character: input.character - 1 };
  const textDocument = { uri };
  const raw = await withTimeout(executeLspOperation(client.connection, input.operation, {
    position,
    query: input.query,
    textDocument,
  }), server.startupTimeout, `LSP 请求 ${input.operation} 超时`);
  const items = convertLspResult(raw, input.rootPath, input.operation);
  const maxResults = normalizeMaxResults(input.maxResults);
  return {
    available: true,
    filePath: input.relativeFilePath,
    items: items.slice(0, maxResults),
    operation: input.operation,
    truncated: items.length > maxResults,
  } satisfies CodeIntelligenceResult;
}

async function executeLspOperation(
  connection: MessageConnection,
  operation: CodeIntelligenceOperation,
  input: { position: { line: number; character: number }; query?: string; textDocument: { uri: string } },
): Promise<unknown> {
  const atPosition = { textDocument: input.textDocument, position: input.position };
  switch (operation) {
    case "goToDefinition": return connection.sendRequest("textDocument/definition", atPosition);
    case "findReferences": return connection.sendRequest("textDocument/references", { ...atPosition, context: { includeDeclaration: true } });
    case "hover": return connection.sendRequest("textDocument/hover", atPosition);
    case "documentSymbol": return connection.sendRequest("textDocument/documentSymbol", input.textDocument);
    case "workspaceSymbol": return connection.sendRequest("workspace/symbol", { query: input.query ?? "" });
    case "goToImplementation": return connection.sendRequest("textDocument/implementation", atPosition);
    case "prepareCallHierarchy": return connection.sendRequest("textDocument/prepareCallHierarchy", atPosition);
    case "incomingCalls":
    case "outgoingCalls": {
      const prepared = await connection.sendRequest<unknown>("textDocument/prepareCallHierarchy", atPosition);
      const item = Array.isArray(prepared) ? prepared[0] : prepared;
      if (!item) return [];
      return connection.sendRequest(operation === "incomingCalls" ? "callHierarchy/incomingCalls" : "callHierarchy/outgoingCalls", { item });
    }
  }
}

async function getOrCreateClient(key: string, server: ProjectPluginLspServer, workspacePath: string) {
  const existing = clientStore.clients.get(key);
  if (existing && !existing.child.killed && existing.child.exitCode === null) return existing;
  if (existing) disposeClient(existing);
  const child = spawn(server.command, server.args, {
    cwd: workspacePath,
    env: { ...buildCommandEnvironment(), ...server.env },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin));
  const client: ManagedLspClient = {
    child,
    connection,
    diagnostics: new Map(),
    diagnosticWaiters: new Map(),
    openedDocuments: new Map(),
    ready: Promise.resolve(),
    server,
    stderr: "",
    workspacePath,
  };
  child.stderr.setEncoding("utf8");
  connection.onNotification("textDocument/publishDiagnostics", (params: unknown) => {
    if (!isRecord(params) || typeof params.uri !== "string" || !Array.isArray(params.diagnostics)) return;
    const absolutePath = uriToFilePath(params.uri);
    if (!absolutePath || !isInside(workspacePath, absolutePath)) return;
    const diagnostics = params.diagnostics.filter(isLspDiagnostic);
    client.diagnostics.set(params.uri, diagnostics);
    for (const resolve of client.diagnosticWaiters.get(params.uri) ?? []) resolve();
    client.diagnosticWaiters.delete(params.uri);
  });
  child.stderr.on("data", (chunk: string) => {
    client.stderr = `${client.stderr}${chunk}`.slice(-MAX_STDERR_BYTES);
  });
  child.once("exit", () => {
    if (clientStore.clients.get(key) === client) clientStore.clients.delete(key);
    connection.dispose();
  });
  connection.listen();
  const workspaceUri = pathToFileURL(workspacePath).href;
  client.ready = withTimeout((async () => {
    await waitForSpawn(child, () => client.stderr);
    await connection.sendRequest("initialize", {
      processId: process.pid,
      initializationOptions: server.initializationOptions ?? {},
      rootPath: workspacePath,
      rootUri: workspaceUri,
      workspaceFolders: [{ uri: workspaceUri, name: path.basename(workspacePath) }],
      capabilities: {
        workspace: { configuration: false, workspaceFolders: false, symbol: {} },
        textDocument: {
          synchronization: { dynamicRegistration: false, didSave: true },
          publishDiagnostics: { relatedInformation: true, versionSupport: true },
          callHierarchy: { dynamicRegistration: false },
          definition: { dynamicRegistration: false, linkSupport: true },
          documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
          hover: { dynamicRegistration: false, contentFormat: ["markdown", "plaintext"] },
          implementation: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
        },
      },
    });
    connection.sendNotification("initialized", {});
    if (server.settings !== undefined) {
      connection.sendNotification("workspace/didChangeConfiguration", { settings: server.settings });
    }
  })(), server.startupTimeout, `LSP ${server.id} 初始化超时`).catch((error) => {
    disposeClient(client);
    throw new Error(`${errorMessage(error)}${client.stderr.trim() ? `: ${client.stderr.trim()}` : ""}`);
  });
  clientStore.clients.set(key, client);
  pruneClients();
  return client;
}

async function synchronizeDocument(
  client: ManagedLspClient,
  uri: string,
  content: string,
  languageId: string,
  save = false,
) {
  const previous = client.openedDocuments.get(uri);
  if (!previous) {
    await client.connection.sendNotification("textDocument/didOpen", {
      textDocument: { uri, languageId, version: 1, text: content },
    });
    client.openedDocuments.set(uri, { content, version: 1 });
  } else if (previous.content !== content) {
    const version = previous.version + 1;
    await client.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
    client.openedDocuments.set(uri, { content, version });
  }
  if (save) await client.connection.sendNotification("textDocument/didSave", { textDocument: { uri }, text: content });
}

async function waitForPublishedDiagnostics(
  client: ManagedLspClient,
  uri: string,
  notify: () => Promise<void>,
): Promise<LspDiagnostic[]> {
  client.diagnostics.delete(uri);
  let resolveNotification!: () => void;
  const notification = new Promise<void>((resolve) => { resolveNotification = resolve; });
  const waiters = client.diagnosticWaiters.get(uri) ?? new Set();
  waiters.add(resolveNotification);
  client.diagnosticWaiters.set(uri, waiters);
  try {
    await notify();
    await Promise.race([notification.then(() => delay(DIAGNOSTIC_SETTLE_MS)), delay(DIAGNOSTIC_WAIT_MS)]);
    return client.diagnostics.get(uri) ?? [];
  } finally {
    waiters.delete(resolveNotification);
    if (!waiters.size) client.diagnosticWaiters.delete(uri);
  }
}

function convertLspDiagnostic(
  uri: string,
  diagnostic: LspDiagnostic,
  rootPath: string,
  server: ProjectPluginLspServer,
): CodeDiagnostic[] {
  const absolutePath = uriToFilePath(uri);
  if (!absolutePath || !isInside(rootPath, absolutePath)) return [];
  const code = typeof diagnostic.code === "string" || typeof diagnostic.code === "number" ? diagnostic.code : server.id;
  return [{
    code,
    column: diagnostic.range.start.character + 1,
    file: path.relative(rootPath, absolutePath).split(path.sep).join("/"),
    line: diagnostic.range.start.line + 1,
    message: diagnostic.message,
    severity: lspSeverity(diagnostic.severity),
    source: diagnostic.source ?? server.id,
  }];
}

function isLspDiagnostic(value: unknown): value is LspDiagnostic {
  return isRecord(value) && typeof value.message === "string" && isRange(value.range)
    && (value.severity === undefined || Number.isSafeInteger(value.severity));
}

function lspSeverity(value?: number): CodeDiagnostic["severity"] {
  if (value === 1) return "error";
  if (value === 2) return "warning";
  if (value === 3) return "message";
  return "suggestion";
}

function dedupeDiagnostics(diagnostics: CodeDiagnostic[]) {
  return [...new Map(diagnostics.map((diagnostic) => [JSON.stringify([
    diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.message,
    diagnostic.severity, diagnostic.source, diagnostic.code,
  ]), diagnostic])).values()];
}

function limitDiagnostics(diagnostics: CodeDiagnostic[]) {
  const ordered = [...diagnostics].sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
  const perFile = new Map<string, number>();
  let total = 0;
  return ordered.filter((diagnostic) => {
    if (total >= MAX_TOTAL_DIAGNOSTICS) return false;
    const file = diagnostic.file ?? ".";
    const count = perFile.get(file) ?? 0;
    if (count >= MAX_DIAGNOSTICS_PER_FILE) return false;
    perFile.set(file, count + 1);
    total += 1;
    return true;
  }).slice(0, MAX_TOTAL_DIAGNOSTICS);
}

function severityRank(severity: CodeDiagnostic["severity"]) {
  return severity === "error" ? 1 : severity === "warning" ? 2 : severity === "message" ? 3 : 4;
}

function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

function normalizePluginLspServer(plugin: EnabledProjectPlugin, options: ProjectPluginOptions, name: string, value: unknown): ProjectPluginLspServer | null {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(name) || !isRecord(value)) return null;
  const command = resolvePluginString(value.command, plugin, options);
  if (!command || command.includes("\u0000") || command.length > 4_096) return null;
  const args = Array.isArray(value.args) ? value.args.map((item) => resolvePluginString(item, plugin, options)) : [];
  if (args.some((item) => item === null || item.length > 32_768) || args.length > 100) return null;
  if (!isRecord(value.extensionToLanguage)) return null;
  const extensionToLanguage = Object.fromEntries(Object.entries(value.extensionToLanguage).flatMap(([extension, language]) => {
    if (!/^\.[A-Za-z0-9._+-]{1,32}$/.test(extension) || typeof language !== "string" || !language.trim()) return [];
    return [[extension.toLowerCase(), language.trim()]];
  }));
  if (!Object.keys(extensionToLanguage).length || (value.transport !== undefined && value.transport !== "stdio")) return null;
  const env = isRecord(value.env) ? Object.fromEntries(Object.entries(value.env).flatMap(([key, item]) => {
    const resolved = resolvePluginString(item, plugin, options);
    return /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) && resolved !== null ? [[key, resolved]] : [];
  })) : {};
  const workspaceFolder = resolvePluginString(value.workspaceFolder, plugin, options) ?? undefined;
  return {
    args: args as string[],
    command,
    env: { CLAUDE_PLUGIN_ROOT: plugin.root, CLAUDE_PLUGIN_DATA: plugin.dataRoot, ...env },
    extensionToLanguage,
    id: `plugin:${plugin.name}:${name}`,
    initializationOptions: value.initializationOptions,
    pluginId: plugin.id,
    pluginName: plugin.name,
    settings: value.settings,
    startupTimeout: normalizeTimeout(value.startupTimeout),
    ...(workspaceFolder ? { workspaceFolder } : {}),
  };
}

function resolvePluginString(value: unknown, plugin: EnabledProjectPlugin, options: ProjectPluginOptions): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let resolved = value
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", plugin.root)
    .replaceAll("${CLAUDE_PLUGIN_DATA}", plugin.dataRoot);
  try { resolved = substitutePluginUserConfigRuntime(resolved, options); } catch { return null; }
  resolved = resolved
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => process.env[key] ?? "");
  return resolved.includes("\u0000") ? null : resolved;
}

function convertLspResult(raw: unknown, rootPath: string, operation: CodeIntelligenceOperation) {
  if (operation === "hover") {
    if (!isRecord(raw)) return [];
    const range = isRange(raw.range) ? raw.range : emptyRange();
    return [{ ...rangeItem(rootPath, "", range), display: markupText(raw.contents) }].filter(validItem);
  }
  const values = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const items = values.flatMap((value) => convertLspValue(value, rootPath));
  return dedupeItems(items);
}

function convertLspValue(value: unknown, rootPath: string): CodeIntelligenceItem[] {
  if (!isRecord(value)) return [];
  if (isRecord(value.from) && isRecord(value.to)) {
    return [...convertLspValue(value.from, rootPath), ...convertLspValue(value.to, rootPath)];
  }
  if (isRecord(value.item)) return convertLspValue(value.item, rootPath);
  const uri = typeof value.uri === "string" ? value.uri : typeof value.targetUri === "string" ? value.targetUri : "";
  const range = isRange(value.range) ? value.range : isRange(value.targetSelectionRange) ? value.targetSelectionRange : isRange(value.selectionRange) ? value.selectionRange : null;
  if (uri && range) {
    const item = rangeItem(rootPath, uri, range, value);
    return validItem(item) ? [item] : [];
  }
  if (range && typeof value.name === "string") {
    const item = rangeItem(rootPath, "", range, value);
    const children = Array.isArray(value.children) ? value.children.flatMap((child) => convertLspValue(child, rootPath)) : [];
    return validItem(item) ? [item, ...children] : children;
  }
  return [];
}

function rangeItem(rootPath: string, uri: string, range: LspRange, metadata: Record<string, unknown> = {}): CodeIntelligenceItem {
  const absolute = uri ? uriToFilePath(uri) : "";
  const file = absolute && isInside(rootPath, absolute) ? path.relative(rootPath, absolute).split(path.sep).join("/") : ".";
  return {
    column: range.start.character + 1,
    endColumn: range.end.character + 1,
    endLine: range.end.line + 1,
    file,
    line: range.start.line + 1,
    ...(typeof metadata.name === "string" ? { name: metadata.name } : {}),
    ...(metadata.kind !== undefined ? { kind: String(metadata.kind) } : {}),
    ...(typeof metadata.detail === "string" ? { display: metadata.detail } : {}),
  };
}

function validItem(item: CodeIntelligenceItem) { return item.file === "." || !item.file.startsWith("../"); }
function uriToFilePath(uri: string) { try { return fileURLToPath(uri); } catch { return ""; } }
function markupText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(markupText).filter(Boolean).join("\n\n");
  if (isRecord(value) && typeof value.value === "string") return value.value;
  if (isRecord(value) && typeof value.language === "string" && typeof value.value === "string") return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
  return "";
}

type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } };
function isRange(value: unknown): value is LspRange {
  return isRecord(value) && isPosition(value.start) && isPosition(value.end);
}
function isPosition(value: unknown): value is { line: number; character: number } {
  return isRecord(value) && Number.isSafeInteger(value.line) && Number.isSafeInteger(value.character);
}
function emptyRange(): LspRange { return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }; }

async function waitForSpawn(child: ChildProcessWithoutNullStreams, stderr: () => string) {
  if (child.pid) return;
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => reject(new Error(`${error.message}${stderr().trim() ? `: ${stderr().trim()}` : ""}`)));
  });
}

function disposeClient(client: ManagedLspClient) {
  client.connection.dispose();
  if (!client.child.killed && client.child.exitCode === null) client.child.kill();
}

function pruneClients() {
  while (clientStore.clients.size > 20) {
    const oldest = clientStore.clients.entries().next().value as [string, ManagedLspClient] | undefined;
    if (!oldest) break;
    clientStore.clients.delete(oldest[0]);
    disposeClient(oldest[1]);
  }
}

export function resetProjectPluginLspForTests() {
  for (const client of clientStore.clients.values()) disposeClient(client);
  clientStore.clients.clear();
  serverCache.clear();
}

export function disposeProjectPluginLspClients(projectId: string, dataDir: string) {
  const resolvedDataDir = path.resolve(dataDir);
  for (const [key, client] of clientStore.clients) {
    let identity: unknown;
    try { identity = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(identity) || identity[0] !== resolvedDataDir || identity[1] !== projectId) continue;
    clientStore.clients.delete(key);
    disposeClient(client);
  }
}

function resolveWorkspaceFolder(rootPath: string, configured?: string) {
  if (!configured) return path.resolve(rootPath);
  const resolved = path.isAbsolute(configured) ? path.resolve(configured) : path.resolve(rootPath, configured);
  if (!isInside(rootPath, resolved)) throw new Error("插件 LSP workspaceFolder 越过 Workspace 边界");
  return resolved;
}

function validatePosition(content: string, line: number, character: number) {
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(character) || character < 1) throw new Error("LSP 位置必须使用从 1 开始的有效行列号");
  const lines = content.split(/\r?\n/);
  if (line > lines.length || character > (lines[line - 1]?.length ?? 0) + 1) throw new Error("LSP 位置超出目标文件范围");
}

function normalizeRelativePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) throw new Error("LSP 路径必须是 Workspace 内的相对路径");
  return normalized;
}

function normalizeMaxResults(value?: number) {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULT_COUNT) throw new Error("LSP 结果上限无效");
  return value;
}

function normalizeTimeout(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Math.min(Number(value), MAX_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

async function readBoundedJson(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return undefined;
    return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) return undefined;
    throw error;
  }
}

function unavailable(input: { operation: CodeIntelligenceOperation }, filePath: string, reason: string): CodeIntelligenceResult {
  return { available: false, filePath, items: [], operation: input.operation, reason, truncated: false };
}

function dedupeItems(items: CodeIntelligenceItem[]) {
  return [...new Map(items.map((item) => [`${item.file}:${item.line}:${item.column}:${item.endLine}:${item.endColumn}:${item.name ?? ""}`, item])).values()];
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then((value) => { clearTimeout(timeout); resolve(value); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}

function pruneMap(map: Map<string, unknown>, maximum: number) {
  while (map.size > maximum) {
    const key = map.keys().next().value;
    if (typeof key !== "string") break;
    map.delete(key);
  }
}

function isInside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
