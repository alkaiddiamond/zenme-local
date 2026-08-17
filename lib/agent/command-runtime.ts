import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import type { AgentCommandRequest } from "@/lib/agent/types";
import { buildCommandEnvironment } from "@/lib/agent/command-environment";
import {
  addAgentCommandRequest,
  AgentExecutionError,
  getAgentExecution,
  listAgentExecutions,
  updateAgentCommandRequest,
} from "@/lib/agent/execution-store";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { addLocalWorkspaceRoot, getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import {
  canUseWorkspaceRootCapability,
  listWorkspaceRoots,
  resolveWorkspaceRoot,
  type WorkspaceBinding,
  type WorkspaceResolvedRoot,
} from "@/lib/workspace/types";
import { inspectWorkspaceRoot, resolveExistingWorkspacePath, workspaceIdentityMatches } from "@/lib/workspace/workspace-inspection";
import { decodeCommandOutput } from "@/lib/agent/command-output-decoder";
import { resolvePowerShellExecutable } from "@/lib/agent/powershell-runtime";
import { analyzePowerShellCommand, type PowerShellCommandAnalysis } from "@/lib/agent/powershell-command-analysis";

type CommandRuntimeState = {
  commandCompletions: Map<string, Promise<AgentCommandRequest>>;
  instanceId: string;
  runningCommands: Map<string, ChildProcess>;
  runningCommandOutput: Map<string, CommandOutput>;
  outputFileWrites: Map<string, Promise<void>>;
  outputPersistTimers: Map<string, ReturnType<typeof setTimeout>>;
  stoppedCommandKeys: Set<string>;
};
const commandRuntimeKey = Symbol.for("zenme.agent-command-runtime");
const existingCommandRuntime = Reflect.get(globalThis, commandRuntimeKey) as CommandRuntimeState | undefined;
const commandRuntime = existingCommandRuntime ?? {
  commandCompletions: new Map<string, Promise<AgentCommandRequest>>(),
  instanceId: process.env.ZENME_SERVER_INSTANCE_ID ?? crypto.randomUUID(),
  runningCommands: new Map<string, ChildProcess>(),
  runningCommandOutput: new Map<string, CommandOutput>(),
  outputFileWrites: new Map<string, Promise<void>>(),
  outputPersistTimers: new Map<string, ReturnType<typeof setTimeout>>(),
  stoppedCommandKeys: new Set<string>(),
};
if (!existingCommandRuntime) Reflect.set(globalThis, commandRuntimeKey, commandRuntime);
commandRuntime.instanceId ??= process.env.ZENME_SERVER_INSTANCE_ID ?? crypto.randomUUID();
commandRuntime.commandCompletions ??= new Map<string, Promise<AgentCommandRequest>>();
commandRuntime.outputPersistTimers ??= new Map<string, ReturnType<typeof setTimeout>>();
commandRuntime.outputFileWrites ??= new Map<string, Promise<void>>();
const { commandCompletions, runningCommands, runningCommandOutput, outputFileWrites, outputPersistTimers, stoppedCommandKeys } = commandRuntime;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_PERSISTED_OUTPUT_BYTES = 64 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const FOREGROUND_COMMAND_BUDGET_MS = 15_000;
const COMMAND_PROGRESS_THRESHOLD_MS = 2_000;
const COMMAND_PROGRESS_THROTTLE_MS = 250;
const COMMAND_STALL_CHECK_INTERVAL_MS = 5_000;
const COMMAND_STALL_THRESHOLD_MS = 45_000;
const COMMAND_STALL_TAIL_CHARS = 1_024;
const INTERACTIVE_PROMPT_PATTERNS = [
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /\(yes\/no\)/i,
  /\b(?:Do you|Would you|Shall I|Are you sure|Ready to)\b.*\?\s*$/i,
  /Press (?:any key|Enter)/i,
  /Continue\?/i,
  /Overwrite\?/i,
];

export class AgentCommandError extends Error {
  constructor(
    message: string,
    readonly code:
      | "workspace_unavailable"
      | "execute_not_allowed"
      | "git_write_not_allowed"
      | "invalid_command"
      | "command_not_found"
      | "approval_required"
      | "external_workspace_approval_required"
      | "invalid_status",
  ) {
    super(message);
    this.name = "AgentCommandError";
  }
}

export type AgentCommandProposalInput = {
  cwd?: string;
  executionId: string;
  projectId: string;
  rootId?: string;
  reason: string;
  shell?: "bash" | "powershell";
  timeoutMs?: number;
  background?: boolean;
} & (
  | { command: string; executable?: never; args?: never }
  | { command?: never; executable: string; args: string[] }
);

export type AgentCommandProgress = {
  commandId: string;
  elapsedMs: number;
  outputFilePath?: string;
  stderr: string;
  stdout: string;
};

export type AgentCommandStall = {
  commandId: string;
  elapsedMs: number;
  outputFilePath?: string;
  tail: string;
};

export function looksLikeInteractiveCommandPrompt(value: string) {
  const lastLine = value.trimEnd().split(/\r?\n/).at(-1) ?? "";
  return INTERACTIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(lastLine));
}

export function isAgentCommandAutoBackgroundAllowed(value: string) {
  const firstWord = value.trim().split(/\s+/)[0]?.toLowerCase();
  return firstWord !== "sleep" && firstWord !== "start-sleep";
}

async function inspectAgentCommandProposalInternal(input: AgentCommandProposalInput, dataDir: string) {
  const binding = await requireReadableBinding(input.projectId, dataDir);
  const invocation = normalizeCommandProtocol(input);
  const requestedCwd = input.cwd ?? ".";
  const resolved = await resolveCommandDirectory(binding, requestedCwd, input.rootId);
  const cwd = resolved.cwd;
  const cwdPath = resolved.cwdPath;
  if (!(await fs.stat(cwdPath)).isDirectory()) {
    throw new AgentCommandError("命令工作目录无效", "invalid_command");
  }
  const commandPolicy = await validateCommand(cwdPath, invocation.executable, invocation.args, invocation.command);
  const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
  if (!detail) throw new AgentExecutionError("Agent Execution 不存在", "execution_not_found");
  if (detail.context.workspaceRootId && resolved.root?.id !== detail.context.workspaceRootId) {
    throw new AgentCommandError("命令工作目录超出 Sub-agent 分配的 Workspace Root", "invalid_command");
  }
  if (commandPolicy.requiresGitWrite && resolved.root && !canUseWorkspaceRootCapability(resolved.root, "gitWrite")) {
    throw new AgentCommandError("Workspace Root 未授权 Git 写操作", "git_write_not_allowed");
  }
  if (commandPolicy.requiresGitWrite && !resolved.root) {
    commandPolicy.requiresExplicitApproval = true;
  }
  const prefixes = detail.context.allowedPathPrefixes ?? [];
  if (prefixes.length > 0 && !prefixes.includes(".") && !prefixes.some((prefix) =>
    cwd === prefix || cwd.startsWith(`${prefix}/`))) {
    throw new AgentCommandError("命令工作目录超出 Sub-agent 任务范围", "invalid_command");
  }
  return { commandPolicy, cwd, invocation, resolved };
}

export async function inspectAgentCommandProposal(input: AgentCommandProposalInput, dataDir = getZenmeDataDir()) {
  const inspected = await inspectAgentCommandProposalInternal(input, dataDir);
  return {
    externalRoot: Boolean(inspected.resolved.externalRoot),
    requiresExplicitApproval: inspected.commandPolicy.requiresExplicitApproval,
  };
}

export async function proposeAgentCommand(input: AgentCommandProposalInput, dataDir = getZenmeDataDir()) {
  const { commandPolicy, cwd, invocation, resolved } = await inspectAgentCommandProposalInternal(input, dataDir);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const command: AgentCommandRequest = {
    id,
    ...("root" in resolved && resolved.root ? { rootId: resolved.root.id } : {}),
    executable: invocation.executable,
    args: invocation.args,
    ...(invocation.command ? { command: invocation.command } : {}),
    cwd,
    timeoutMs: normalizeTimeout(input.timeoutMs),
    reason: input.reason.trim().slice(0, 2_000),
    background: input.background === true,
    outputFilePath: agentTaskOutputPath(dataDir, input.projectId, id),
    requiresExplicitApproval: commandPolicy.requiresExplicitApproval,
    requiresGitWrite: commandPolicy.requiresGitWrite,
    sandboxMode: commandPolicy.requiresExplicitApproval ? "danger-full-access" : "workspace-write",
    status: "proposed",
    createdAt: now,
    updatedAt: now,
    ...(resolved.externalRoot ? { externalRoot: resolved.externalRoot } : {}),
  };
  await addAgentCommandRequest(input.projectId, input.executionId, command, dataDir);
  return command;
}

