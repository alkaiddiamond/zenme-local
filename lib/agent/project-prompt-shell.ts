import type { AgentCommandRequest } from "@/lib/agent/types";

export type ProjectPromptShell = "bash" | "powershell";

export type ProjectPromptShellMatch = {
  command: string;
  end: number;
  index: number;
  pattern: string;
  start: number;
};

const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g;
const INLINE_PATTERN = /(^|\s)!`([^`]+)`/gm;

export function projectPromptShellMatches(text: string): ProjectPromptShellMatch[] {
  const matches: Array<Omit<ProjectPromptShellMatch, "index">> = [];
  for (const match of text.matchAll(BLOCK_PATTERN)) {
    const command = match[1]?.trim();
    if (!command || match.index === undefined) continue;
    matches.push({ command, start: match.index, end: match.index + match[0].length, pattern: match[0] });
  }
  if (text.includes("!`")) {
    for (const match of text.matchAll(INLINE_PATTERN)) {
      const command = match[2]?.trim();
      if (!command || match.index === undefined) continue;
      const prefix = match[1] ?? "";
      const start = match.index + prefix.length;
      matches.push({ command, start, end: match.index + match[0].length, pattern: match[0].slice(prefix.length) });
    }
  }
  matches.sort((left, right) => left.start - right.start || left.end - right.end);
  const nonOverlapping = matches.filter((candidate, index, all) =>
    index === 0 || candidate.start >= all[index - 1].end);
  return nonOverlapping.map((match, index) => ({ ...match, index }));
}

export function substituteProjectPromptShellOutputs(
  text: string,
  matches: ProjectPromptShellMatch[],
  outputs: string[],
) {
  if (matches.length !== outputs.length) throw new Error("Skill 嵌入命令输出数量不一致");
  let result = text;
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    result = `${result.slice(0, match.start)}${outputs[index]}${result.slice(match.end)}`;
  }
  return result;
}

export function formatProjectPromptShellOutput(command: Pick<AgentCommandRequest, "stdout" | "stderr">) {
  const parts: string[] = [];
  if (command.stdout?.trim()) parts.push(command.stdout.trim());
  if (command.stderr?.trim()) parts.push(`[stderr]\n${command.stderr.trim()}`);
  return parts.join("\n");
}
