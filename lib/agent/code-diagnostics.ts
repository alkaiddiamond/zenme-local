import fs from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const MAX_ROOT_FILES = 3_000;
const DEFAULT_MAX_PROBLEMS = 100;
const MAX_PROBLEMS = 500;

export type CodeDiagnostic = {
  code: number | string;
  column?: number;
  file?: string;
  line?: number;
  message: string;
  source?: string;
  severity: "error" | "warning" | "suggestion" | "message";
};

export type CodeDiagnosticsResult = {
  available: boolean;
  configPath?: string;
  diagnostics: CodeDiagnostic[];
  errorCount: number;
  fileCount: number;
  truncated: boolean;
  warningCount: number;
  reason?: string;
};

export async function collectTypeScriptDiagnostics(input: {
  rootPath: string;
  configPath?: string;
  maxProblems?: number;
  overlays?: Record<string, string | null>;
  relativePaths?: string[];
}): Promise<CodeDiagnosticsResult> {
  const rootPath = await fs.realpath(input.rootPath);
  const configPath = await resolveConfigPath(rootPath, input.configPath, input.relativePaths?.[0]);
  if (!configPath) {
    return emptyResult("Workspace 中未找到 tsconfig.json 或 jsconfig.json");
  }

  const configRelativePath = toWorkspaceRelativePath(rootPath, configPath);
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    const diagnostic = formatDiagnostic(rootPath, loaded.error);
    return resultFromDiagnostics(configRelativePath, [], [diagnostic], false);
  }

  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(configPath),
    { incremental: false, noEmit: true },
    configPath,
  );
  const overlays = normalizeOverlays(rootPath, input.overlays);
  const rootFiles = mergeOverlayRootFiles(await filterWorkspaceFiles(rootPath, parsed.fileNames), overlays);
  if (rootFiles.length > MAX_ROOT_FILES) {
    return emptyResult(`TypeScript 项目包含 ${rootFiles.length} 个根文件，超过 ${MAX_ROOT_FILES} 个诊断上限`, configRelativePath);
  }

  const options = { ...parsed.options, incremental: false, noEmit: true };
  const program = ts.createProgram({
    host: createOverlayCompilerHost(options, overlays),
    options,
    projectReferences: parsed.projectReferences,
    rootNames: rootFiles,
  });
  const selectedPaths = await resolveSelectedPaths(rootPath, input.relativePaths, overlays);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
    .filter((diagnostic) => diagnosticBelongsToWorkspace(rootPath, diagnostic))
    .filter((diagnostic) => !selectedPaths || !diagnostic.file || selectedPaths.has(path.normalize(diagnostic.file.fileName)))
    .map((diagnostic) => formatDiagnostic(rootPath, diagnostic));
  const maxProblems = Math.max(1, Math.min(MAX_PROBLEMS, input.maxProblems ?? DEFAULT_MAX_PROBLEMS));
  return resultFromDiagnostics(
    configRelativePath,
    rootFiles,
    diagnostics.slice(0, maxProblems),
    diagnostics.length > maxProblems,
    diagnostics,
  );
}

function emptyResult(reason: string, configPath?: string): CodeDiagnosticsResult {
  return {
    available: false,
    ...(configPath ? { configPath } : {}),
    diagnostics: [],
    errorCount: 0,
    fileCount: 0,
    reason,
    truncated: false,
    warningCount: 0,
  };
}

function resultFromDiagnostics(
  configPath: string,
  rootFiles: string[],
  visible: CodeDiagnostic[],
  truncated: boolean,
  all = visible,
): CodeDiagnosticsResult {
  return {
    available: true,
    configPath,
    diagnostics: visible,
    errorCount: all.filter((diagnostic) => diagnostic.severity === "error").length,
    fileCount: rootFiles.length,
    truncated,
    warningCount: all.filter((diagnostic) => diagnostic.severity === "warning").length,
  };
}

async function resolveConfigPath(rootPath: string, requested?: string, targetPath?: string) {
  if (requested?.trim()) {
    const candidate = path.resolve(rootPath, requested);
    if (!isInside(rootPath, candidate) || !/[\\/](?:tsconfig|jsconfig)(?:\.[^\\/]+)?\.json$/i.test(candidate)) {
      throw new Error("诊断配置必须是 Workspace 内的 tsconfig/jsconfig JSON 文件");
    }
    const realPath = await fs.realpath(candidate);
    if (!isInside(rootPath, realPath)) throw new Error("诊断配置越过 Workspace 边界");
    return realPath;
  }

  let current = targetPath?.trim() ? path.dirname(path.resolve(rootPath, targetPath)) : rootPath;
  if (!isInside(rootPath, current)) throw new Error("诊断目标越过 Workspace 边界");
  while (isInside(rootPath, current)) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = path.join(current, name);
      if (await isFile(candidate)) return fs.realpath(candidate);
    }
    if (path.normalize(current) === path.normalize(rootPath)) break;
    current = path.dirname(current);
  }
  return null;
}