export async function approveAgentCommand(
  projectId: string,
  executionId: string,
  commandId: string,
  dataDir = getZenmeDataDir(),
  scope: "once" | "project" = "once",
) {
  const current = await getAgentExecution(projectId, executionId, dataDir);
  const requested = current ? requireCommand(current.commandRequests, commandId) : null;
  if (!requested) throw new AgentExecutionError("Agent Execution 不存在", "execution_not_found");
  if (requested.status !== "proposed") {
    throw new AgentCommandError("命令不处于待批准状态", "invalid_status");
  }
  if (scope === "project" && requested.externalRoot) {
    await addLocalWorkspaceRoot({ projectId, rootPath: requested.externalRoot.rootPath }, dataDir);
  }
  const detail = await updateAgentCommandRequest(projectId, executionId, commandId, (command) => {
    if (command.status !== "proposed") {
      throw new AgentCommandError("命令不处于待批准状态", "invalid_status");
    }
    const now = new Date().toISOString();
    command.status = "approved";
    command.approvedAt = now;
    command.updatedAt = now;
    command.approvalScope = scope;
  }, dataDir);
  return requireCommand(detail.commandRequests, commandId);
}

export async function rejectAgentCommand(
  projectId: string,
  executionId: string,
  commandId: string,
  dataDir = getZenmeDataDir(),
) {
  const current = await getAgentExecution(projectId, executionId, dataDir);
  const requested = current ? requireCommand(current.commandRequests, commandId) : null;
  if (!requested) throw new AgentExecutionError("Agent Execution 不存在", "execution_not_found");
  if (requested.status !== "proposed") {
    throw new AgentCommandError("命令不处于待批准状态", "invalid_status");
  }
  const detail = await updateAgentCommandRequest(projectId, executionId, commandId, (command) => {
    if (command.status !== "proposed") {
      throw new AgentCommandError("命令不处于待批准状态", "invalid_status");
    }
    const now = new Date().toISOString();
    command.status = "rejected";
    command.error = "用户拒绝执行命令";
    command.completedAt = now;
    command.updatedAt = now;
  }, dataDir);
  return requireCommand(detail.commandRequests, commandId);
}

