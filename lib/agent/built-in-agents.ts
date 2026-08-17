import type { AgentWorkspaceToolName } from "@/lib/agent/types";

export type BuiltInProjectAgentDefinition = {
  agentType: string;
  description: string;
  systemPrompt: string;
  tools?: AgentWorkspaceToolName[];
  disallowedTools?: AgentWorkspaceToolName[];
  model?: "inherit";
  effort?: "low" | "medium" | "high" | "xhigh";
  background?: boolean;
  criticalSystemReminder?: string;
};

const READ_ONLY_AGENT_TOOLS: AgentWorkspaceToolName[] = [
  "workspace_status",
  "list_directory",
  "glob_files",
  "search_files",
  "code_diagnostics",
  "code_intelligence",
  "search_knowledge",
  "web_search",
  "web_fetch",
  "view_image",
  "read_file",
  "shell_command",
  "git_diff",
  "skill",
  "tool_search",
];

const VERIFICATION_AGENT_TOOLS: AgentWorkspaceToolName[] = [
  ...READ_ONLY_AGENT_TOOLS,
  "browser",
  "list_mcp_resources",
  "read_mcp_resource",
  "task_output",
];

export const BUILT_IN_PROJECT_AGENTS: readonly BuiltInProjectAgentDefinition[] = [
  {
    agentType: "general-purpose",
    description: "General-purpose coding agent for multi-step repository research and implementation tasks.",
    systemPrompt: [
      "You are a general-purpose coding sub-agent.",
      "Complete the delegated task fully without expanding scope unnecessarily.",
      "Search broadly when locations are unknown, reuse existing project patterns, and prefer editing existing files over creating new ones.",
      "When finished, return a concise report of concrete work and important findings to the parent agent.",
    ].join("\n"),
    model: "inherit",
  },
  {
    agentType: "Explore",
    description: "Fast read-only codebase exploration agent for locating files, symbols, patterns, and implementation context.",
    systemPrompt: [
      "You are a read-only codebase exploration specialist.",
      "Search and analyze existing code efficiently. Use broad searches first when locations are unknown, then narrow to precise reads.",
      "Do not create, edit, delete, move, copy, install, or otherwise mutate project files or system state.",
      "If shell access is available, use it only for demonstrably read-only inspection commands.",
      "Return findings directly to the parent agent; do not create documentation files for the report.",
    ].join("\n"),
    tools: READ_ONLY_AGENT_TOOLS,
    model: "inherit",
    effort: "low",
  },
  {
    agentType: "Plan",
    description: "Read-only software planning agent for architecture analysis, implementation strategy, sequencing, and critical-file identification.",
    systemPrompt: [
      "You are a read-only software architecture and implementation-planning specialist.",
      "Understand the delegated requirements, inspect relevant code and existing patterns, trace important paths, and design a concrete implementation strategy.",
      "Do not create, edit, delete, move, copy, install, or otherwise mutate project files or system state.",
      "If shell access is available, use it only for demonstrably read-only inspection commands.",
      "Return a step-by-step plan with dependencies, trade-offs, risks, and the most critical files for implementation.",
    ].join("\n"),
    tools: READ_ONLY_AGENT_TOOLS,
    model: "inherit",
  },
  {
    agentType: "verification",
    description: "Adversarial verification agent that runs real checks and reports PASS, FAIL, or PARTIAL with evidence.",
    systemPrompt: [
      "You are an adversarial verification specialist. Your job is to test whether the delegated implementation actually works, not to confirm it by inspection.",
      "Do not modify project files or install dependencies. You may run existing builds, tests, linters, read-only diagnostics, local preview checks, and other non-project-mutating verification commands.",
      "Exercise the changed behavior directly and include at least one relevant adversarial or boundary probe when possible.",
      "For each important check, retain the exact command or tool action and the observed result as evidence.",
      "End the report with exactly one of: VERDICT: PASS, VERDICT: FAIL, VERDICT: PARTIAL.",
    ].join("\n"),
    tools: VERIFICATION_AGENT_TOOLS,
    model: "inherit",
    background: true,
    criticalSystemReminder: "Verification only: do not modify project files. Finish with VERDICT: PASS, VERDICT: FAIL, or VERDICT: PARTIAL.",
  },
];
