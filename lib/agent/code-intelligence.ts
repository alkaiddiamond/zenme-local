import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

const MAX_ROOT_FILES = 3_000;
const DEFAULT_MAX_RESULTS = 100;
const MAX_RESULTS = 500;

export type CodeIntelligenceOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation"
  | "prepareCallHierarchy"
  | "incomingCalls"
  | "outgoingCalls";

export type CodeIntelligenceItem = {
  column: number;
  containerName?: string;
  display?: string;
  documentation?: string;
  endColumn: number;
  endLine: number;
  file: string;
  kind?: string;
  line: number;
  name?: string;
};

export type CodeIntelligenceResult = {
  available: boolean;
  filePath: string;
  items: CodeIntelligenceItem[];
  operation: CodeIntelligenceOperation;
  reason?: string;
  truncated: boolean;
};

export async function queryTypeScriptCodeIntelligence(input: {
  character: number;
  configPath?: string;
  filePath: string;
  line: number;
  maxResults?: number;
  operation: CodeIntelligenceOperation;
  overlays?: Record<string, string | null>;
  query?: string;
  rootPath: string;
}): Promise<CodeIntelligenceResult> {
  const rootPath = canonicalExistingPath(input.rootPath);
  const filePath = normalizeRelativePath(input.filePath);
  const overlays = normalizeOverlays(rootPath, input.overlays);
  const targetPath = await resolveTargetPath(rootPath, filePath, overlays);
  const configPath = await resolveConfigPath(rootPath, input.configPath, targetPath);
  if (!configPath) return unavailable(input, filePath, "Workspace 中未找到 tsconfig.json 或 jsconfig.json");

  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  if (loaded.error) {
    return unavailable(input, filePath, ts.flattenDiagnosticMessageText(loaded.error.messageText, "\n"));
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(configPath),
    { incremental: false, noEmit: true },
    configPath,
  );
  const rootFiles = mergeOverlayRootFiles(
    parsed.fileNames.filter((candidate) => isInside(rootPath, candidate)),
    overlays,
  );
  if (!rootFiles.some((candidate) => pathKey(candidate) === pathKey(targetPath))) rootFiles.push(targetPath);
  if (rootFiles.length > MAX_ROOT_FILES) {
    return unavailable(input, filePath, `TypeScript 项目包含 ${rootFiles.length} 个根文件，超过 ${MAX_ROOT_FILES} 个语义分析上限`);
  }

  const service = ts.createLanguageService(createLanguageServiceHost(
    rootPath,
    rootFiles,
    { ...parsed.options, incremental: false, noEmit: true },
    overlays,
  ), ts.createDocumentRegistry());
  try {
    const source = service.getProgram()?.getSourceFile(targetPath);
    if (!source) return unavailable(input, filePath, "目标文件未进入 TypeScript/JavaScript 项目");
    const position = sourcePosition(source, input.line, input.character);
    const rawItems = executeOperation(service, source, targetPath, position, input, rootPath);
    const maxResults = normalizeMaxResults(input.maxResults);
    const items = dedupeItems(rawItems.filter((item): item is CodeIntelligenceItem => Boolean(item)));
    return {
      available: true,
      filePath,
      items: items.slice(0, maxResults),
      operation: input.operation,
      truncated: items.length > maxResults,
    };
  } finally {
    service.dispose();
  }
}

