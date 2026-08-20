import type { AgentWorkspaceToolName } from "@/lib/agent/types";

const TOOL_LABELS: Record<AgentWorkspaceToolName, string> = {
  workspace_status: "Workspace 状态",
  list_directory: "目录列表",
  glob_files: "文件查找",
  search_files: "文件搜索",
  code_diagnostics: "代码诊断",
  code_intelligence: "代码语义导航",
  view_image: "查看图片",
  image_gen: "生成图片",
  image_edit: "编辑图片",
  read_file: "文件读取",
  write_file: "文件写入",
  edit_file: "文件编辑",
  apply_patch: "应用补丁",
  notebook_edit: "Notebook 编辑",
  propose_patch: "ChangeSet 提案",
  propose_memory: "Project Memory 候选",
  search_knowledge: "项目知识搜索",
  list_mcp_resources: "MCP 资源列表",
  read_mcp_resource: "MCP 资源读取",
  web_search: "网页搜索",
  web_fetch: "网页读取",
  browser: "浏览器验证",
  ask_user_question: "请求用户输入",
  enter_plan_mode: "进入规划模式",
  exit_plan_mode: "提交实施计划",
  enter_worktree: "进入 Git Worktree",
  exit_worktree: "退出 Git Worktree",
  shell_command: "运行命令",
  task_output: "后台任务输出",
  task_stop: "停止后台任务",
  delegate_tasks: "并行 Sub-agent",
  workflow: "Agent Workflow",
  team_create: "创建 Agent Team",
  agent_spawn: "启动 Sub-agent",
  send_message: "发送团队消息",
  team_delete: "关闭 Agent Team",
  todo_write: "更新任务计划",
  task_create: "创建项目任务",
  task_get: "读取项目任务",
  task_list: "项目任务列表",
  project_task_list: "项目任务列表",
  task_update: "更新项目任务",
  skill: "加载技能",
  tool_search: "发现工具",
  git_diff: "Git 变更检查",
  run_approved_command: "批准命令",
};

const ACTIVE_TOOL_LABELS: Record<AgentWorkspaceToolName, string> = {
  workspace_status: "正在检查 Workspace",
  list_directory: "正在查看目录",
  glob_files: "正在查找文件",
  search_files: "正在搜索文件",
  code_diagnostics: "正在检查代码",
  code_intelligence: "正在分析代码语义",
  view_image: "正在查看图片",
  image_gen: "正在生成图片",
  image_edit: "正在编辑图片",
  read_file: "正在读取文件",
  write_file: "正在准备文件写入",
  edit_file: "正在准备文件编辑",
  apply_patch: "正在应用补丁",
  notebook_edit: "正在准备 Notebook 编辑",
  propose_patch: "正在准备 ChangeSet",
  propose_memory: "正在整理 Project Memory",
  search_knowledge: "正在搜索项目知识",
  list_mcp_resources: "正在列出 MCP 资源",
  read_mcp_resource: "正在读取 MCP 资源",
  web_search: "正在搜索网页",
  web_fetch: "正在读取网页",
  browser: "正在验证页面",
  ask_user_question: "正在准备问题",
  enter_plan_mode: "正在进入规划模式",
  exit_plan_mode: "正在提交实施计划",
  enter_worktree: "正在创建 Git Worktree",
  exit_worktree: "正在退出 Git Worktree",
  shell_command: "正在运行命令",
  task_output: "正在读取后台任务输出",
  task_stop: "正在停止后台任务",
  delegate_tasks: "正在并行执行 Sub-agent",
  workflow: "正在运行 Agent Workflow",
  team_create: "正在创建 Agent Team",
  agent_spawn: "正在启动 Sub-agent",
  send_message: "正在发送团队消息",
  team_delete: "正在关闭 Agent Team",
  todo_write: "正在更新任务计划",
  task_create: "正在创建项目任务",
  task_get: "正在读取项目任务",
  task_list: "正在列出项目任务",
  project_task_list: "正在列出项目任务",
  task_update: "正在更新项目任务",
  skill: "正在加载技能",
  tool_search: "正在发现可用工具",
  git_diff: "正在读取 Git 变更",
  run_approved_command: "正在执行批准命令",
};

export function getAgentToolLabel(name: string) {
  if (name.startsWith("mcp__")) return mcpToolLabel(name);
  return TOOL_LABELS[name as AgentWorkspaceToolName] ?? humanizeToolName(name);
}

export function getActiveAgentToolLabel(name: string) {
  if (name.startsWith("mcp__")) return `正在调用 ${mcpToolLabel(name)}`;
  return ACTIVE_TOOL_LABELS[name as AgentWorkspaceToolName] ?? `正在执行${humanizeToolName(name)}`;
}

function mcpToolLabel(name: string) {
  const readableName = name.split("__").slice(2).join(" ").replaceAll("_", " ").trim();
  return `MCP · ${readableName || "tool"}`;
}

function humanizeToolName(name: string) {
  const readableName = name.replaceAll("_", " ").trim();
  return readableName || "Workspace 工具";
}