async function filterWorkspaceFiles(rootPath: string, fileNames: string[]) {
  const accepted: string[] = [];
  for (const fileName of fileNames) {
    if (!isInside(rootPath, fileName)) continue;
    try {
      const realPath = await fs.realpath(fileName);
      if (isInside(rootPath, realPath)) accepted.push(realPath);
    } catch {
      // TypeScript will report missing configured files through config diagnostics.
    }
  }
  return accepted;
}

async function resolveSelectedPaths(
  rootPath: string,
  relativePaths?: string[],
  overlays: Map<string, { fileName: string; content: string | null }> = new Map(),
) {
  if (!relativePaths?.length) return null;
  const selected = new Set<string>();
  for (const relativePath of relativePaths) {
    const candidate = path.resolve(rootPath, relativePath);
    if (!isInside(rootPath, candidate)) throw new Error("诊断目标越过 Workspace 边界");
    const overlay = overlays.get(pathKey(candidate));
    if (overlay) {
      selected.add(path.normalize(overlay.fileName));
      continue;
    }
    const realPath = await fs.realpath(candidate);
    if (!isInside(rootPath, realPath)) throw new Error("诊断目标越过 Workspace 边界");
    selected.add(path.normalize(realPath));
  }
  return selected;
}

function normalizeOverlays(rootPath: string, values?: Record<string, string | null>) {
  const overlays = new Map<string, { fileName: string; content: string | null }>();
  for (const [relativePath, content] of Object.entries(values ?? {})) {
    const fileName = path.resolve(rootPath, relativePath);
    if (!isInside(rootPath, fileName)) throw new Error("诊断覆盖内容越过 Workspace 边界");
    overlays.set(pathKey(fileName), { fileName, content });
  }
  return overlays;
}

function mergeOverlayRootFiles(
  rootFiles: string[],
  overlays: Map<string, { fileName: string; content: string | null }>,
) {
  const merged = new Map(rootFiles.map((fileName) => [pathKey(fileName), fileName]));
  for (const [key, overlay] of overlays) {
    if (overlay.content === null) {
      merged.delete(key);
    } else if (/\.[cm]?[jt]sx?$/i.test(overlay.fileName)) {
      merged.set(key, overlay.fileName);
    }
  }
  return [...merged.values()];
}

function createOverlayCompilerHost(
  options: ts.CompilerOptions,
  overlays: Map<string, { fileName: string; content: string | null }>,
) {
  const host = ts.createCompilerHost(options, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => {
    const overlay = overlays.get(pathKey(fileName));
    return overlay ? overlay.content !== null : originalFileExists(fileName);
  };
  host.readFile = (fileName) => {
    const overlay = overlays.get(pathKey(fileName));
    return overlay ? overlay.content ?? undefined : originalReadFile(fileName);
  };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const overlay = overlays.get(pathKey(fileName));
    if (!overlay) return originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile);
    if (overlay.content === null) return undefined;
    return ts.createSourceFile(fileName, overlay.content, languageVersion, true, scriptKindForFile(fileName));
  };
  return host;
}

function scriptKindForFile(fileName: string) {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.[cm]?ts$/i.test(fileName)) return ts.ScriptKind.TS;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.Unknown;
}

function pathKey(fileName: string) {
  const normalized = path.normalize(path.resolve(fileName));
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function diagnosticBelongsToWorkspace(rootPath: string, diagnostic: ts.Diagnostic) {
  return !diagnostic.file || isInside(rootPath, diagnostic.file.fileName);
}

function formatDiagnostic(rootPath: string, diagnostic: ts.Diagnostic): CodeDiagnostic {
  const position = diagnostic.file && typeof diagnostic.start === "number"
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null;
  return {
    code: diagnostic.code,
    ...(diagnostic.file ? { file: toWorkspaceRelativePath(rootPath, diagnostic.file.fileName) } : {}),
    ...(position ? { column: position.character + 1, line: position.line + 1 } : {}),
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    severity: diagnosticCategory(diagnostic.category),
  };
}

function diagnosticCategory(category: ts.DiagnosticCategory): CodeDiagnostic["severity"] {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warning";
  if (category === ts.DiagnosticCategory.Suggestion) return "suggestion";
  return "message";
}

function toWorkspaceRelativePath(rootPath: string, absolutePath: string) {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/") || ".";
}

function isInside(rootPath: string, candidate: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function isFile(candidate: string) {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}