function executeOperation(
  service: ts.LanguageService,
  source: ts.SourceFile,
  targetPath: string,
  position: number,
  input: Parameters<typeof queryTypeScriptCodeIntelligence>[0],
  rootPath: string,
) {
  const locate = (fileName: string, span: ts.TextSpan, metadata: Partial<CodeIntelligenceItem> = {}) =>
    locationItem(service, rootPath, fileName, span, metadata);
  switch (input.operation) {
    case "goToDefinition":
      return (service.getDefinitionAtPosition(targetPath, position) ?? [])
        .map((item) => locate(item.fileName, item.textSpan, {
          containerName: item.containerName,
          kind: item.kind,
          name: item.name,
        }));
    case "findReferences":
      return (service.findReferences(targetPath, position) ?? []).flatMap((symbol) =>
        symbol.references.map((item) => locate(item.fileName, item.textSpan, {
          display: item.isDefinition ? "definition" : item.isWriteAccess ? "write" : "reference",
          kind: symbol.definition.kind,
          name: symbol.definition.name,
        })));
    case "hover": {
      const info = service.getQuickInfoAtPosition(targetPath, position);
      return info ? [locate(targetPath, info.textSpan, {
        display: ts.displayPartsToString(info.displayParts),
        documentation: [
          ts.displayPartsToString(info.documentation),
          ...(info.tags ?? []).map((tag) => `@${tag.name} ${ts.displayPartsToString(tag.text)}`.trim()),
        ].filter(Boolean).join("\n"),
        kind: info.kind,
      })] : [];
    }
    case "documentSymbol": {
      const result: Array<CodeIntelligenceItem | null> = [];
      const visit = (item: ts.NavigationTree, containerName?: string) => {
        for (const span of item.spans) result.push(locate(targetPath, span, {
          containerName,
          kind: item.kind,
          name: item.text,
        }));
        for (const child of item.childItems ?? []) visit(child, item.text);
      };
      const tree = service.getNavigationTree(targetPath);
      for (const child of tree.childItems ?? []) visit(child);
      return result;
    }
    case "workspaceSymbol": {
      const query = input.query?.trim() || wordAtPosition(source.text, position);
      if (!query) return [];
      return service.getNavigateToItems(query, MAX_RESULTS, undefined, true, true)
        .map((item) => locate(item.fileName, item.textSpan, {
          containerName: item.containerName,
          display: item.matchKind,
          kind: item.kind,
          name: item.name,
        }));
    }
    case "goToImplementation":
      return (service.getImplementationAtPosition(targetPath, position) ?? [])
        .map((item) => locate(item.fileName, item.textSpan, {
          display: ts.displayPartsToString(item.displayParts),
          kind: item.kind,
        }));
    case "prepareCallHierarchy": {
      const prepared = service.prepareCallHierarchy(targetPath, position);
      return (Array.isArray(prepared) ? prepared : prepared ? [prepared] : [])
        .map((item) => locate(item.file, item.selectionSpan, {
          containerName: item.containerName,
          kind: item.kind,
          name: item.name,
        }));
    }
    case "incomingCalls":
      return service.provideCallHierarchyIncomingCalls(targetPath, position)
        .map((call) => locate(call.from.file, call.from.selectionSpan, {
          containerName: call.from.containerName,
          kind: call.from.kind,
          name: call.from.name,
        }));
    case "outgoingCalls":
      return service.provideCallHierarchyOutgoingCalls(targetPath, position)
        .map((call) => locate(call.to.file, call.to.selectionSpan, {
          containerName: call.to.containerName,
          kind: call.to.kind,
          name: call.to.name,
        }));
  }
}

function createLanguageServiceHost(
  rootPath: string,
  rootFiles: string[],
  options: ts.CompilerOptions,
  overlays: Map<string, { content: string | null; fileName: string }>,
): ts.LanguageServiceHost {
  const readFile = (fileName: string) => {
    const overlay = overlays.get(pathKey(fileName));
    return overlay ? overlay.content ?? undefined : ts.sys.readFile(fileName);
  };
  return {
    fileExists: (fileName) => {
      const overlay = overlays.get(pathKey(fileName));
      return overlay ? overlay.content !== null : ts.sys.fileExists(fileName);
    },
    getCompilationSettings: () => options,
    getCurrentDirectory: () => rootPath,
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    getScriptFileNames: () => rootFiles,
    getScriptSnapshot: (fileName) => {
      const content = readFile(fileName);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getScriptVersion: () => "1",
    readDirectory: ts.sys.readDirectory,
    readFile,
  };
}

function locationItem(
  service: ts.LanguageService,
  rootPath: string,
  fileName: string,
  span: ts.TextSpan,
  metadata: Partial<CodeIntelligenceItem>,
): CodeIntelligenceItem | null {
  const absolutePath = path.resolve(fileName);
  if (!isInside(rootPath, absolutePath)) return null;
  const source = getProgramSourceFile(service.getProgram(), absolutePath);
  if (!source) return null;
  const start = source.getLineAndCharacterOfPosition(span.start);
  const end = source.getLineAndCharacterOfPosition(Math.min(source.text.length, span.start + span.length));
  return {
    column: start.character + 1,
    endColumn: end.character + 1,
    endLine: end.line + 1,
    file: toWorkspaceRelativePath(rootPath, absolutePath),
    line: start.line + 1,
    ...compactMetadata(metadata),
  };
}

function getProgramSourceFile(program: ts.Program | undefined, fileName: string) {
  if (!program) return undefined;
  return program.getSourceFile(fileName) ?? program.getSourceFiles().find((source) => pathKey(source.fileName) === pathKey(fileName));
}

function compactMetadata(metadata: Partial<CodeIntelligenceItem>) {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => typeof value === "string" && value.length > 0));
}

function sourcePosition(source: ts.SourceFile, line: number, character: number) {
  if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(character) || character < 1) {
    throw new Error("代码位置必须使用从 1 开始的有效行列号");
  }
  const starts = source.getLineStarts();
  if (line > starts.length) throw new Error(`目标文件只有 ${starts.length} 行`);
  const lineStart = starts[line - 1];
  const lineEnd = line < starts.length ? starts[line] : source.text.length;
  if (lineStart + character - 1 > lineEnd) throw new Error(`第 ${line} 行没有第 ${character} 列`);
  return lineStart + character - 1;
}