export async function runApprovedAgentCommand(input: {
  allowSandboxedWithoutExecutePermission?: boolean;
  commandId: string;
  executionId: string;
  foregroundBudgetMs?: number;
  projectId: string;
  signal?: AbortSignal;
  onProgress?: (progress: AgentCommandProgress) => Promise<void> | void;
  onStall?: (stall: AgentCommandStall) => Promise<void> | void;
  /** Internal test/runtime tuning; not part of the model-visible Shell schema. */
  stallCheckIntervalMs?: number;
  /** Internal test/runtime tuning; not part of the model-visible Shell schema. */
  stallThresholdMs?: number;
  stdin?: string;
  /** Internal, non-persisted environment additions for trusted runtimes such as enabled plugin hooks. */
  environment?: Record<string, string>;
}, dataDir = getZenmeDataDir()) {
  const binding = await requireReadableBinding(input.projectId, dataDir);
  const detail = await getAgentExecution(input.projectId, input.executionId, dataDir);
  if (!detail) throw new AgentExecutionError("Agent Execution 不存在", "execution_not_found");
  const command = requireCommand(detail.commandRequests, input.commandId);
  if (command.status !== "approved") {
    throw new AgentCommandError("命令需要用户批准且只能执行一次", "approval_required");
  }
  const { cwdPath, root } = await resolveApprovedCommandDirectory(binding, command);
  const commandPolicy = await validateCommand(cwdPath, command.executable, command.args, command.command);
  if (commandPolicy.requiresGitWrite &&
      !(command.externalRoot && command.approvalScope === "once") &&
      !canUseWorkspaceRootCapability(root, "gitWrite")) {
    throw new AgentCommandError("Workspace Root 的 Git 写操作授权已关闭", "git_write_not_allowed");
  }

  const now = new Date().toISOString();
  await updateAgentCommandRequest(input.projectId, input.executionId, command.id, (current) => {
    current.status = "running";
    current.startedAt = now;
    current.runtimeInstanceId = commandRuntime.instanceId;
    current.updatedAt = now;
  }, dataDir);

  let child: ChildProcess;
  try {
    if (command.outputFilePath) {
      await fs.mkdir(path.dirname(command.outputFilePath), { recursive: true });
      await fs.writeFile(command.outputFilePath, "", "utf8");
    }

    const invocation = await commandInvocation(command.executable, command.args);
    // Match cc-haha's native Windows behavior: PowerShell commands are not
    // wrapped in a second, product-specific process sandbox. Workspace roots,
    // command validation and the session approval policy remain the security
    // boundary. POSIX platforms may still report their platform sandbox here.
    const sandboxBackend: AgentCommandRequest["sandboxBackend"] =
      command.sandboxMode === "workspace-write" && process.platform !== "win32"
        ? "platform-default"
        : "none";
    await updateAgentCommandRequest(input.projectId, input.executionId, command.id, (current) => {
      current.sandboxBackend = sandboxBackend;
      current.updatedAt = new Date().toISOString();
    }, dataDir);
    child = spawn(invocation.executable, invocation.args, {
      cwd: cwdPath,
      env: {
        ...buildCommandEnvironment(invocation.executable),
        ...sanitizeCommandEnvironment(input.environment),
      },
      shell: false,
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法创建本地命令进程";
    const completedAt = new Date().toISOString();
    await updateAgentCommandRequest(input.projectId, input.executionId, command.id, (current) => {
      if (current.status !== "running") return;
      current.status = "failed";
      current.error = message.slice(0, 2_000);
      current.completedAt = completedAt;
      current.updatedAt = completedAt;
    }, dataDir).catch(() => undefined);
    if (error instanceof AgentCommandError) throw error;
    const code = error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "command_not_found"
      : "invalid_command";
    throw new AgentCommandError(`命令启动失败：${message}`, code);
  }
  if (input.stdin !== undefined) child.stdin?.end(input.stdin, "utf8");
  const key = runtimeKey(input.projectId, input.executionId, command.id);
  runningCommands.set(key, child);
  const output: CommandOutput = {
    stdout: [],
    stderr: [],
    stdoutBytes: 0,
    stderrBytes: 0,
    outputFileBytes: 0,
    outputOverflow: false,
    outputFileOverflow: false,
  };
  runningCommandOutput.set(key, output);
  const outputRoots = [binding.realPath, ...(binding.additionalRoots ?? []).map((root) => root.realPath), command.externalRoot?.realPath]
    .filter((root): root is string => Boolean(root));
  const progressStartedAt = Date.now();
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let lastProgressAt = 0;
  let progressWrite = Promise.resolve();
  let lastOutputGrowthAt = Date.now();
  let stallNotified = false;
  let stallWrite = Promise.resolve();
  const queueProgress = () => {
    if (!input.onProgress) return;
    const now = Date.now();
    const elapsedMs = now - progressStartedAt;
    if (elapsedMs < COMMAND_PROGRESS_THRESHOLD_MS) {
      progressTimer ??= setTimeout(() => {
        progressTimer = undefined;
        queueProgress();
      }, COMMAND_PROGRESS_THRESHOLD_MS - elapsedMs);
      return;
    }
    const throttleRemaining = COMMAND_PROGRESS_THROTTLE_MS - (now - lastProgressAt);
    if (throttleRemaining > 0) {
      progressTimer ??= setTimeout(() => {
        progressTimer = undefined;
        queueProgress();
      }, throttleRemaining);
      return;
    }
    lastProgressAt = now;
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = undefined;
    const progress = {
      commandId: command.id,
      elapsedMs,
      ...(command.outputFilePath ? { outputFilePath: command.outputFilePath } : {}),
      stdout: sanitizeOutput(decodeCommandOutput(output.stdout, { final: false }), outputRoots),
      stderr: sanitizeOutput(decodeCommandOutput(output.stderr, { final: false }), outputRoots),
    };
    progressWrite = progressWrite.catch(() => undefined).then(() => input.onProgress?.(progress)).then(() => undefined, () => undefined);
  };
  queueProgress();
  const scheduleOutputPersistence = () => {
    if (outputPersistTimers.has(key)) return;
    outputPersistTimers.set(key, setTimeout(() => {
      outputPersistTimers.delete(key);
      void persistRunningCommandOutput(input.projectId, input.executionId, command.id, output, outputRoots, command.outputFilePath, key, dataDir);
    }, 500));
  };
  child.stdout?.on("data", (chunk: Buffer | string) => {
    lastOutputGrowthAt = Date.now();
    if (output.stdoutBytes + byteLength(chunk) > MAX_OUTPUT_BYTES) output.outputOverflow = true;
    output.stdoutBytes = appendBounded(output.stdout, output.stdoutBytes, chunk);
    if (command.outputFilePath) void queueOutputFileAppend(key, command.outputFilePath, output, chunk);
    queueProgress();
    scheduleOutputPersistence();
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    lastOutputGrowthAt = Date.now();
    if (output.stderrBytes + byteLength(chunk) > MAX_OUTPUT_BYTES) output.outputOverflow = true;
    output.stderrBytes = appendBounded(output.stderr, output.stderrBytes, chunk);
    if (command.outputFilePath) void queueOutputFileAppend(key, command.outputFilePath, output, chunk);
    queueProgress();
    scheduleOutputPersistence();
  });
  const stallThresholdMs = normalizeRuntimeWatchdogMs(input.stallThresholdMs, COMMAND_STALL_THRESHOLD_MS);
  const stallCheckIntervalMs = normalizeRuntimeWatchdogMs(input.stallCheckIntervalMs, COMMAND_STALL_CHECK_INTERVAL_MS);
  const stallTimer = input.onStall ? setInterval(() => {
    if (stallNotified || Date.now() - lastOutputGrowthAt < stallThresholdMs) return;
    const stdout = decodeCommandOutput(output.stdout, { final: false });
    const stderr = decodeCommandOutput(output.stderr, { final: false });
    const tail = `${stdout}\n${stderr}`.trimEnd().slice(-COMMAND_STALL_TAIL_CHARS);
    if (!looksLikeInteractiveCommandPrompt(tail)) {
      lastOutputGrowthAt = Date.now();
      return;
    }
    stallNotified = true;
    stallWrite = Promise.resolve(input.onStall?.({
      commandId: command.id,
      elapsedMs: Date.now() - progressStartedAt,
      ...(command.outputFilePath ? { outputFilePath: command.outputFilePath } : {}),
      tail,
    })).then(() => undefined, () => undefined);
  }, stallCheckIntervalMs) : undefined;
  stallTimer?.unref();
  // Register terminal listeners before the first persistence await. Process
  // spawn failures can settle immediately; attaching after an async write loses
  // the close event and leaves the command permanently marked as running.
  // Match cc-haha's shell lifecycle semantics: `close` waits for every
  // inherited stdio handle to close, including handles retained by
  // grandchildren. Development servers commonly spawn such descendants, so
  // waiting for `close` can leave a terminated command permanently running.
  // `exit` represents the process lifecycle we own; the tree terminator below
  // is responsible for its descendants.
  const outcomePromise = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once("error", (error: Error) => resolve({ code: null, error }));
    child.once("exit", (code: number | null) => resolve({ code }));
  });
  if (child.pid) {
    await updateAgentCommandRequest(input.projectId, input.executionId, command.id, (current) => {
      current.processId = child.pid;
      current.updatedAt = new Date().toISOString();
    }, dataDir);
  }

  let timedOut = false;
  let stopped = false;
  let timeout = command.background ? undefined : setTimeout(() => {
    timedOut = true;
    void terminateProcessTree(child);
  }, command.timeoutMs);
  const abort = () => {
    stopped = true;
    void terminateProcessTree(child);
  };
  if (!command.background) input.signal?.addEventListener("abort", abort, { once: true });

  const completed = outcomePromise.then(async (outcome) => {
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = undefined;
    await progressWrite;
    if (stallTimer) clearInterval(stallTimer);
    await stallWrite;
    if (timeout) clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
    const persistTimer = outputPersistTimers.get(key);
    if (persistTimer) clearTimeout(persistTimer);
    outputPersistTimers.delete(key);
    runningCommands.delete(key);
    runningCommandOutput.delete(key);
    if (command.outputFilePath) {
      await outputFileWrites.get(key)?.catch(() => undefined);
    }
    const completedAt = new Date().toISOString();
    const status = timedOut ? "timedOut" : stopped || stoppedCommandKeys.delete(key) ? "stopped" : outcome.code === 0 ? "succeeded" : "failed";
    const updated = await updateAgentCommandRequest(input.projectId, input.executionId, command.id, (current) => {
      current.status = status;
      current.exitCode = outcome.code;
      current.stdout = sanitizeOutput(decodeCommandOutput(output.stdout), outputRoots);
      current.stderr = sanitizeOutput(decodeCommandOutput(output.stderr), outputRoots);
      current.error = outcome.error?.message;
      current.outputFileSize = output.outputFileBytes;
      current.outputPreviewTruncated = output.outputOverflow;
      current.outputFileTruncated = output.outputFileOverflow;
      current.completedAt = completedAt;
      current.updatedAt = completedAt;
    }, dataDir);
    return requireCommand(updated.commandRequests, command.id);
  });
  if (!command.background) {
    const originalInvocation = command.command ?? [command.executable, ...command.args].join(" ");
    if (!isAgentCommandAutoBackgroundAllowed(originalInvocation)) return completed;
    const budgetMs = normalizeForegroundBudget(input.foregroundBudgetMs);
    const early = await Promise.race([
      completed.then((result) => ({ result })),
      delay(Math.min(budgetMs, command.timeoutMs)).then(() => ({})),
    ]);
    if ("result" in early) return early.result;
    if (timedOut || stopped || child.exitCode !== null) return completed;

    if (timeout) clearTimeout(timeout);
    timeout = undefined;
    input.signal?.removeEventListener("abort", abort);
    const transitioned = await updateAgentCommandRequest(input.projectId, input.executionId, command.id, (current) => {
      if (current.status !== "running") return;
      current.background = true;
      current.updatedAt = new Date().toISOString();
    }, dataDir);
    const current = requireCommand(transitioned.commandRequests, command.id);
    if (current.status !== "running") return current;
    trackBackgroundCommandCompletion(key, completed);
    return getAgentBackgroundTask(input.projectId, command.id, dataDir);
  }
  // cc-haha returns explicit background tasks immediately. Their output is
  // written asynchronously and terminal completion is delivered by the task
  // notification path; the model must not wait here or poll for readiness.
  trackBackgroundCommandCompletion(key, completed);
  return getAgentBackgroundTask(input.projectId, command.id, dataDir);
}

function normalizeRuntimeWatchdogMs(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(10, Math.min(Math.trunc(value), MAX_TIMEOUT_MS));
}

function sanitizeCommandEnvironment(value: Record<string, string> | undefined) {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) =>
    /^(CLAUDE_PLUGIN_ROOT|CLAUDE_PLUGIN_DATA)$/.test(key) && typeof entry === "string" && entry.length <= 32_768));
}

function trackBackgroundCommandCompletion(key: string, completion: Promise<AgentCommandRequest>) {
  commandCompletions.set(key, completion);
  // The Project Turn notification path consumes this promise. Attach a
  // rejection handler immediately as a command can fail before that monitor
  // has been scheduled, especially when an executable is missing.
  void completion.catch(() => undefined);
}

