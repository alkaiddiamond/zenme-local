const MAX_PATCH_CHARACTERS = 2 * 1024 * 1024;
const MAX_PATCH_OPERATIONS = 100;

export type ParsedApplyPatchOperation =
  | { kind: "add"; relativePath: string; content: string }
  | { kind: "delete"; relativePath: string }
  | { kind: "move"; relativePath: string; targetRelativePath: string }
  | { kind: "update"; relativePath: string; hunks: ApplyPatchHunk[] };

type ApplyPatchHunk = {
  expectedOldLine?: number;
  lines: string[];
};

export class ApplyPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyPatchError";
  }
}

export function parseApplyPatchDocument(patch: string): ParsedApplyPatchOperation[] {
  if (typeof patch !== "string" || !patch.trim() || patch.length > MAX_PATCH_CHARACTERS || patch.includes("\u0000")) {
    throw new ApplyPatchError("补丁为空、过大或包含无效字符");
  }
  const lines = patch.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") throw new ApplyPatchError("补丁必须以 *** Begin Patch 开始");
  const endIndex = lines.lastIndexOf("*** End Patch");
  if (endIndex < 1 || lines.slice(endIndex + 1).some((line) => line.trim())) {
    throw new ApplyPatchError("补丁必须以 *** End Patch 结束");
  }

  const operations: ParsedApplyPatchOperation[] = [];
  const occupiedPaths = new Set<string>();
  let index = 1;
  while (index < endIndex) {
    if (!lines[index]) {
      index += 1;
      continue;
    }
    const header = parseFileHeader(lines[index]);
    if (!header) throw new ApplyPatchError(`无法识别补丁操作：${lines[index]}`);
    index += 1;
    const body: string[] = [];
    while (index < endIndex && !parseFileHeader(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    while (body.at(-1) === "") body.pop();

    if (occupiedPaths.has(header.relativePath)) throw new ApplyPatchError(`补丁重复操作路径：${header.relativePath}`);
    occupiedPaths.add(header.relativePath);
    if (header.kind === "add") {
      operations.push({ kind: "add", relativePath: header.relativePath, content: parseAddedFile(body) });
      continue;
    }
    if (header.kind === "delete") {
      if (body.some((line) => line.trim())) throw new ApplyPatchError(`删除文件不应包含补丁正文：${header.relativePath}`);
      operations.push({ kind: "delete", relativePath: header.relativePath });
      continue;
    }

    const moveLine = body[0]?.startsWith("*** Move to: ") ? body.shift()! : "";
    const targetRelativePath = moveLine ? requiredPath(moveLine.slice("*** Move to: ".length)) : undefined;
    if (targetRelativePath) {
      if (body.some((line) => line.trim())) throw new ApplyPatchError("移动文件时不能同时修改内容；请拆成独立补丁");
      if (occupiedPaths.has(targetRelativePath)) throw new ApplyPatchError(`补丁重复操作路径：${targetRelativePath}`);
      occupiedPaths.add(targetRelativePath);
      operations.push({ kind: "move", relativePath: header.relativePath, targetRelativePath });
      continue;
    }
    operations.push({ kind: "update", relativePath: header.relativePath, hunks: parseHunks(body, header.relativePath) });
  }
  if (!operations.length || operations.length > MAX_PATCH_OPERATIONS) {
    throw new ApplyPatchError("补丁操作数量无效");
  }
  return operations;
}

export function applyPatchToText(content: string, hunks: ApplyPatchHunk[], relativePath = "文件") {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const finalNewline = normalized.endsWith("\n");
  const sourceLines = normalized.split("\n");
  if (finalNewline) sourceLines.pop();
  let cursor = 0;

  for (const hunk of hunks) {
    const oldLines = hunk.lines.filter((line) => line[0] !== "+").map((line) => line.slice(1));
    const newLines = hunk.lines.filter((line) => line[0] !== "-").map((line) => line.slice(1));
    if (!oldLines.length) {
      if (hunk.expectedOldLine === undefined) {
        throw new ApplyPatchError(`纯新增片段缺少标准行号或上下文：${relativePath}`);
      }
      const insertionIndex = Math.max(0, Math.min(sourceLines.length, hunk.expectedOldLine === 0 ? 0 : hunk.expectedOldLine - 1));
      sourceLines.splice(insertionIndex, 0, ...newLines);
      cursor = insertionIndex + newLines.length;
      continue;
    }

    const expectedIndex = hunk.expectedOldLine === undefined ? -1 : Math.max(0, hunk.expectedOldLine - 1);
    let matchIndex = expectedIndex >= cursor && linesEqualAt(sourceLines, oldLines, expectedIndex) ? expectedIndex : -1;
    if (matchIndex < 0) {
      const matches: number[] = [];
      for (let candidate = cursor; candidate <= sourceLines.length - oldLines.length; candidate += 1) {
        if (linesEqualAt(sourceLines, oldLines, candidate)) matches.push(candidate);
      }
      if (matches.length !== 1) {
        throw new ApplyPatchError(matches.length ? `补丁上下文匹配多处：${relativePath}` : `补丁上下文与当前文件不一致：${relativePath}`);
      }
      matchIndex = matches[0];
    }
    sourceLines.splice(matchIndex, oldLines.length, ...newLines);
    cursor = matchIndex + newLines.length;
  }
  return sourceLines.join(eol) + (finalNewline ? eol : "");
}

export function applyPatchPaths(patch: string) {
  return parseApplyPatchDocument(patch).flatMap((operation) =>
    operation.kind === "move" ? [operation.relativePath, operation.targetRelativePath] : [operation.relativePath]);
}

function parseFileHeader(line: string) {
  for (const [prefix, kind] of [
    ["*** Add File: ", "add"],
    ["*** Delete File: ", "delete"],
    ["*** Update File: ", "update"],
  ] as const) {
    if (line.startsWith(prefix)) return { kind, relativePath: requiredPath(line.slice(prefix.length)) };
  }
  return null;
}

function requiredPath(value: string) {
  const result = value.trim();
  if (!result || result.length > 1_000 || result.includes("\u0000")) throw new ApplyPatchError("补丁路径无效");
  return result.replaceAll("\\", "/");
}

function parseAddedFile(lines: string[]) {
  let finalNewline = true;
  if (lines.at(-1) === "\\ No newline at end of file") {
    lines = lines.slice(0, -1);
    finalNewline = false;
  }
  if (lines.some((line) => !line.startsWith("+"))) throw new ApplyPatchError("新增文件的每一行必须以 + 开头");
  const content = lines.map((line) => line.slice(1)).join("\n");
  return content + (lines.length && finalNewline ? "\n" : "");
}

function parseHunks(lines: string[], relativePath: string): ApplyPatchHunk[] {
  const hunks: ApplyPatchHunk[] = [];
  let current: ApplyPatchHunk | null = null;
  for (const line of lines) {
    if (line.startsWith("@@")) {
      const standardHeader = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
      current = { lines: [], ...(standardHeader ? { expectedOldLine: Number(standardHeader[1]) } : {}) };
      hunks.push(current);
      continue;
    }
    if (line === "\\ No newline at end of file") continue;
    if (!current || ![" ", "+", "-"].includes(line[0] ?? "")) {
      throw new ApplyPatchError(`补丁片段格式无效：${relativePath}`);
    }
    current.lines.push(line);
  }
  if (!hunks.length || hunks.some((hunk) => !hunk.lines.length || !hunk.lines.some((line) => line[0] === "+" || line[0] === "-"))) {
    throw new ApplyPatchError(`更新文件缺少有效修改片段：${relativePath}`);
  }
  return hunks;
}

function linesEqualAt(source: string[], expected: string[], index: number) {
  return index >= 0 && index + expected.length <= source.length && expected.every((line, offset) => source[index + offset] === line);
}
