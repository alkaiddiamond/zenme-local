import fs from "node:fs/promises";
import path from "node:path";

import type { AgentCallableToolName } from "@/lib/agent/types";
import { getProjectDir } from "@/lib/local/data-dir";

const DEFAULT_PERSISTENCE_THRESHOLD = 100_000;
const PREVIEW_CHARACTERS = 8_000;
const NEVER_PERSIST = new Set<AgentCallableToolName>([
  "read_file",
  "view_image",
  "image_gen",
  "image_edit",
  "browser",
  "shell_command",
  "task_output",
]);

export type PersistedAgentToolResult = {
  persistedOutput: true;
  outputFilePath: string;
  originalSize: number;
  preview: string;
  message: string;
};

/**
 * cc-haha-style generic Tool Result persistence. Tools keep their native
 * result for hooks/UI, while the durable/model-facing result becomes a small
 * preview with an exact file path that Read can consume later.
 */
export async function persistAgentToolResultForModel(input: {
  dataDir: string;
  name: AgentCallableToolName;
  output: unknown;
  projectId: string;
  toolCallId: string;
}) {
  const normalized = normalizeEmptyResult(input.name, input.output);
  if (NEVER_PERSIST.has(input.name)) return normalized;
  const serialized = serializeResult(normalized);
  if (serialized.length <= persistenceThreshold(input.name)) return normalized;

  const directory = path.join(getProjectDir(input.projectId, input.dataDir), "agent-tool-results");
  const outputFilePath = path.join(directory, `${input.toolCallId}.json`);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(outputFilePath, serialized, { encoding: "utf8", flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const preview = previewAtLineBoundary(serialized, PREVIEW_CHARACTERS);
  return {
    persistedOutput: true,
    outputFilePath,
    originalSize: serialized.length,
    preview,
    message: `工具结果过大（${serialized.length} 字符），完整结果已保存到 ${outputFilePath}`,
  } satisfies PersistedAgentToolResult;
}

export function isPersistedAgentToolResult(value: unknown): value is PersistedAgentToolResult {
  return Boolean(value) && typeof value === "object"
    && (value as Record<string, unknown>).persistedOutput === true
    && typeof (value as Record<string, unknown>).outputFilePath === "string";
}

function normalizeEmptyResult(name: AgentCallableToolName, output: unknown) {
  if (output === undefined || output === null || output === "") {
    return `(${name} completed with no output)`;
  }
  if (Array.isArray(output) && output.length === 0) return `(${name} completed with no output)`;
  return output;
}

function serializeResult(output: unknown) {
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

function persistenceThreshold(name: AgentCallableToolName) {
  if (name === "search_files") return 20_000;
  return DEFAULT_PERSISTENCE_THRESHOLD;
}

function previewAtLineBoundary(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  const prefix = value.slice(0, maximum);
  const newline = prefix.lastIndexOf("\n");
  return `${prefix.slice(0, newline > maximum / 2 ? newline : maximum)}\n...`;
}