async function persistRunningCommandOutput(
  projectId: string,
  executionId: string,
  commandId: string,
  output: CommandOutput,
  roots: string[],
  outputFilePath: string | undefined,
  runtimeCommandKey: string,
  dataDir: string,
) {
  if (outputFilePath) await outputFileWrites.get(runtimeCommandKey)?.catch(() => undefined);
  await updateAgentCommandRequest(projectId, executionId, commandId, (current) => {
    if (current.status !== "running") return;
    current.stdout = sanitizeOutput(decodeCommandOutput(output.stdout, { final: false }), roots);
    current.stderr = sanitizeOutput(decodeCommandOutput(output.stderr, { final: false }), roots);
    current.updatedAt = new Date().toISOString();
  }, dataDir).catch(() => undefined);
}

function queueOutputFileAppend(
  key: string,
  outputFilePath: string,
  output: CommandOutput,
  chunk: Buffer | string,
) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = Math.max(0, MAX_PERSISTED_OUTPUT_BYTES - output.outputFileBytes);
  const accepted = buffer.subarray(0, remaining);
  output.outputFileBytes += accepted.length;
  if (accepted.length < buffer.length) output.outputFileOverflow = true;
  if (accepted.length === 0) return outputFileWrites.get(key) ?? Promise.resolve();
  const previous = outputFileWrites.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
    await fs.appendFile(outputFilePath, accepted);
  });
  outputFileWrites.set(key, next);
  void next.then(
    () => { if (outputFileWrites.get(key) === next) outputFileWrites.delete(key); },
    () => { if (outputFileWrites.get(key) === next) outputFileWrites.delete(key); },
  );
  return next;
}

export function agentTaskOutputPath(dataDir: string, projectId: string, taskId: string) {
  return path.join(dataDir, "projects", projectId, "agent-task-output", `${taskId}.log`);
}

export async function getAgentBackgroundTask(projectId: string, taskId: string, dataDir = getZenmeDataDir()) {
  const located = await reconcileBackgroundTask(await findCommand(projectId, taskId, dataDir), projectId, dataDir);
  const key = runtimeKey(projectId, located.executionId, taskId);
  const output = runningCommandOutput.get(key);
  if (!output) return located.command;
  await outputFileWrites.get(key)?.catch(() => undefined);
  return {
    ...located.command,
    stdout: normalizeTerminalOutput(decodeCommandOutput(output.stdout, { final: false })),
    stderr: normalizeTerminalOutput(decodeCommandOutput(output.stderr, { final: false })),
  };
}

/**
 * Wait for the owned process to reach a terminal state without polling the
 * execution store. This mirrors cc-haha's TaskOutput completion notification:
 * the process lifecycle wakes the Project Turn, while persisted state remains
 * the recovery source after a local-server restart.
 */
export async function waitForAgentBackgroundTaskCompletion(
  projectId: string,
  taskId: string,
  dataDir = getZenmeDataDir(),
) {
  const located = await reconcileBackgroundTask(await findCommand(projectId, taskId, dataDir), projectId, dataDir);
  if (located.command.status !== "running") return located.command;
  const key = runtimeKey(projectId, located.executionId, taskId);
  const completion = commandCompletions.get(key);
  if (!completion) {
    // A task without an in-memory completion belongs to a prior server
    // instance. reconcileBackgroundTask has already converted that orphan to
    // a durable terminal state, so one final read is authoritative.
    return (await findCommand(projectId, taskId, dataDir)).command;
  }
  try {
    return await completion;
  } finally {
    if (commandCompletions.get(key) === completion) commandCompletions.delete(key);
  }
}

export async function listAgentBackgroundTasks(projectId: string, dataDir = getZenmeDataDir()) {
  const details = await listAgentExecutions(projectId, dataDir);
  const tasks = details.flatMap((detail) => detail.commandRequests
    .filter((command) => command.background === true && command.status === "running")
    .map((command) => ({ command, executionId: detail.id })));
  const resolved = await Promise.all(tasks.map(async ({ command, executionId }) => ({
    ...(await getAgentBackgroundTask(projectId, command.id, dataDir).catch(() => command)),
    executionId,
  })));
  return resolved.filter((task) => task.status === "running");
}

export async function stopAgentBackgroundTask(projectId: string, taskId: string, dataDir = getZenmeDataDir()) {
  const located = await findCommand(projectId, taskId, dataDir);
  if (located.command.status !== "running") throw new AgentCommandError("后台任务当前未运行", "invalid_status");
  const child = runningCommands.get(runtimeKey(projectId, located.executionId, taskId));
  if (!child) throw new AgentCommandError("后台任务进程已不可用", "invalid_status");
  stoppedCommandKeys.add(runtimeKey(projectId, located.executionId, taskId));
  const exited = waitForProcessExit(child);
  await terminateProcessTree(child);
  await Promise.race([exited, delay(10_000)]);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = await getAgentBackgroundTask(projectId, taskId, dataDir);
    if (current.status !== "running") return current;
    await delay(100);
  }
  throw new AgentCommandError("后台任务停止结果尚未确认", "invalid_status");
}

export async function failAgentBackgroundTask(
  projectId: string,
  taskId: string,
  error: string,
  dataDir = getZenmeDataDir(),
) {
  const located = await findCommand(projectId, taskId, dataDir);
  if (located.command.status === "running") {
    await stopAgentBackgroundTask(projectId, taskId, dataDir).catch(() => undefined);
  }
  const detail = await updateAgentCommandRequest(projectId, located.executionId, taskId, (command) => {
    if (command.status === "succeeded") return;
    const now = new Date().toISOString();
    command.status = "failed";
    command.error = error.trim().slice(0, 2_000);
    command.completedAt ??= now;
    command.updatedAt = now;
  }, dataDir);
  return requireCommand(detail.commandRequests, taskId);
}

function waitForProcessExit(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const settled = () => {
      child.off("exit", settled);
      child.off("error", settled);
      resolve();
    };
    child.once("exit", settled);
    child.once("error", settled);
  });
}

async function findCommand(projectId: string, taskId: string, dataDir: string) {
  const details = await listAgentExecutions(projectId, dataDir);
  for (const detail of details) {
    const command = detail.commandRequests.find((candidate) => candidate.id === taskId);
    if (command) return { command, executionId: detail.id };
  }
  throw new AgentCommandError("后台任务不存在", "invalid_status");
}

