import type { AgentWorkspaceToolArguments } from "@/lib/agent/types";

const READ_ONLY_GIT_VERBS = new Set([
  "blame", "cat-file", "describe", "diff", "for-each-ref", "grep", "log",
  "ls-files", "ls-tree", "name-rev", "rev-list", "rev-parse", "shortlog",
  "show", "status",
]);

const READ_ONLY_EXECUTABLES = new Set([
  "cat", "findstr", "grep", "head", "ls", "rg", "stat", "tail", "type", "wc", "where",
]);

/**
 * Mirrors cc-haha's dynamic Shell scheduling rule: only commands that are
 * demonstrably read-only may share a batch. Unknown or compound commands are
 * deliberately serialized.
 */
export function isAgentShellConcurrencySafe(
  input: AgentWorkspaceToolArguments["shell_command"],
): boolean {
  if (input.run_in_background || input.background) return false;

  if (typeof input.executable === "string") {
    const executable = normalizeExecutable(input.executable);
    const args = input.args ?? [];
    if (!args.every(isLiteralArgument)) return false;
    if (executable === "git") return READ_ONLY_GIT_VERBS.has(args[0]?.toLowerCase() ?? "");
    if (READ_ONLY_EXECUTABLES.has(executable)) return executable !== "find" || !hasFindMutation(args);
    return ["node", "npm", "pnpm", "yarn", "bun"].includes(executable)
      && args.every((arg) => ["--help", "-h", "--version", "-v"].includes(arg.toLowerCase()));
  }

  // cc-haha cannot synchronously prove PowerShell AST safety and therefore
  // does not advertise arbitrary PowerShell scripts as concurrency-safe.
  if (process.platform === "win32") return false;
  return isSimpleReadOnlyPosixCommand(input.command);
}

function normalizeExecutable(value: string) {
  return value.trim().toLowerCase().replace(/\.(cmd|exe)$/i, "");
}

function isLiteralArgument(value: string) {
  return typeof value === "string"
    && value.length <= 20_000
    && !/[\0\r\n|;&><`$]/.test(value);
}

function hasFindMutation(args: readonly string[]) {
  return args.some((arg) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(arg.toLowerCase()));
}

function isSimpleReadOnlyPosixCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || /[\r\n|;&><`$(){}]/.test(trimmed)) return false;
  const tokens = trimmed.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (tokens.length === 0 || tokens.some((token) => !isLiteralArgument(unquote(token)))) return false;
  const executable = normalizeExecutable(unquote(tokens[0]!));
  const args = tokens.slice(1).map(unquote);
  if (executable === "git") return READ_ONLY_GIT_VERBS.has(args[0]?.toLowerCase() ?? "");
  return READ_ONLY_EXECUTABLES.has(executable) && (executable !== "find" || !hasFindMutation(args));
}

function unquote(value: string) {
  return ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}
