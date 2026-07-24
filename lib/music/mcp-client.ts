import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;

const globalMusicMcp = globalThis as typeof globalThis & {
  __zenmeMusicMcpClientPromise?: Promise<Client>;
  __zenmeMusicMcpShutdownHooksRegistered?: boolean;
};

export async function musicMcpRequest(requestPath: string, init?: RequestInit) {
  const client = await getMusicMcpClient();
  const method = (init?.method || "GET").toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) as JsonObject : {};
  const match = requestPath.match(/^\/v1\/jobs\/([^/]+)(?:\/(result|cancel|retry|suno-prompt))?$/);

  if (requestPath === "/v1/health" && method === "GET") {
    const tools = await client.listTools();
    return jsonResponse({ status: "ok", protocolVersion: 1, transport: "mcp-stdio", toolCount: tools.tools.length });
  }
  if (requestPath === "/v1/capabilities" && method === "GET") {
    const tools = await client.listTools();
    return jsonResponse({
      analyzers: [{
        id: "zenme-music-mcp",
        version: "1",
        installed: true,
        capabilities: tools.tools.map((tool) => tool.name),
      }],
      modelPackages: [],
      transport: "mcp-stdio",
    });
  }

  if (requestPath === "/v1/jobs" && method === "POST") {
    if (typeof body.inputPath !== "string") throw new Error("MCP 音乐分析缺少本地输入文件");
    return callTool(client, "analyze_music", {
      input_uri: pathToFileURL(body.inputPath).href,
      project_id: typeof body.projectId === "string" ? body.projectId : "zenme-local",
      capabilities: body.capabilities,
      options: body.options,
    });
  }
  if (!match) throw new Error("MCP 音乐服务路径不受支持");
  const jobId = decodeURIComponent(match[1]);
  const action = match[2];
  if (!action && method === "GET") return callTool(client, "get_music_job", { job_id: jobId });
  if (action === "cancel" && method === "POST") return callTool(client, "cancel_music_analysis", { job_id: jobId });
  if (action === "retry" && method === "POST") return callTool(client, "retry_music_analysis", { job_id: jobId });
  if (action === "suno-prompt" && method === "POST") return callTool(client, "generate_suno_prompt", { job_id: jobId });
  if (action === "result" && method === "GET") {
    const result = await client.readResource({ uri: `zenme-music://jobs/${encodeURIComponent(jobId)}/result` });
    const text = result.contents.find((content) => "text" in content)?.text;
    if (typeof text !== "string") throw new Error("MCP 音乐分析结果格式无效");
    return jsonResponse(JSON.parse(text));
  }
  throw new Error("MCP 音乐服务操作不受支持");
}

async function callTool(client: Client, name: string, args: JsonObject) {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  if (result.isError) {
    const message = content.find((item) => isTextContent(item));
    throw new Error(message?.type === "text" ? message.text : `MCP 工具 ${name} 调用失败`);
  }
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return jsonResponse(normalizeToolResult(result.structuredContent));
  }
  const text = content.find((item) => isTextContent(item));
  if (text?.type !== "text") throw new Error(`MCP 工具 ${name} 未返回结构化结果`);
  return jsonResponse(normalizeToolResult(JSON.parse(text.text)));
}

function normalizeToolResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const object = { ...(value as JsonObject) };
  if (typeof object.jobId === "string" && object.id === undefined) object.id = object.jobId;
  return object;
}

function isTextContent(value: unknown): value is { type: "text"; text: string } {
  return Boolean(value) && typeof value === "object" &&
    (value as { type?: unknown }).type === "text" &&
    typeof (value as { text?: unknown }).text === "string";
}

async function getMusicMcpClient() {
  if (!globalMusicMcp.__zenmeMusicMcpClientPromise) {
    registerShutdownHooks();
    globalMusicMcp.__zenmeMusicMcpClientPromise = connectMusicMcp().catch((error) => {
      delete globalMusicMcp.__zenmeMusicMcpClientPromise;
      throw error;
    });
  }
  return globalMusicMcp.__zenmeMusicMcpClientPromise;
}

export async function closeMusicMcpClient() {
  const clientPromise = globalMusicMcp.__zenmeMusicMcpClientPromise;
  delete globalMusicMcp.__zenmeMusicMcpClientPromise;
  if (!clientPromise) return;
  try {
    const client = await clientPromise;
    await client.close();
  } catch {
    // A failed or already-closed stdio session needs no further cleanup.
  }
}

function registerShutdownHooks() {
  if (globalMusicMcp.__zenmeMusicMcpShutdownHooksRegistered) return;
  globalMusicMcp.__zenmeMusicMcpShutdownHooksRegistered = true;
  process.once("SIGINT", () => void closeMusicMcpClient());
  process.once("SIGTERM", () => void closeMusicMcpClient());
  process.once("beforeExit", () => void closeMusicMcpClient());
}

async function connectMusicMcp() {
  const zenmeDataDir = process.env.ZENME_DATA_DIR;
  if (!zenmeDataDir) throw new Error("Zenme 本地数据目录不可用");
  const discovered = discoverMusicMcpCommand();
  const command = process.env.ZENME_MUSIC_MCP_COMMAND || discovered.command;
  const serviceDataDir = process.env.ZENME_MUSIC_MCP_DATA_DIR || path.join(zenmeDataDir, "music-service");
  const commandArgs = process.env.ZENME_MUSIC_MCP_COMMAND_ARGS
    ? parseCommandArgs(process.env.ZENME_MUSIC_MCP_COMMAND_ARGS)
    : discovered.args;
  const args = [...commandArgs, "--data-dir", serviceDataDir, "--allow-path", zenmeDataDir];
  if (process.env.ZENME_MUSIC_MODELS_DIR) args.push("--models-dir", process.env.ZENME_MUSIC_MODELS_DIR);
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const transport = new StdioClientTransport({ command, args, env, stderr: "inherit" });
  const client = new Client({ name: "zenme-local", version: "0.1.0" });
  await client.connect(transport);
  return client;
}

function discoverMusicMcpCommand() {
  const siblingProject = path.resolve(process.cwd(), "..", "zenme-music-service");
  const siblingExecutable = path.join(siblingProject, ".venv", "Scripts", "zenme-music-service.exe");
  if (process.env.NODE_ENV === "development" && existsSync(siblingExecutable)) {
    return { command: siblingExecutable, args: ["mcp", "--stdio"] };
  }
  return { command: "zenme-music-service", args: ["mcp", "--stdio"] };
}

function parseCommandArgs(value: string | undefined) {
  if (!value) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("ZENME_MUSIC_MCP_COMMAND_ARGS 必须是字符串数组 JSON");
  }
  return parsed;
}

function jsonResponse(body: unknown) {
  return Response.json(body, { status: 200 });
}