async function reconcileBackgroundTask(
  located: { command: AgentCommandRequest; executionId: string },
  projectId: string,
  dataDir: string,
) {
  if (located.command.status !== "running") return located;
  const key = runtimeKey(projectId, located.executionId, located.command.id);
  if (runningCommands.has(key)) {
    if (located.command.runtimeInstanceId === commandRuntime.instanceId) return located;
    const detail = await updateAgentCommandRequest(projectId, located.executionId, located.command.id, (command) => {
      command.runtimeInstanceId = commandRuntime.instanceId;
      command.updatedAt = new Date().toISOString();
    }, dataDir);
    return { command: requireCommand(detail.commandRequests, located.command.id), executionId: located.executionId };
  }
  if (located.command.runtimeInstanceId === commandRuntime.instanceId) {
    const lastUpdatedAt = Date.parse(located.command.updatedAt);
    if (Number.isFinite(lastUpdatedAt) && Date.now() - lastUpdatedAt < 5_000) return located;
  }
  const detail = await updateAgentCommandRequest(projectId, located.executionId, located.command.id, (command) => {
    const now = new Date().toISOString();
    command.status = "stopped";
    command.error = command.runtimeInstanceId === commandRuntime.instanceId
      ? "后台任务的本地进程句柄已不可用；任务没有继续运行。"
      : "本地服务已重启，后台任务无法续接；请重新启动任务。";
    command.completedAt = now;
    command.updatedAt = now;
  }, dataDir);
  return { command: requireCommand(detail.commandRequests, located.command.id), executionId: located.executionId };
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function stopRunningAgentCommands(projectId: string, executionId: string) {
  const prefix = `${projectId}:${executionId}:`;
  await Promise.all([...runningCommands.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(async ([key, child]) => {
      // Preserve the ownership decision until the process close handler has
      // persisted its terminal state. Deleting the process entry here and
      // relying on its non-zero exit code misclassifies an intentional Agent
      // cancellation as a command failure.
      stoppedCommandKeys.add(key);
      const exited = waitForProcessExit(child);
      await terminateProcessTree(child);
      await Promise.race([exited, delay(10_000)]);
      // The exit handler owns output flushing and durable status updates. Do
      // not return control to Agent/Team cleanup while that handler still
      // retains the process or its Workspace cwd.
      for (let attempt = 0; attempt < 100 && runningCommands.has(key); attempt += 1) {
        await delay(100);
      }
      if (runningCommands.has(key)) {
        throw new AgentCommandError("后台任务停止结果尚未确认", "invalid_status");
      }
    }));
}

async function validateCommand(cwdPath: string, executable: string, args: string[], command?: string) {
  const normalized = normalizeExecutable(executable);
  if (command !== undefined) return validateShellScript(cwdPath, normalized, args, command);
  if (!Array.isArray(args) || args.length > 100 || args.some(invalidArgument)) {
    throw new AgentCommandError("命令参数无效", "invalid_command");
  }
  const verb = args[0]?.toLowerCase();
  if (["npm", "pnpm", "yarn", "bun"].includes(normalized)) {
    const scripts = await declaredPackageScripts(cwdPath);
    const script = packageManagerScript(normalized, args, scripts);
    if (!script) {
      if (["install", "add", "remove", "update", "upgrade", "exec", "dlx", "create"].includes(verb ?? "")) {
        return { requiresExplicitApproval: true, requiresGitWrite: false };
      }
      throw new AgentCommandError("命令脚本未在当前 package.json 中声明", "invalid_command");
    }
    return { requiresExplicitApproval: false, requiresGitWrite: false };
  }
  if (normalized === "pytest" && args.every((arg) => !arg.startsWith("--rootdir"))) return safeCommandPolicy();
  if (normalized === "cargo" && (verb === "test" || verb === "check")) return safeCommandPolicy();
  if (normalized === "go" && verb === "test") return safeCommandPolicy();
  if (normalized === "dotnet" && verb === "test") return safeCommandPolicy();
  if (normalized === "git" && ["init", "status", "rev-parse"].includes(verb ?? "")) {
    if (verb === "init" && args.every((arg) => arg === "init" || arg === "-b" || /^[A-Za-z0-9._/-]+$/.test(arg))) return { ...safeCommandPolicy(), requiresGitWrite: true };
    if (verb === "status" && args.every((arg) => ["status", "--short", "--branch", "--porcelain"].includes(arg))) return safeCommandPolicy();
    if (verb === "rev-parse" && args.every((arg) => arg === "rev-parse" || ["--show-toplevel", "--is-inside-work-tree"].includes(arg))) return safeCommandPolicy();
  }
  if (normalized === "git" && verb === "reset" && args.includes("--hard")) {
    throw new AgentCommandError("破坏性 Git 命令不能由 Agent Shell 执行", "invalid_command");
  }
  return {
    requiresExplicitApproval: commandEscapesWorkspaceSandbox(normalized, args),
    requiresGitWrite: normalized === "git" && gitVerbRequiresWrite(verb),
  };
}

function safeCommandPolicy() {
  return { requiresExplicitApproval: false, requiresGitWrite: false };
}

function normalizeCommandProtocol(input: AgentCommandProposalInput) {
  if (typeof input.command === "string") {
    const command = normalizeShellScript(input.command);
    const shell = input.shell ?? (process.platform === "win32" ? "powershell" : "bash");
    return shell === "powershell"
      ? { command, executable: "powershell", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] }
      : { command, executable: "bash", args: ["-lc", command] };
  }
  const legacy = input as Extract<AgentCommandProposalInput, { executable: string }>;
  return {
    executable: normalizeExecutable(legacy.executable),
    args: [...legacy.args],
  };
}

function normalizeShellScript(value: string) {
  const command = value.trim();
  if (!command || command.length > 200_000 || command.includes("\0")) {
    throw new AgentCommandError("Shell 命令脚本无效", "invalid_command");
  }
  return command;
}

async function validateShellScript(cwdPath: string, executable: string, args: string[], command: string) {
  const expected = executable === "powershell"
    ? { executable: "powershell", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command] }
    : { executable: "bash", args: ["-lc", command] };
  if (executable !== expected.executable || args.length !== expected.args.length || args.some((arg, index) => arg !== expected.args[index])) {
    throw new AgentCommandError("Shell 命令脚本与执行参数不一致", "invalid_command");
  }
  if (/\bgit\s+reset\b[^\r\n;|&]*\s--hard\b/i.test(command)) {
    throw new AgentCommandError("破坏性 Git 命令不能由 Agent Shell 执行", "invalid_command");
  }
  if (isBroadRecursiveDelete(command)) {
    throw new AgentCommandError("面向根目录或上级目录的递归删除不能由 Agent Shell 执行", "invalid_command");
  }
  const analysis = executable === "powershell" && process.platform === "win32"
    ? await analyzePowerShellCommand(command)
    : null;
  const requiresExplicitApproval = executable === "powershell" && process.platform === "win32"
    ? !analysis?.valid || await powerShellAnalysisRequiresExplicitApproval(cwdPath, analysis) || shellScriptRequiresExplicitApproval(command)
    : shellScriptRequiresExplicitApproval(command);
  return {
    requiresExplicitApproval,
    requiresGitWrite: shellScriptRequiresGitWrite(command),
  };
}

const POWERSHELL_COMMANDS_REQUIRING_APPROVAL = new Set([
  "disable-computerrestore", "enable-psremoting", "invoke-command", "invoke-expression", "invoke-restmethod",
  "invoke-webrequest", "new-psdrive", "register-scheduledtask", "remove-psdrive", "restart-computer", "set-acl",
  "set-executionpolicy", "set-item", "set-itemproperty", "set-service", "start-process", "start-service",
  "stop-computer", "stop-process", "stop-service", "unregister-scheduledtask", "write-eventlog",
]);

type PowerShellPathCommand = {
  operation: "read" | "write";
  pathParameters: ReadonlySet<string>;
  valueParameters: ReadonlySet<string>;
  switches: ReadonlySet<string>;
  positionalPaths: number;
};

const COMMON_POWERSHELL_SWITCHES = ["-debug", "-verbose", "-whatif", "-confirm"];
const COMMON_POWERSHELL_VALUE_PARAMETERS = ["-erroraction", "-errorvariable", "-informationaction", "-informationvariable", "-outbuffer", "-outvariable", "-pipelinevariable", "-warningaction", "-warningvariable"];
const pathCommand = (operation: "read" | "write", options: { paths?: string[]; values?: string[]; switches?: string[]; positionalPaths?: number } = {}): PowerShellPathCommand => ({
  operation,
  pathParameters: new Set(options.paths ?? ["-path", "-literalpath", "-filepath", "-destination"]),
  valueParameters: new Set([...(options.values ?? []), ...COMMON_POWERSHELL_VALUE_PARAMETERS]),
  switches: new Set([...(options.switches ?? []), ...COMMON_POWERSHELL_SWITCHES]),
  positionalPaths: options.positionalPaths ?? 1,
});

