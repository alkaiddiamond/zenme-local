import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { resolvePowerShellExecutable } from "@/lib/agent/powershell-runtime";

const execFileAsync = promisify(execFile);
const PARSE_TIMEOUT_MS = 5_000;
const MAX_COMMAND_BYTES = 256 * 1024;
const analysisCache = new Map<string, Promise<PowerShellCommandAnalysis | null>>();
const MAX_CACHE_ENTRIES = 256;

export type PowerShellCommandElement = {
  text: string;
  type: string;
};

export type PowerShellCommand = {
  elements: PowerShellCommandElement[];
  invocationOperator: string;
  name: string | null;
  text: string;
};

export type PowerShellCommandAnalysis = {
  commands: PowerShellCommand[];
  errors: string[];
  hasArrayExpression: boolean;
  hasExpandableString: boolean;
  hasInvokeMemberExpression: boolean;
  hasScriptBlockExpression: boolean;
  hasSplatting: boolean;
  hasStopParsing: boolean;
  hasSubExpression: boolean;
  hasUsingStatements: boolean;
  redirections: Array<{ target: string | null; text: string }>;
  valid: boolean;
};

const PARSER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__COMMAND_BASE64__'))
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
$all = { param($type) @($ast.FindAll({ param($node) $node.GetType().Name -eq $type }, $true)) }
$commands = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object {
  [ordered]@{
    text = $_.Extent.Text
    name = $_.GetCommandName()
    invocationOperator = [string]$_.InvocationOperator
    elements = @($_.CommandElements | ForEach-Object { [ordered]@{ type = $_.GetType().Name; text = $_.Extent.Text } })
  }
})
$redirections = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FileRedirectionAst] }, $true) | ForEach-Object {
  [ordered]@{ text = $_.Extent.Text; target = if ($_.Location) { $_.Location.Extent.Text } else { $null } }
})
$variables = @($ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst] }, $true))
$result = [ordered]@{
  valid = $parseErrors.Count -eq 0
  errors = @($parseErrors | ForEach-Object { $_.Message })
  commands = $commands
  redirections = $redirections
  hasInvokeMemberExpression = (& $all 'InvokeMemberExpressionAst').Count -gt 0
  hasSubExpression = (& $all 'SubExpressionAst').Count -gt 0
  hasArrayExpression = (& $all 'ArrayExpressionAst').Count -gt 0
  hasScriptBlockExpression = (& $all 'ScriptBlockExpressionAst').Count -gt 0
  hasExpandableString = (& $all 'ExpandableStringExpressionAst').Count -gt 0
  hasSplatting = @($variables | Where-Object { $_.Splatted }).Count -gt 0
  hasStopParsing = @($tokens | Where-Object { $_.Kind -eq 'StopParsing' }).Count -gt 0
  hasUsingStatements = (& $all 'UsingStatementAst').Count -gt 0
}
$result | ConvertTo-Json -Depth 8 -Compress
`;

export async function analyzePowerShellCommand(command: string): Promise<PowerShellCommandAnalysis | null> {
  if (process.platform !== "win32") return null;
  const cached = analysisCache.get(command);
  if (cached) return cached;
  const pending = parsePowerShellCommand(command);
  analysisCache.set(command, pending);
  if (analysisCache.size > MAX_CACHE_ENTRIES) analysisCache.delete(analysisCache.keys().next().value!);
  const result = await pending;
  if (!result?.valid && result?.errors.some((error) => /timeout|timed out|解析器|spawn|ENOENT/i.test(error))) {
    analysisCache.delete(command);
  }
  return result;
}

async function parsePowerShellCommand(command: string): Promise<PowerShellCommandAnalysis | null> {
  if (Buffer.byteLength(command, "utf8") > MAX_COMMAND_BYTES) return failedAnalysis("PowerShell 命令超过解析上限");
  const executable = await resolvePowerShellExecutable();
  if (!executable) return failedAnalysis("未找到 PowerShell 解析器");
  const source = PARSER_SCRIPT.replace("__COMMAND_BASE64__", Buffer.from(command, "utf8").toString("base64"));
  const encoded = Buffer.from(source, "utf16le").toString("base64");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { stdout } = await execFileAsync(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
        timeout: PARSE_TIMEOUT_MS,
        windowsHide: true,
      });
      return normalizeAnalysis(JSON.parse(stdout.trim()) as PowerShellCommandAnalysis);
    } catch (error) {
      if (attempt === 1) return failedAnalysis(error instanceof Error ? error.message : "PowerShell AST 解析失败");
    }
  }
  return failedAnalysis("PowerShell AST 解析失败");
}

function normalizeAnalysis(value: PowerShellCommandAnalysis): PowerShellCommandAnalysis {
  return {
    valid: value.valid === true,
    errors: array(value.errors).map(String),
    commands: array(value.commands).map((command) => ({
      text: String(command.text ?? ""),
      name: typeof command.name === "string" && command.name ? command.name : null,
      invocationOperator: String(command.invocationOperator ?? "Unknown"),
      elements: array(command.elements).map((element) => ({ text: String(element.text ?? ""), type: String(element.type ?? "") })),
    })),
    redirections: array(value.redirections).map((redirection) => ({
      text: String(redirection.text ?? ""),
      target: typeof redirection.target === "string" ? redirection.target : null,
    })),
    hasInvokeMemberExpression: value.hasInvokeMemberExpression === true,
    hasSubExpression: value.hasSubExpression === true,
    hasArrayExpression: value.hasArrayExpression === true,
    hasScriptBlockExpression: value.hasScriptBlockExpression === true,
    hasExpandableString: value.hasExpandableString === true,
    hasSplatting: value.hasSplatting === true,
    hasStopParsing: value.hasStopParsing === true,
    hasUsingStatements: value.hasUsingStatements === true,
  };
}

function array<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function failedAnalysis(message: string): PowerShellCommandAnalysis {
  return {
    valid: false,
    errors: [message],
    commands: [],
    redirections: [],
    hasInvokeMemberExpression: false,
    hasSubExpression: false,
    hasArrayExpression: false,
    hasScriptBlockExpression: false,
    hasExpandableString: false,
    hasSplatting: false,
    hasStopParsing: false,
    hasUsingStatements: false,
  };
}
