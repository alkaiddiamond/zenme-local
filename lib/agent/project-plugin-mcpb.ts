import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import AdmZip from "adm-zip";
import type { McpbManifestAny } from "@anthropic-ai/mcpb";

import type { ProjectAgentMcpServerConfig } from "@/lib/agent/project-agent-mcp";
import type { EnabledProjectPlugin } from "@/lib/agent/project-plugin-hooks";
import { loadProjectPluginMcpServerOptions, normalizeProjectPluginOptionSchema, type PluginOptionSchema } from "@/lib/agent/project-plugin-options";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 250 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;

export function isProjectPluginMcpbSource(source: string) {
  const pathname = source.split(/[?#]/, 1)[0]?.toLocaleLowerCase() ?? "";
  return pathname.endsWith(".mcpb") || pathname.endsWith(".dxt");
}

export async function loadProjectPluginMcpbServer(input: {
  projectId: string;
  dataDir: string;
  plugin: EnabledProjectPlugin;
  source: string;
  homeDir?: string;
}): Promise<{ name: string; config: ProjectAgentMcpServerConfig }> {
  const inspected = await inspectProjectPluginMcpb(input);
  const { extractedPath, manifest } = inspected;
  const options = await loadProjectPluginMcpServerOptions(
    input.projectId,
    input.dataDir,
    input.plugin,
    manifest.name,
    manifest.user_config,
    { homeDir: input.homeDir },
  );
  if (options.missing.length) {
    throw new Error(`MCPB“${manifest.name}”缺少必需配置：${options.missing.join("、")}`);
  }

  const { getMcpConfigForManifest } = await import("@anthropic-ai/mcpb");
  const generated = await getMcpConfigForManifest({
    manifest,
    extensionPath: extractedPath,
    systemDirs: systemDirectories(input.homeDir),
    userConfig: options.values,
    pathSeparator: path.sep,
  });
  const config = normalizeGeneratedConfig(generated, manifest, extractedPath);
  return { name: manifest.name, config };
}

export async function inspectProjectPluginMcpb(input: {
  plugin: EnabledProjectPlugin;
  source: string;
}): Promise<{
  extractedPath: string;
  manifest: McpbManifestAny;
  name: string;
  schema: PluginOptionSchema;
}> {
  const archive = await readArchive(input.plugin, input.source);
  const contentHash = createHash("sha256").update(archive).digest("hex").slice(0, 16);
  const cacheRoot = path.join(input.plugin.dataRoot, ".mcpb-cache");
  const extractedPath = path.join(cacheRoot, contentHash);
  await extractArchiveOnce(archive, cacheRoot, extractedPath);
  const manifest = await readManifest(extractedPath);
  assertManifestPlatform(manifest);
  return {
    extractedPath,
    manifest,
    name: manifest.display_name?.trim() || manifest.name,
    schema: normalizeProjectPluginOptionSchema(manifest.user_config),
  };
}

async function readArchive(plugin: EnabledProjectPlugin, source: string) {
  if (/^https?:\/\//i.test(source)) return downloadArchive(source);
  const target = path.resolve(plugin.root, source);
  if (!isInside(plugin.root, target)) throw new Error(`MCPB 路径超出插件目录：${source}`);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error(`MCPB 文件无效或超过 ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB`);
  return fs.readFile(target);
}

async function downloadArchive(source: string, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > MAX_REDIRECTS) throw new Error("MCPB 下载重定向次数过多");
  const url = new URL(source);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("MCPB 仅支持 HTTP(S) 来源");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`MCPB 下载重定向缺少 Location：${response.status}`);
      return downloadArchive(new URL(location, url).toString(), redirectCount + 1);
    }
    if (!response.ok) throw new Error(`MCPB 下载失败：HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredSize) && declaredSize > MAX_ARCHIVE_BYTES) throw new Error("MCPB 下载内容过大");
    if (!response.body) throw new Error("MCPB 下载响应为空");
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buffer = Buffer.from(value);
      total += buffer.length;
      if (total > MAX_ARCHIVE_BYTES) throw new Error("MCPB 下载内容过大");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timeout);
  }
}

async function extractArchiveOnce(archive: Buffer, cacheRoot: string, extractedPath: string) {
  const existing = await fs.stat(path.join(extractedPath, "manifest.json")).catch(() => null);
  if (existing?.isFile()) return;
  await fs.mkdir(cacheRoot, { recursive: true });
  const temporaryPath = path.join(cacheRoot, `.extract-${path.basename(extractedPath)}-${process.pid}-${Date.now()}`);
  await fs.mkdir(temporaryPath, { recursive: false });
  try {
    const zip = new AdmZip(archive);
    const entries = zip.getEntries();
    if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error("MCPB 压缩包条目过多");
    let extractedBytes = 0;
    for (const entry of entries) {
      const relativePath = safeArchivePath(entry.entryName);
      if (!relativePath) continue;
      const mode = (entry.attr >>> 16) & 0xffff;
      if ((mode & 0xf000) === 0xa000) throw new Error(`MCPB 不允许符号链接：${entry.entryName}`);
      const target = path.resolve(temporaryPath, ...relativePath.split("/"));
      if (!isInside(temporaryPath, target)) throw new Error(`MCPB 条目路径无效：${entry.entryName}`);
      if (entry.isDirectory) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }
      extractedBytes += entry.header.size;
      if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error("MCPB 解压后内容过大");
      const content = entry.getData();
      if (content.length !== entry.header.size) throw new Error(`MCPB 条目长度异常：${entry.entryName}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, { flag: "wx" });
      if (process.platform !== "win32" && (mode & 0o111)) await fs.chmod(target, mode & 0o777).catch(() => undefined);
    }
    const manifest = await fs.stat(path.join(temporaryPath, "manifest.json")).catch(() => null);
    if (!manifest?.isFile()) throw new Error("MCPB 缺少根目录 manifest.json");
    await fs.rename(temporaryPath, extractedPath).catch(async (error: unknown) => {
      const targetExists = await fs.stat(extractedPath).catch(() => null);
      if (!targetExists) throw error;
    });
  } finally {
    await fs.rm(temporaryPath, { recursive: true, force: true });
  }
}