const POWERSHELL_PATH_COMMANDS = new Map<string, PowerShellPathCommand>([
  ["get-childitem", pathCommand("read", { values: ["-filter", "-include", "-exclude", "-depth", "-attributes"], switches: ["-recurse", "-name", "-force", "-directory", "-file", "-hidden"] })],
  ["get-content", pathCommand("read", { values: ["-totalcount", "-head", "-tail", "-encoding", "-delimiter", "-readcount"], switches: ["-raw", "-force"] })],
  ["get-item", pathCommand("read", { values: ["-filter", "-include", "-exclude", "-stream"], switches: ["-force"] })],
  ["test-path", pathCommand("read", { values: ["-pathtype", "-filter", "-include", "-exclude"], switches: ["-isvalid"] })],
  ["resolve-path", pathCommand("read", { switches: ["-relative"] })],
  ["get-filehash", pathCommand("read", { values: ["-algorithm"], positionalPaths: 1 })],
  ["select-string", pathCommand("read", { paths: ["-path", "-literalpath"], values: ["-pattern", "-inputobject", "-encoding", "-context"], switches: ["-simplematch", "-casesensitive", "-quiet", "-list", "-notmatch", "-allmatches", "-raw"] })],
  ["set-content", pathCommand("write", { values: ["-value", "-filter", "-include", "-exclude", "-encoding", "-stream"], switches: ["-force", "-nonewline"] })],
  ["add-content", pathCommand("write", { values: ["-value", "-filter", "-include", "-exclude", "-encoding", "-stream"], switches: ["-force", "-nonewline"] })],
  ["clear-content", pathCommand("write", { values: ["-filter", "-include", "-exclude", "-stream"], switches: ["-force"] })],
  ["remove-item", pathCommand("write", { values: ["-filter", "-include", "-exclude"], switches: ["-recurse", "-force"] })],
  ["new-item", pathCommand("write", { values: ["-itemtype", "-value", "-name"], switches: ["-force"] })],
  ["copy-item", pathCommand("write", { values: ["-filter", "-include", "-exclude"], switches: ["-container", "-force", "-recurse", "-passthru"], positionalPaths: 2 })],
  ["move-item", pathCommand("write", { values: ["-filter", "-include", "-exclude"], switches: ["-force", "-passthru"], positionalPaths: 2 })],
  ["rename-item", pathCommand("write", { values: ["-newname"], switches: ["-force", "-passthru"] })],
  ["out-file", pathCommand("write", { paths: ["-filepath", "-path", "-literalpath"], values: ["-encoding", "-width", "-inputobject"], switches: ["-append", "-force", "-noclobber", "-nonewline"] })],
  ["tee-object", pathCommand("write", { paths: ["-filepath", "-path", "-literalpath"], values: ["-variable", "-inputobject"], switches: ["-append"] })],
  ["export-csv", pathCommand("write", { values: ["-delimiter", "-encoding", "-inputobject", "-usequotes", "-quotefields"], switches: ["-append", "-force", "-noclobber", "-notypeinformation"] })],
  ["export-clixml", pathCommand("write", { values: ["-depth", "-encoding", "-inputobject"], switches: ["-force", "-noclobber"] })],
]);

const POWERSHELL_ALIASES = new Map<string, string>([
  ["cat", "get-content"], ["gc", "get-content"], ["type", "get-content"],
  ["dir", "get-childitem"], ["gci", "get-childitem"], ["ls", "get-childitem"],
  ["gi", "get-item"], ["ni", "new-item"], ["mkdir", "new-item"], ["md", "new-item"],
  ["cp", "copy-item"], ["copy", "copy-item"], ["cpi", "copy-item"],
  ["mv", "move-item"], ["move", "move-item"], ["mi", "move-item"],
  ["ren", "rename-item"], ["rni", "rename-item"],
  ["rm", "remove-item"], ["del", "remove-item"], ["erase", "remove-item"], ["ri", "remove-item"],
  ["rmdir", "remove-item"],
  ["sc", "set-content"], ["ac", "add-content"], ["clc", "clear-content"],
]);

const POWERSHELL_VALUE_LEAK_COMMANDS = new Set([
  "echo", "start-sleep", "throw", "write-debug", "write-error", "write-host",
  "write-information", "write-output", "write-verbose", "write-warning",
]);

async function powerShellAnalysisRequiresExplicitApproval(cwdPath: string, analysis: PowerShellCommandAnalysis) {
  if (analysis.hasInvokeMemberExpression || analysis.hasSubExpression ||
      analysis.hasSplatting || analysis.hasStopParsing || analysis.hasUsingStatements) return true;
  for (const redirection of analysis.redirections) {
    if (!redirection.target || !await powerShellPathIsWithinWorkspace(cwdPath, redirection.target, "write")) return true;
  }
  for (const command of analysis.commands) {
    if (!command.name || !["Unknown", "None"].includes(command.invocationOperator)) return true;
    const commandName = command.name.toLowerCase();
    const normalized = commandName.replace(/\.(?:exe|cmd|bat)$/i, "");
    if (/\.(?:exe|cmd|bat)$/i.test(commandName) && ["cmd", "powershell", "pwsh", "reg", "runas", "sc", "schtasks", "taskkill", "wmic", "wsl"].includes(normalized)) return true;
    if (POWERSHELL_COMMANDS_REQUIRING_APPROVAL.has(normalized)) return true;
    const canonical = POWERSHELL_ALIASES.get(normalized) ?? normalized;
    if (POWERSHELL_VALUE_LEAK_COMMANDS.has(canonical) && command.elements.slice(1).some(powerShellElementMayLeakValue)) return true;
    const pathPolicy = POWERSHELL_PATH_COMMANDS.get(canonical);
    if (pathPolicy) {
      const paths = extractPowerShellPaths(command.elements.slice(1), pathPolicy);
      if (!paths || (pathPolicy.operation === "write" && paths.length === 0)) return true;
      for (const candidate of paths) {
        if (!await powerShellPathIsWithinWorkspace(cwdPath, candidate, pathPolicy.operation)) return true;
      }
    }
    const passesScriptBlock = command.elements.some((element) => element.type === "ScriptBlockExpressionAst");
    if (passesScriptBlock && !["foreach-object", "where-object"].includes(normalized)) return true;
    if (normalized === "git") {
      const verb = command.elements.slice(1).map((element) => element.text.trim()).find((value) => value && !value.startsWith("-"));
      if (verb && ["clean", "config", "credential", "fetch", "pull", "push", "remote"].includes(verb.toLowerCase())) return true;
    }
    if (["npm", "pnpm", "yarn", "bun"].includes(normalized)) {
      const verb = command.elements[1]?.text.trim().toLowerCase();
      if (["install", "add", "remove", "update", "upgrade", "exec", "dlx", "create"].includes(verb ?? "")) return true;
    }
  }
  return false;
}

