import { callProjectAgentModel } from "@/lib/agent/project-agent-model";
import { MODEL_AGENT_TOOL_DEFINITIONS } from "@/lib/agent/tool-registry";
import type { AgentWorkspaceToolName } from "@/lib/agent/types";
import type { GlobalTaskPlanInput } from "@/lib/global-agent/types";
import { searchProjectKnowledge } from "@/lib/knowledge/index-store";
import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalSettings } from "@/lib/local/settings";
import { getConfirmedMemoryContext } from "@/lib/memory/repository";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceRootCapability, listWorkspaceRoots } from "@/lib/workspace/types";

export async function planGlobalAgentTasks(input: {
  canvasContext?: string;
  goal: string;
  model: string;
  projectId: string;
  signal?: AbortSignal;
}, options: {
  callModel?: typeof callProjectAgentModel;
  dataDir?: string;
} = {}) {
  const goal = input.goal.trim();
  const model = input.model.trim();
  if (!goal || !model) throw new GlobalAgentPlanningError("Global Agent 规划参数无效", "invalid_input");
  const dataDir = options.dataDir ?? getZenmeDataDir();
  const callModel = options.callModel ?? callProjectAgentModel;
  const [settings, memories, knowledge, binding] = await Promise.all([
    getLocalSettings(dataDir),
    getConfirmedMemoryContext(input.projectId, dataDir).catch(() => []),
    searchProjectKnowledge({
      projectId: input.projectId,
      query: goal,
      limit: 30,
      budgetCharacters: 100_000,
    }, dataDir).catch(() => null),
    getLocalWorkspaceBinding(input.projectId, dataDir).catch(() => null),
  ]);
  const roots = binding
    ? listWorkspaceRoots(binding).filter((root) => canUseWorkspaceRootCapability(root, "read"))
      .map((root) => ({ id: root.id, displayName: root.displayName, primary: root.primary }))
    : [];
  const response = await callModel({
    context: [
      "任务应尽量使用不重叠路径；确实依赖前序结果时，用 dependsOn 的零基索引声明。",
      "每个 Sub-agent 只能获得必要路径和工具。文件能力优先使用 workspace_status/list_directory/glob_files/search_files/read_file；理解 TypeScript/JavaScript 定义、引用、实现或调用关系时加入 code_intelligence；修改使用 write_file/edit_file/notebook_edit 或 propose_patch。修改 TypeScript/JavaScript 的任务应加入 code_diagnostics；需要运行测试或启动服务时再加入 shell_command；只有已经能从用户输入或 shell_command 输出获得明确 loopback URL、且任务确实需要页面验证时才加入 browser。不要为重启、枚举后台进程、扫描端口或打开预览分配额外工具。",
      "allowedPathPrefixes 使用 Workspace 相对路径；无法确定时使用 '.'。不要使用绝对路径或 '..'。Sub-agent 不得获得 delegate_tasks。",
      "每个任务必须使用 rootId 指定唯一 Workspace Root；只可使用下列可读根中的稳定 ID。不同 Root 中的相同相对路径互不冲突。",
      `可用 Workspace Roots：${JSON.stringify(roots)}`,
      `画布上下文：${input.canvasContext?.slice(0, 200_000) || "无"}`,
      `已确认 Project Memory：${JSON.stringify(memories)}`,
      `Project Knowledge：${JSON.stringify(knowledge?.results ?? [])}`,
    ].join("\n\n"),
    model,
    mode: "agent_planning",
    prompt: `${goal}\n\n只返回 JSON：{"tasks":[{"title":"...","instruction":"...","rootId":"可用 Workspace Root ID","dependsOn":[],"allowedPathPrefixes":["src/..."],"allowedTools":["read_file","propose_patch"]}]}`,
    signal: input.signal,
    thinkingEnabled: settings.thinkingEnabled,
    reasoningEffort: settings.defaultReasoningEffort,
    modelSpeed: settings.defaultModelSpeed,
  });
  try {
    return parseGlobalTaskPlan(response.text);
  } catch (error) {
    if (error instanceof GlobalAgentPlanningError) throw error;
    throw new GlobalAgentPlanningError(error instanceof Error ? error.message : "Global Agent 任务规划失败", "invalid_plan");
  }
}

export function parseGlobalTaskPlan(value: string): GlobalTaskPlanInput[] {
  const candidate = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); }
  catch { throw new GlobalAgentPlanningError("Global Agent 返回了无效任务计划 JSON", "invalid_plan"); }
  if (!isObject(parsed) || !Array.isArray(parsed.tasks) || parsed.tasks.length < 1 || parsed.tasks.length > 8) {
    throw new GlobalAgentPlanningError("Global Agent 任务计划必须包含 1–8 个 Sub-agent", "invalid_plan");
  }
  return parsed.tasks.map((item, index) => normalizeTask(item, index));
}

export class GlobalAgentPlanningError extends Error {
  constructor(message: string, readonly code: "invalid_input" | "invalid_plan") {
    super(message);
    this.name = "GlobalAgentPlanningError";
  }
}

function normalizeTask(value: unknown, index: number): GlobalTaskPlanInput {
  if (!isObject(value) || typeof value.title !== "string" || typeof value.instruction !== "string" || !value.title.trim() || !value.instruction.trim()) {
    throw new GlobalAgentPlanningError(`第 ${index + 1} 个 Sub-agent 任务无效`, "invalid_plan");
  }
  const dependsOn = Array.isArray(value.dependsOn)
    ? value.dependsOn.filter((item): item is number => Number.isInteger(item) && item >= 0 && item < index)
    : [];
  const allowedPathPrefixes = stringArray(value.allowedPathPrefixes);
  const allowedTools = withCodeDiagnosticsForEdits(stringArray(value.allowedTools).filter(isSubagentTool));
  return {
    title: value.title.trim().slice(0, 500),
    instruction: value.instruction.trim().slice(0, 100_000),
    rootId: typeof value.rootId === "string" && value.rootId.trim() ? value.rootId.trim() : undefined,
    dependsOn,
    allowedPathPrefixes: allowedPathPrefixes.length ? allowedPathPrefixes : ["."],
    allowedTools: allowedTools.length ? allowedTools : undefined,
  };
}

function withCodeDiagnosticsForEdits(tools: AgentWorkspaceToolName[]) {
  const editTools: AgentWorkspaceToolName[] = ["write_file", "edit_file", "notebook_edit", "propose_patch"];
  if (tools.some((tool) => editTools.includes(tool)) && !tools.includes("code_diagnostics")) {
    return [...tools, "code_diagnostics" as const];
  }
  return tools;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isSubagentTool(value: string): value is AgentWorkspaceToolName {
  return value !== "delegate_tasks" && MODEL_AGENT_TOOL_DEFINITIONS.some((tool) => tool.name === value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