async function readManifest(extractedPath: string): Promise<McpbManifestAny> {
  const manifestPath = path.join(extractedPath, "manifest.json");
  const stat = await fs.stat(manifestPath);
  if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error("MCPB manifest.json 无效或过大");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`MCPB manifest.json 不是有效 JSON：${safeMessage(error)}`);
  }
  const { vAny } = await import("@anthropic-ai/mcpb");
  const result = vAny.McpbManifestSchema.safeParse(parsed);
  if (!result.success) throw new Error(`MCPB manifest.json 无效：${result.error.issues.slice(0, 5).map((issue) => issue.message).join("；")}`);
  const entryPoint = path.resolve(extractedPath, result.data.server.entry_point);
  if (!isInside(extractedPath, entryPoint)) throw new Error("MCPB server.entry_point 超出扩展目录");
  return result.data;
}

function normalizeGeneratedConfig(
  generated: McpbManifestAny["server"]["mcp_config"] | undefined,
  manifest: McpbManifestAny,
  extractedPath: string,
): ProjectAgentMcpServerConfig {
  if (!generated?.command) throw new Error(`MCPB“${manifest.name}”无法生成 MCP 服务配置`);
  let command = generated.command;
  if ((command.includes("/") || command.includes("\\")) && !path.isAbsolute(command)) command = path.resolve(extractedPath, command);
  if (manifest.server.type === "binary" && process.platform === "win32" && !path.extname(command)) command += ".exe";
  return {
    type: "stdio",
    command,
    ...(generated.args ? { args: generated.args } : {}),
    ...(generated.env ? { env: generated.env } : {}),
  };
}

function assertManifestPlatform(manifest: McpbManifestAny) {
  const platforms = manifest.compatibility?.platforms;
  if (platforms?.length && !platforms.includes(process.platform as "darwin" | "win32" | "linux")) {
    throw new Error(`MCPB“${manifest.name}”不支持当前平台 ${process.platform}`);
  }
}

function systemDirectories(homeDir = os.homedir()) {
  return {
    HOME: homeDir,
    DESKTOP: path.join(homeDir, "Desktop"),
    DOCUMENTS: path.join(homeDir, "Documents"),
    DOWNLOADS: path.join(homeDir, "Downloads"),
  };
}

function safeArchivePath(value: string) {
  if (!value || value.includes("\0")) throw new Error("MCPB 条目路径无效");
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) throw new Error(`MCPB 条目使用绝对路径：${value}`);
  const segments = normalized.split("/").filter((segment) => segment && segment !== ".");
  if (segments.some((segment) => segment === "..")) throw new Error(`MCPB 条目包含路径穿越：${value}`);
  return segments.join("/");
}

function isInside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