function powerShellElementMayLeakValue(element: PowerShellCommandAnalysis["commands"][number]["elements"][number]) {
  if (!["StringConstantExpressionAst", "CommandParameterAst"].includes(element.type)) return true;
  const colon = element.text.indexOf(":");
  return colon >= 0 && /[$(@{\[]/.test(element.text.slice(colon + 1));
}

function extractPowerShellPaths(elements: PowerShellCommandAnalysis["commands"][number]["elements"], policy: PowerShellPathCommand) {
  const paths: string[] = [];
  let positionalRemaining = policy.positionalPaths;
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (!element || !["StringConstantExpressionAst", "CommandParameterAst"].includes(element.type)) return null;
    const text = stripPowerShellLiteralQuotes(element.text.trim());
    if (element.type === "CommandParameterAst" || text.startsWith("-")) {
      const colon = text.indexOf(":");
      const parameter = (colon >= 0 ? text.slice(0, colon) : text).toLowerCase();
      const inlineValue = colon >= 0 ? text.slice(colon + 1) : null;
      if (policy.switches.has(parameter)) continue;
      if (policy.pathParameters.has(parameter)) {
        const value = inlineValue || stripPowerShellLiteralQuotes(elements[++index]?.text?.trim() ?? "");
        if (!value) return null;
        paths.push(value);
        continue;
      }
      if (policy.valueParameters.has(parameter)) {
        if (inlineValue === null && !elements[++index]) return null;
        continue;
      }
      return null;
    }
    if (positionalRemaining > 0) {
      paths.push(text);
      positionalRemaining -= 1;
    }
  }
  return paths;
}

async function powerShellPathIsWithinWorkspace(cwdPath: string, rawPath: string, operation: "read" | "write") {
  const candidate = stripPowerShellLiteralQuotes(rawPath.trim());
  if (!candidate || candidate.includes("\0") || /[$`(){}]/.test(candidate) || /^(?:\\\\|\/\/)/.test(candidate)) return false;
  if (/^[a-z][a-z0-9.+-]*:/i.test(candidate) && !/^[a-z]:[\\/]/i.test(candidate)) return false;
  const wildcardIndex = candidate.search(/[*?[\]]/);
  const pathWithoutWildcard = wildcardIndex < 0 ? candidate : candidate.slice(0, wildcardIndex);
  const target = path.resolve(cwdPath, pathWithoutWildcard || ".");
  if (!isInsideRoot(cwdPath, target)) return false;
  if (operation === "write" && path.relative(cwdPath, target).replaceAll("\\", "/").split("/").some((segment) => segment.toLowerCase() === ".git")) return false;
  const existingParent = await nearestExistingParent(target);
  if (!existingParent) return false;
  const [realCwd, realParent] = await Promise.all([fs.realpath(cwdPath), fs.realpath(existingParent)]);
  return isInsideRoot(realCwd, realParent);
}

async function nearestExistingParent(candidate: string) {
  let current = candidate;
  while (true) {
    try {
      await fs.lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

function stripPowerShellLiteralQuotes(value: string) {
  if (value.length >= 2 && ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))) {
    return value.slice(1, -1);
  }
  return value;
}

const READ_ONLY_GIT_VERBS = new Set([
  "blame", "cat-file", "describe", "diff", "for-each-ref", "grep", "log",
  "ls-files", "ls-tree", "name-rev", "rev-list", "rev-parse", "shortlog",
  "show", "status",
]);

function gitVerbRequiresWrite(verb: string | undefined) {
  return Boolean(verb && !READ_ONLY_GIT_VERBS.has(verb));
}

function shellScriptRequiresGitWrite(command: string) {
  const invocations = command.matchAll(/(?:^|[;|&\r\n]\s*)git\s+(?:-[^\s;|&]+\s+)*([a-z][a-z-]*)/gi);
  for (const match of invocations) {
    if (gitVerbRequiresWrite(match[1]?.toLowerCase())) return true;
  }
  return false;
}

function isBroadRecursiveDelete(command: string) {
  return /\b(?:remove-item|rm|rmdir)\b[^\r\n;|&]*(?:-recurse|-r\b)[^\r\n;|&]*(?:\s|^)(?:[.]{1,2}|[/\\]|[a-z]:[/\\]|\$env:(?:userprofile|systemroot)|~)(?:\s|$)/i.test(command);
}

function shellScriptRequiresExplicitApproval(command: string) {
  const explicitCommand = /(?:^|[;|&\r\n]\s*)(?:aws|az|choco|cmd|curl|diskpart|docker|explorer|ftp|gcloud|gh|gsutil|helm|invoke-webrequest|invoke-restmethod|kubectl|net|netsh|open|reg|runas|schtasks|scp|sftp|shutdown|scoop|ssh|start-process|sudo|taskkill|wget|winget|wmic|wsl|xdg-open)\b/i;
  const packageMutation = /(?:^|[;|&\r\n]\s*)(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade|exec|dlx|create)\b/i;
  const riskyGit = /(?:^|[;|&\r\n]\s*)git\s+(?:clean|config|credential|fetch|pull|push|remote)\b/i;
  return explicitCommand.test(command) || packageMutation.test(command) || riskyGit.test(command);
}

const COMMANDS_REQUIRING_EXPLICIT_APPROVAL = new Set([
  "aws", "az", "bash", "choco", "cmd", "curl", "del", "diskpart", "docker",
  "erase", "explorer", "ftp", "gcloud", "gh", "gsutil", "helm", "kubectl",
  "net", "netsh", "open", "powershell", "pwsh", "reg", "remove-item", "rm",
  "rmdir", "runas", "sc", "schtasks", "scp", "sftp", "sh", "shutdown", "scoop",
  "ssh", "start", "sudo", "taskkill", "wget", "winget", "wmic", "wsl", "xdg-open",
]);

function commandEscapesWorkspaceSandbox(executable: string, args: string[]) {
  if (COMMANDS_REQUIRING_EXPLICIT_APPROVAL.has(executable)) return true;
  if (executable !== "git") return false;
  const verb = args[0]?.toLowerCase();
  return ["clean", "config", "credential", "fetch", "pull", "push", "remote"].includes(verb ?? "");
}

function packageManagerScript(executable: string, args: string[], scripts: ReadonlySet<string>) {
  const verb = args[0]?.toLowerCase();
  if (!verb) return null;
  if (verb === "run") return args[1] && scripts.has(args[1]) ? args[1] : null;
  if (verb === "test") return scripts.has("test") ? "test" : null;
  // pnpm and Yarn support `manager <script>`; npm exposes a small set of
  // lifecycle scripts directly. In every case the script must exist locally.
  const supportsDirectScript = executable === "pnpm" || executable === "yarn" || executable === "bun" ||
    (executable === "npm" && ["start", "stop", "restart"].includes(verb));
  return supportsDirectScript && scripts.has(args[0]) ? args[0] : null;
}

async function declaredPackageScripts(cwdPath: string) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(cwdPath, "package.json"), "utf8")) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) return new Set<string>();
    return new Set(Object.keys(parsed.scripts));
  } catch {
    return new Set<string>();
  }
}

async function requireReadableBinding(projectId: string, dataDir: string) {
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  if (!binding || !listWorkspaceRoots(binding).some((root) => canUseWorkspaceRootCapability(root, "read"))) {
    throw new AgentCommandError("Workspace 未绑定或未授权读取", "workspace_unavailable");
  }
  return binding;
}

function normalizeExecutable(value: string) {
  const executable = value.trim().toLowerCase().replace(/\.(cmd|exe)$/i, "");
  if (!executable || executable.includes("/") || executable.includes("\\") || !/^[a-z0-9._-]+$/.test(executable)) {
    throw new AgentCommandError("命令可执行文件无效", "invalid_command");
  }
  return executable;
}

function normalizeRelativeDirectory(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (normalized !== "." && (path.posix.isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === ".."))) {
    throw new AgentCommandError("命令工作目录无效", "invalid_command");
  }
  return normalized;
}

async function resolveCommandDirectory(binding: WorkspaceBinding, value: string, rootId?: string) {
  const selectedRoot = requireReadableRoot(binding, rootId);
  if (path.isAbsolute(value)) {
    const inspected = await inspectWorkspaceRoot(value);
    const allowed = listWorkspaceRoots(binding)
      .filter((root) => root.status === "resolved" && canUseWorkspaceRootCapability(root, "read"))
      .sort((left, right) => right.realPath.length - left.realPath.length)
      .find((root) => isInsideRoot(root.realPath, inspected.realPath));
    if (rootId && allowed?.id !== selectedRoot.id) {
      throw new AgentCommandError("命令工作目录与指定 Workspace 根不一致", "invalid_command");
    }
    if (allowed) return { cwd: inspected.realPath, cwdPath: inspected.realPath, root: allowed };
    return {
      cwd: inspected.realPath,
      cwdPath: inspected.realPath,
      externalRoot: {
        displayName: inspected.displayName,
        identity: inspected.identity,
        realPath: inspected.realPath,
        rootPath: inspected.rootPath,
      },
    };
  }
  const cwd = normalizeRelativeDirectory(value);
  return {
    cwd,
    cwdPath: cwd === "." ? selectedRoot.realPath : await resolveExistingWorkspacePath(selectedRoot.realPath, cwd),
    root: selectedRoot,
  };
}

async function resolveApprovedCommandDirectory(
  binding: WorkspaceBinding,
  command: AgentCommandRequest,
) {
  const selectedRoot = requireReadableRoot(binding, command.rootId);
  if (!path.isAbsolute(command.cwd)) {
    return {
      cwdPath: command.cwd === "." ? selectedRoot.realPath : await resolveExistingWorkspacePath(selectedRoot.realPath, command.cwd),
      root: selectedRoot,
    };
  }
  const allowedRoot = listWorkspaceRoots(binding).find((root) =>
    root.status === "resolved" && (!command.rootId || root.id === selectedRoot.id) && isInsideRoot(root.realPath, command.cwd));
  if (allowedRoot) return { cwdPath: command.cwd, root: allowedRoot };
  if (!command.externalRoot || command.approvalScope !== "once") {
    throw new AgentCommandError("命令工作目录位于 Workspace 外，需要重新批准", "external_workspace_approval_required");
  }
  const inspected = await inspectWorkspaceRoot(command.externalRoot.rootPath);
  if (path.normalize(inspected.realPath) !== path.normalize(command.externalRoot.realPath) ||
      !workspaceIdentityMatches(command.externalRoot.identity, inspected.identity)) {
    throw new AgentCommandError("外部目录身份已经变化，需要重新选择", "external_workspace_approval_required");
  }
  return { cwdPath: inspected.realPath, root: selectedRoot };
}

function requireReadableRoot(binding: WorkspaceBinding, rootId?: string): WorkspaceResolvedRoot {
  const root = resolveWorkspaceRoot(binding, rootId);
  if (!root || !canUseWorkspaceRootCapability(root, "read")) {
    throw new AgentCommandError("Workspace 根目录未绑定或未授权读取", "workspace_unavailable");
  }
  return root;
}

function isInsideRoot(rootPath: string, targetPath: string) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function invalidArgument(value: unknown) {
  if (typeof value !== "string" || value.length > 2_000 || value.includes("\0") || /[\r\n]/.test(value)) return true;
  if (/^(--cwd|--prefix|--rootdir|-C)(=|$)/i.test(value)) return true;
  if (path.isAbsolute(value)) return true;
  return value.replaceAll("\\", "/").split("/").includes("..");
}

function normalizeTimeout(value?: number) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 1_000 || value > MAX_TIMEOUT_MS) {
    throw new AgentCommandError("命令超时必须在 1 秒到 5 分钟之间", "invalid_command");
  }
  return value;
}

function normalizeForegroundBudget(value?: number) {
  if (value === undefined) return FOREGROUND_COMMAND_BUDGET_MS;
  if (!Number.isInteger(value) || value < 10 || value > MAX_TIMEOUT_MS) {
    throw new AgentCommandError("前台命令预算无效", "invalid_command");
  }
  return value;
}

async function commandInvocation(executable: string, args: string[]) {
  if (process.platform !== "win32") return { executable, args };
  if (executable === "powershell") {
    const powershell = await resolvePowerShellExecutable();
    if (!powershell) throw new AgentCommandError("无法定位 PowerShell（优先 pwsh 7，回退 Windows PowerShell）", "command_not_found");
    return { executable: powershell, args };
  }
  if (executable === "bash") {
    const bash = await resolveWindowsGitBashExecutable();
    if (!bash) throw new AgentCommandError("无法定位 Git Bash；请安装 Git for Windows，或在 Skill frontmatter 中声明 shell: powershell", "command_not_found");
    return { executable: bash, args };
  }
  if (executable === "npm") {
    const candidates = [
      process.env.npm_execpath,
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    for (const candidate of candidates) {
      if (!candidate.endsWith("npm-cli.js")) continue;
      try {
        await fs.access(candidate);
        return { executable: process.execPath, args: [candidate, ...args] };
      } catch {
        // Try the next installation-owned npm CLI path.
      }
    }
    throw new AgentCommandError("无法定位受信任的 npm CLI", "invalid_command");
  }
  if (["pnpm", "yarn", "bun"].includes(executable)) {
    const invocation = await resolveWindowsPackageManagerShim(executable, args);
    if (invocation) return invocation;
    throw new AgentCommandError(`无法定位受信任的 ${executable} CLI`, "command_not_found");
  }
  return { executable, args };
}

async function resolveWindowsGitBashExecutable() {
  const candidates = [
    process.env.CLAUDE_CODE_GIT_BASH_PATH,
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "Git", "bin", "bash.exe") : undefined,
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "Git", "bin", "bash.exe") : undefined,
    ...((process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean).flatMap((directory) => [
      path.join(directory, "bash.exe"),
      path.resolve(directory, "..", "bin", "bash.exe"),
    ])),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const currentDirectory = path.resolve(process.cwd()).toLowerCase();
  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      const candidateDirectory = path.dirname(resolved).toLowerCase();
      if (candidateDirectory === currentDirectory || candidateDirectory.startsWith(`${currentDirectory}${path.sep}`)) continue;
      await fs.access(resolved);
      return resolved;
    } catch {
      // Try the next trusted installation candidate.
    }
  }
  return null;
}

async function resolveWindowsPackageManagerShim(executable: string, args: string[]) {
  const pathValue = process.env.PATH ?? process.env.Path ?? "";
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const shimPath = path.join(directory, `${executable}.cmd`);
    let source: string;
    try { source = await fs.readFile(shimPath, "utf8"); }
    catch { continue; }
    const matches = [...source.matchAll(/"([^"]*node(?:\.exe)?)"\s+"([^"]+\.(?:cjs|mjs|js))"\s+%\*/gi)];
    for (const match of matches) {
      const expand = (value: string) => path.resolve(value.replace(/%~dp0/gi, `${path.dirname(shimPath)}${path.sep}`));
      const nodePath = expand(match[1]);
      const cliPath = expand(match[2]);
      try {
        await Promise.all([fs.access(nodePath), fs.access(cliPath)]);
        return { executable: nodePath, args: [cliPath, ...args] };
      } catch {
        // Try the next command-shim branch or PATH entry.
      }
    }
  }
  return null;
}

type CommandOutput = {
  stdout: Buffer[];
  stderr: Buffer[];
  stdoutBytes: number;
  stderrBytes: number;
  outputFileBytes: number;
  outputOverflow: boolean;
  outputFileOverflow: boolean;
};

function byteLength(chunk: Buffer | string) {
  return Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
}

function appendBounded(chunks: Buffer[], currentBytes: number, chunk: Buffer | string) {
  if (currentBytes >= MAX_OUTPUT_BYTES) return currentBytes;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const accepted = buffer.subarray(0, MAX_OUTPUT_BYTES - currentBytes);
  if (accepted.length > 0) chunks.push(Buffer.from(accepted));
  return currentBytes + accepted.length;
}

function sanitizeOutput(value: string, workspaceRoots: string[]) {
  return workspaceRoots.reduce((output, root, index) =>
    output.replaceAll(root, index === 0 ? "<workspace>" : `<workspace-root-${index}>`), normalizeTerminalOutput(value))
    .replace(/\b(?:sk|pk|ghp|github_pat|xox[baprs])-?[A-Za-z0-9_-]{12,}\b/g, "<redacted>")
    .slice(0, MAX_OUTPUT_BYTES);
}

function normalizeTerminalOutput(value: string) {
  return stripVTControlCharacters(value).replace(/\r(?!\n)/g, "\n");
}

async function terminateProcessTree(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // `taskkill /T` is not sufficient for npm/pnpm process chains on every
    // supported Windows build: terminating the command shim can orphan a
    // grandchild before taskkill reaches it. Snapshot the tree first and kill
    // deepest descendants before the owned root process. This implements the
    // same whole-tree lifecycle promised by cc-haha's ShellCommand wrapper.
    const descendants = await listWindowsDescendantPids(child.pid).catch(() => []);
    for (const pid of descendants) await taskkillWindowsProcess(pid);
    await taskkillWindowsProcess(child.pid);
    if (child.exitCode === null) child.kill();
  } else {
    child.kill("SIGTERM");
  }
}

async function taskkillWindowsProcess(pid: number) {
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    const finish = () => resolve();
    killer.once("close", finish);
    killer.once("error", finish);
  });
}

async function listWindowsDescendantPids(rootPid: number) {
  const windowsRoot = process.env.SystemRoot || "C:\\Windows";
  const powershell = path.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress";
  const child = spawn(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  let bytes = 0;
  child.stdout?.on("data", (chunk: Buffer) => {
    if (bytes >= MAX_OUTPUT_BYTES) return;
    const accepted = chunk.subarray(0, MAX_OUTPUT_BYTES - bytes);
    chunks.push(Buffer.from(accepted));
    bytes += accepted.length;
  });
  await Promise.race([
    waitForProcessExit(child),
    delay(3_000).then(() => { if (child.exitCode === null) child.kill(); }),
  ]);
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as
    | { ProcessId?: unknown; ParentProcessId?: unknown }
    | Array<{ ProcessId?: unknown; ParentProcessId?: unknown }>;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (typeof row.ProcessId !== "number" || typeof row.ParentProcessId !== "number") continue;
    const group = children.get(row.ParentProcessId) ?? [];
    group.push(row.ProcessId);
    children.set(row.ParentProcessId, group);
  }
  const descendants: number[] = [];
  const visit = (pid: number) => {
    for (const childPid of children.get(pid) ?? []) {
      visit(childPid);
      descendants.push(childPid);
    }
  };
  visit(rootPid);
  return descendants;
}

function requireCommand(commands: AgentCommandRequest[], commandId: string) {
  const command = commands.find((candidate) => candidate.id === commandId);
  if (!command) throw new AgentCommandError("命令请求不存在", "command_not_found");
  return command;
}

function runtimeKey(projectId: string, executionId: string, commandId: string) {
  return `${projectId}:${executionId}:${commandId}`;
}