function wordAtPosition(content: string, position: number) {
  let start = position;
  let end = position;
  while (start > 0 && /[$\w]/u.test(content[start - 1])) start -= 1;
  while (end < content.length && /[$\w]/u.test(content[end])) end += 1;
  return content.slice(start, end);
}

async function resolveConfigPath(rootPath: string, requested: string | undefined, targetPath: string) {
  if (requested?.trim()) {
    const candidate = path.resolve(rootPath, normalizeRelativePath(requested));
    if (!isInside(rootPath, candidate) || !/[\\/](?:tsconfig|jsconfig)(?:\.[^\\/]+)?\.json$/i.test(candidate)) {
      throw new Error("语义分析配置必须是 Workspace 内的 tsconfig/jsconfig JSON 文件");
    }
    const realPath = canonicalExistingPath(candidate);
    if (!isInside(rootPath, realPath)) throw new Error("语义分析配置越过 Workspace 边界");
    return realPath;
  }
  let current = path.dirname(targetPath);
  while (isInside(rootPath, current)) {
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const candidate = path.join(current, name);
      if (await isFile(candidate)) return canonicalExistingPath(candidate);
    }
    if (pathKey(current) === pathKey(rootPath)) break;
    current = path.dirname(current);
  }
  return null;
}

async function resolveTargetPath(
  rootPath: string,
  relativePath: string,
  overlays: Map<string, { content: string | null; fileName: string }>,
) {
  const candidate = path.resolve(rootPath, relativePath);
  if (!isInside(rootPath, candidate)) throw new Error("语义分析目标越过 Workspace 边界");
  if (!/\.[cm]?[jt]sx?$/i.test(candidate)) throw new Error("代码语义分析目前支持 TypeScript 与 JavaScript 文件");
  const overlay = overlays.get(pathKey(candidate));
  if (overlay?.content !== null && overlay) return overlay.fileName;
  const realPath = canonicalExistingPath(candidate);
  if (!isInside(rootPath, realPath)) throw new Error("语义分析目标越过 Workspace 边界");
  return realPath;
}

function normalizeOverlays(rootPath: string, values?: Record<string, string | null>) {
  const overlays = new Map<string, { content: string | null; fileName: string }>();
  for (const [relativePath, content] of Object.entries(values ?? {})) {
    const fileName = path.resolve(rootPath, normalizeRelativePath(relativePath));
    if (!isInside(rootPath, fileName)) throw new Error("语义分析覆盖内容越过 Workspace 边界");
    overlays.set(pathKey(fileName), { content, fileName });
  }
  return overlays;
}

function mergeOverlayRootFiles(
  rootFiles: string[],
  overlays: Map<string, { content: string | null; fileName: string }>,
) {
  const merged = new Map(rootFiles.map((fileName) => [pathKey(fileName), fileName]));
  for (const [key, overlay] of overlays) {
    if (overlay.content === null) merged.delete(key);
    else if (/\.[cm]?[jt]sx?$/i.test(overlay.fileName)) merged.set(key, overlay.fileName);
  }
  return [...merged.values()];
}

function dedupeItems(items: CodeIntelligenceItem[]) {
  const unique = new Map<string, CodeIntelligenceItem>();
  for (const item of items) {
    const key = `${item.file}:${item.line}:${item.column}:${item.endLine}:${item.endColumn}:${item.name ?? ""}:${item.display ?? ""}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function normalizeMaxResults(value?: number) {
  if (value === undefined) return DEFAULT_MAX_RESULTS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) throw new Error("语义分析结果上限无效");
  return value;
}

function normalizeRelativePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("语义分析路径必须是 Workspace 内的相对路径");
  }
  return normalized;
}

function unavailable(
  input: Pick<Parameters<typeof queryTypeScriptCodeIntelligence>[0], "operation">,
  filePath: string,
  reason: string,
): CodeIntelligenceResult {
  return { available: false, filePath, items: [], operation: input.operation, reason, truncated: false };
}

function toWorkspaceRelativePath(rootPath: string, absolutePath: string) {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/") || ".";
}

function isInside(rootPath: string, candidate: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function pathKey(fileName: string) {
  const normalized = path.normalize(path.resolve(fileName));
  return process.platform === "win32" ? normalized.toLocaleLowerCase() : normalized;
}

function canonicalExistingPath(candidate: string) {
  return realpathSync.native(candidate);
}

async function isFile(candidate: string) {
  try { return (await fs.stat(candidate)).isFile(); }
  catch { return false; }
}
