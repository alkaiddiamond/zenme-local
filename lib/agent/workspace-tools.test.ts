import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import {
  approveAgentCommand,
  getAgentBackgroundTask,
  isAgentCommandAutoBackgroundAllowed,
  listAgentBackgroundTasks,
  looksLikeInteractiveCommandPrompt,
  proposeAgentCommand,
  rejectAgentCommand,
  runApprovedAgentCommand,
  stopAgentBackgroundTask,
  stopRunningAgentCommands,
  waitForAgentBackgroundTaskCompletion,
} from "@/lib/agent/command-runtime";
import { buildCommandEnvironment } from "@/lib/agent/command-environment";
import { createAgentExecution, finishAgentToolCall, getAgentExecution, startAgentToolCall, updateAgentCommandRequest } from "@/lib/agent/execution-store";
import { continueProjectSkillPromptShell, executeAgentWorkspaceTool, parsePdfPages, projectDelegatedExecutionEvents } from "@/lib/agent/workspace-tools";
import { getProjectAgentModelContext, getProjectAgentSession, updateProjectAgentContext } from "@/lib/agent/project-session-store";
import { createLocalProject } from "@/lib/local/project-repository";
import {
  addLocalWorkspaceRoot,
  bindLocalWorkspace,
  getLocalWorkspaceBinding,
  setLocalWorkspacePermissions,
  setLocalWorkspaceRootPermissions,
} from "@/lib/local/workspace-repository";
import { listWorkspaceChangeSets } from "@/lib/workspace/change-sets";
import { rebuildProjectKnowledgeIndex } from "@/lib/knowledge/index-store";
import { listProjectMemories } from "@/lib/memory/repository";
import { waitForDelegatedOrchestrationRun } from "@/lib/global-agent/delegated-runtime";
import { createGlobalOrchestration, getGlobalOrchestration } from "@/lib/global-agent/orchestration-store";
import { AGENT_MEMORY_ENTRYPOINT } from "@/lib/agent/project-agent-memory";
import { executeAgentToolPipeline } from "@/lib/agent/tool-execution-pipeline";
import { persistAgentToolResultForModel } from "@/lib/agent/tool-result-storage";

const execFileAsync = promisify(execFile);

describe("cc-haha shell auto-background policy", () => {
  it("keeps sleep commands in the foreground unless background was requested explicitly", () => {
    expect(isAgentCommandAutoBackgroundAllowed("sleep 5")).toBe(false);
    expect(isAgentCommandAutoBackgroundAllowed("Start-Sleep -Seconds 5")).toBe(false);
    expect(isAgentCommandAutoBackgroundAllowed("pnpm run dev")).toBe(true);
    expect(isAgentCommandAutoBackgroundAllowed("npm test")).toBe(true);
  });
});

function createSinglePageTextPdf(text: string) {
  const escaped = text.replace(/([\\()])/g, "\\$1");
  const stream = `BT\n/F1 18 Tf\n40 80 Td\n(${escaped}) Tj\nET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(source, "latin1"));
    source += object;
  }
  const xrefOffset = Buffer.byteLength(source, "latin1");
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  source += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  source += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(source, "latin1");
}

describe("PDF page selection", () => {
  it("normalizes ranges and enforces the per-read page budget", () => {
    expect(parsePdfPages("3,1-2,2", 8)).toEqual([1, 2, 3]);
    expect(parsePdfPages(undefined, 3)).toEqual([1, 2, 3]);
    expect(() => parsePdfPages(undefined, 21)).toThrow(/pages|页/);
    expect(() => parsePdfPages("0-2", 8)).toThrow(/1-8/);
    expect(() => parsePdfPages("1-21", 30)).toThrow(/20 页/);
  });
});

let dataDir: string;
let workspaceRoot: string;
let outsideRoot: string;
let projectId: string;
let executionId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-data-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-workspace-"));
  outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-outside-"));
  await fs.mkdir(path.join(workspaceRoot, "src"));
  await fs.writeFile(path.join(workspaceRoot, "src", "alpha.ts"), "export const alpha = 1;\n// searchable needle\n");
  await fs.writeFile(path.join(workspaceRoot, "README.md"), "hello workspace\n");
  await fs.writeFile(path.join(workspaceRoot, ".env"), "SECRET=never-index\n");
  await fs.writeFile(path.join(outsideRoot, "escape.txt"), "outside\n");
  await fs.symlink(outsideRoot, path.join(workspaceRoot, "escape-link"), process.platform === "win32" ? "junction" : "dir");
  await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({
    scripts: {
      dev: "node -e \"setInterval(() => {}, 1000)\"",
      test: "node -e \"console.log('agent-ok')\"",
      slow: "node -e \"setTimeout(() => {}, 5000)\"",
      short: "node -e \"setTimeout(() => { console.log('short-finished') }, 150)\"",
      background: "node -e \"console.log('background-ready'); setInterval(() => {}, 1000)\"",
      prompt: "node -e \"console.log('Continue?'); setInterval(() => {}, 1000)\"",
      "large-output": "node -e \"for(let i=0;i<12000;i++)console.log(String(i).padStart(6,'0')+'x'.repeat(120))\"",
    },
  }));
  projectId = (await createLocalProject({ name: "Agent", prompt: "", model: "" }, dataDir)).id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
  await setLocalWorkspacePermissions({ projectId, permissions: { write: true, execute: true, gitWrite: true } }, dataDir);
  const created = await createAgentExecution({
    projectId,
    instruction: "Inspect and improve alpha",
    resultNodeId: "agent-result",
    triggerNodeId: "agent-request",
    selectedNodeIds: ["context-node"],
    fileDocumentIds: [],
  }, dataDir);
  executionId = created.detail.id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
  await fs.rm(outsideRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
});

describe("agent workspace tools", { timeout: 15_000 }, () => {
  it("extracts selected PDF pages through read_file", async () => {
    await fs.writeFile(path.join(workspaceRoot, "guide.pdf"), createSinglePageTextPdf("hello pdf"));

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "guide.pdf", pages: "1" },
    }, dataDir)).resolves.toMatchObject({
      relativePath: "guide.pdf",
      content: expect.stringContaining("hello pdf"),
    });
    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "guide.pdf", pages: "1" },
    }, dataDir);
    expect(result.content).toContain("PDF page 1/1");
  });

  it("uses a durable plan file as the only writable file in plan mode", async () => {
    await updateProjectAgentContext({ projectId, interactionMode: "plan" }, dataDir);
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "write_file",
      arguments: { relativePath: "@plan/PLAN.md", content: "# Plan\n\n1. Inspect\n" },
    }, dataDir)).resolves.toMatchObject({ operation: "create", status: "written" });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "edit_file",
      arguments: { relativePath: "@plan/PLAN.md", oldText: "Inspect", newText: "Inspect and test" },
    }, dataDir)).resolves.toMatchObject({ replacements: 1, status: "written" });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "@plan/PLAN.md" },
    }, dataDir)).resolves.toMatchObject({ content: "# Plan\n\n1. Inspect and test\n" });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "write_file",
      arguments: { relativePath: "src/forbidden.ts", content: "export {};\n" },
    }, dataDir)).rejects.toThrow("规划模式只能写入");

    const exited = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "exit_plan_mode",
      arguments: { plan: "# Plan\n\n1. Inspect and test\n" },
    }, dataDir);
    expect(exited).toMatchObject({ plan: "# Plan\n\n1. Inspect and test\n", filePath: expect.stringMatching(/PLAN\.md$/) });
    await expect(fs.readFile(exited.filePath, "utf8")).resolves.toBe(exited.plan);
  });

  it("lets only a memory-enabled Agent read, write and edit its persistent memory through normal file tools", async () => {
    const memoryExecution = await createAgentExecution({
      projectId,
      instruction: "Maintain reviewer memory",
      resultNodeId: "memory-result",
      triggerNodeId: "memory-request",
      agentId: "sub-agent:reviewer",
      agentMemory: { agentType: "reviewer", scope: "local" },
    }, dataDir);
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId: memoryExecution.detail.id,
      name: "write_file",
      arguments: { relativePath: AGENT_MEMORY_ENTRYPOINT, content: "Prefer narrow tests." },
    }, dataDir)).resolves.toMatchObject({ status: "written", operation: "create", relativePath: AGENT_MEMORY_ENTRYPOINT });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId: memoryExecution.detail.id,
      name: "edit_file",
      arguments: { relativePath: AGENT_MEMORY_ENTRYPOINT, oldText: "narrow", newText: "focused" },
    }, dataDir)).resolves.toMatchObject({ status: "written", replacements: 1 });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId: memoryExecution.detail.id,
      name: "read_file",
      arguments: { relativePath: AGENT_MEMORY_ENTRYPOINT },
    }, dataDir)).resolves.toMatchObject({ content: "Prefer focused tests.", relativePath: AGENT_MEMORY_ENTRYPOINT });

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: AGENT_MEMORY_ENTRYPOINT },
    }, dataDir)).rejects.toThrow("未配置持久记忆");
  });

  it("inherits a cc-haha-style custom Agent prompt, tools, skills, model and effort", async () => {
    const agentDirectory = path.join(workspaceRoot, ".claude", "agents");
    const skillDirectory = path.join(workspaceRoot, ".claude", "skills", "review-check");
    await fs.mkdir(agentDirectory, { recursive: true });
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "---\nname: review-check\ndescription: Review checklist\n---\nAlways inspect regression tests.");
    await fs.writeFile(path.join(agentDirectory, "reviewer.md"), [
      "---",
      "name: reviewer",
      "description: Strict reviewer",
      "tools: [Read, Grep, Bash]",
      "disallowedTools: [Bash]",
      "skills: [review-check]",
      "model: custom:model",
      "effort: high",
      "maxTurns: 7",
      "memory: local",
      "permissionMode: bypassPermissions",
      "mcpServers: [private-review]",
      "criticalSystemReminder_EXPERIMENTAL: Verify the final evidence.",
      "hooks:",
      "  PreToolUse:",
      "    - matcher: Read",
      "      hooks:",
      "        - type: prompt",
      "          prompt: Confirm the read is necessary.",
      "---",
      "Act as a strict reviewer.",
    ].join("\n"));
    let observedModel = "";
    let observedEffort = "";
    let observedContext = "";
    let observedTools: string[] = [];

    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: { name: "reviewer-1", agentType: "reviewer", instruction: "Review alpha.ts", model: "parent:model" },
      delegatedCallModel: async (input) => {
        observedModel = input.model;
        observedEffort = String(input.reasoningEffort);
        observedContext = input.context;
        observedTools = input.allowedAgentTools ?? [];
        return { text: "Review complete", usage: null };
      },
      turnId: "parent-turn",
    }, dataDir);
    expect(spawned).toMatchObject({
      agentId: expect.any(String),
      taskId: expect.any(String),
      taskType: "local_agent",
      background: false,
      result: "Review complete",
    });
    expect(spawned.taskId).toBe(spawned.agentId);
    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);

    expect(observedModel).toBe("custom:model");
    expect(observedEffort).toBe("high");
    expect(observedContext).toContain("Act as a strict reviewer.");
    expect(observedContext).toContain("Always inspect regression tests.");
    expect(observedContext).toContain("Review alpha.ts");
    expect(observedContext).toContain("Verify the final evidence.");
    expect(observedContext).toContain("<persistent-agent-memory scope=\"local\"");
    expect(observedContext).toContain("@agent-memory/MEMORY.md");
    expect(observedTools).toEqual(expect.arrayContaining(["read_file", "search_files"]));
    expect(observedTools).not.toContain("shell_command");
    await expect(getGlobalOrchestration(projectId, spawned.teamId, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        agentType: "reviewer",
        model: "custom:model",
        reasoningEffort: "high",
        maxTurns: 7,
        memory: "local",
        permissionMode: "neverAsk",
        hooks: { PreToolUse: [expect.objectContaining({ matcher: "Read" })] },
        mcpServers: ["private-review"],
        customizationSource: "project",
      })],
    });
    const persistedAgent = await getGlobalOrchestration(projectId, spawned.teamId, dataDir);
    await expect(getAgentExecution(projectId, persistedAgent!.tasks[0].agentExecutionId!, dataDir)).resolves.toMatchObject({
      context: {
        agentMcpServers: ["private-review"],
        agentCustomizationSource: "project",
      },
    });
  }, 15_000);

  it("spawns cc-haha-style built-in Explore and general-purpose agents through the normal Agent entry", async () => {
    const observations = new Map<string, { context: string; tools: string[] }>();
    const spawn = async (agentType: "Explore" | "general-purpose") => {
      const spawned = await executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "agent_spawn",
        arguments: { name: agentType.toLowerCase(), agentType, instruction: `Run ${agentType}`, model: "parent:model" },
        delegatedCallModel: async (input) => {
          observations.set(agentType, { context: input.context, tools: input.allowedAgentTools ?? [] });
          return { text: `${agentType} complete`, usage: null };
        },
        turnId: `parent-${agentType}`,
      }, dataDir);
      await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
      return spawned;
    };

    const exploreSpawn = await spawn("Explore");
    const generalSpawn = await spawn("general-purpose");
    const explore = observations.get("Explore")!;
    const general = observations.get("general-purpose")!;

    expect(explore.context).toContain("read-only codebase exploration specialist");
    expect(explore.tools).toEqual(expect.arrayContaining(["read_file", "glob_files", "search_files", "shell_command", "tool_search"]));
    expect(explore.tools).not.toEqual(expect.arrayContaining(["write_file", "edit_file", "apply_patch", "notebook_edit"]));
    expect(general.context).toContain("general-purpose coding sub-agent");
    expect(general.tools).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file", "apply_patch", "shell_command"]));
    const exploreOrchestration = await getGlobalOrchestration(projectId, exploreSpawn.teamId, dataDir);
    const generalOrchestration = await getGlobalOrchestration(projectId, generalSpawn.teamId, dataDir);
    expect(exploreOrchestration?.tasks[0]).toMatchObject({ agentType: "Explore" });
    expect(exploreOrchestration?.tasks[0].customizationSource).toBeUndefined();
    expect(generalOrchestration?.tasks[0]).toMatchObject({ agentType: "general-purpose" });
    expect(generalOrchestration?.tasks[0].customizationSource).toBeUndefined();
  }, 20_000);

  it("matches cc-haha Agent foreground/background semantics for ordinary subagents", async () => {
    const foreground = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "foreground-worker",
        agentType: "general-purpose",
        instruction: "Return a foreground result",
        model: "parent:model",
      },
      delegatedCallModel: async () => ({ text: "foreground-result", usage: null }),
      turnId: "foreground-parent",
    }, dataDir);

    expect(foreground).toMatchObject({
      background: false,
      status: "succeeded",
      result: "foreground-result",
    });
    const foregroundOrchestration = await getGlobalOrchestration(projectId, foreground.teamId, dataDir);
    expect(foregroundOrchestration?.tasks[0]).toMatchObject({ status: "succeeded", resultSummary: "foreground-result" });

    let releaseBackground!: () => void;
    const backgroundGate = new Promise<void>((resolve) => { releaseBackground = resolve; });
    const background = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "background-worker",
        agentType: "general-purpose",
        instruction: "Run in the background",
        model: "parent:model",
        run_in_background: true,
      },
      delegatedCallModel: async () => {
        await backgroundGate;
        return { text: "background-result", usage: null };
      },
      turnId: "background-parent",
    }, dataDir);

    expect(background).toMatchObject({ background: true, status: expect.stringMatching(/queued|dispatching|running/) });
    expect(background.result).toBeUndefined();
    releaseBackground();
    await waitForDelegatedOrchestrationRun(projectId, background.teamId, dataDir);
    await expect(getGlobalOrchestration(projectId, background.teamId, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({ status: "succeeded", resultSummary: "background-result" })],
    });
  }, 20_000);

  it("allows unnamed ordinary Agents without implicitly joining an open Team", async () => {
    const team = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "team_create",
      arguments: { teamName: "named-only", maxMembers: 2 },
      turnId: "unnamed-parent",
    }, dataDir);

    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        agentType: "general-purpose",
        instruction: "Inspect without joining the open Team",
        model: "parent:model",
      },
      delegatedCallModel: async () => ({ text: "unnamed-result", usage: null }),
      turnId: "unnamed-parent",
    }, dataDir);

    expect(spawned).toMatchObject({
      background: false,
      name: "general-purpose",
      result: "unnamed-result",
      status: "succeeded",
    });
    expect(spawned.teamId).not.toBe(team.teamId);
    await expect(getGlobalOrchestration(projectId, team.teamId, dataDir)).resolves.toMatchObject({
      kind: "team",
      tasks: [],
    });
  }, 20_000);

  it("requires a name only when agent_spawn explicitly targets a Team", async () => {
    const team = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "team_create",
      arguments: { teamName: "explicit-team", maxMembers: 2 },
      turnId: "explicit-team-parent",
    }, dataDir);

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        teamId: team.teamId,
        instruction: "This teammate is missing its required addressable name",
        model: "parent:model",
      },
      delegatedCallModel: async () => ({ text: "should-not-run", usage: null }),
      turnId: "explicit-team-parent",
    }, dataDir)).rejects.toThrow("Team Agent 必须提供 name");
  });

  it("runs an explicitly isolated Agent in a temporary git worktree and cleans it when unchanged", async () => {
    await execFileAsync("git", ["-C", workspaceRoot, "init", "-b", "main"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.email", "tests@example.com"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.name", "Zenme Tests"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "add", "README.md", "package.json", "src/alpha.ts"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "commit", "-m", "base"], { encoding: "utf8", windowsHide: true });
    await getLocalWorkspaceBinding(projectId, dataDir);

    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: { name: "isolated", instruction: "Inspect only", isolation: "worktree", allowedTools: ["read_file"], model: "test:model" },
      delegatedCallModel: async () => ({ text: "No changes needed", usage: null }),
      turnId: "parent-turn",
    }, dataDir);
    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
    const orchestration = await getGlobalOrchestration(projectId, spawned.teamId, dataDir);
    expect(orchestration?.tasks[0]).toMatchObject({
      status: "succeeded",
      worktree: { state: "cleaned", originalRootId: expect.any(String) },
    });
    await expect(fs.access(orchestration!.tasks[0].worktree!.path)).rejects.toThrow();
  }, 45_000);

  it("switches the main Agent Session into its own worktree and restores the original root safely", async () => {
    await execFileAsync("git", ["-C", workspaceRoot, "init", "-b", "main"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.email", "tests@example.com"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.name", "Zenme Tests"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "add", "README.md", "package.json", "src/alpha.ts"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "commit", "-m", "base"], { encoding: "utf8", windowsHide: true });

    const entered = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "enter_worktree",
      arguments: { name: "feature/review" },
    }, dataDir);
    expect(entered).toMatchObject({ originalRootId: expect.any(String), rootId: expect.any(String) });
    await fs.writeFile(path.join(entered.worktreePath, "README.md"), "worktree-only\n");
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "README.md" },
    }, dataDir)).resolves.toMatchObject({ content: "worktree-only\n", rootId: entered.rootId });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "exit_worktree",
      arguments: { action: "remove" },
    }, dataDir)).rejects.toThrow("永久丢弃");

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "exit_worktree",
      arguments: { action: "keep" },
    }, dataDir)).resolves.toMatchObject({ action: "keep", originalRootId: entered.originalRootId });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "README.md" },
    }, dataDir)).resolves.toMatchObject({ content: "hello workspace\n" });
    expect((await getAgentExecution(projectId, executionId, dataDir))?.context.workspaceRootId).toBe(entered.originalRootId);
    expect((await getProjectAgentSession(projectId, dataDir)).context.activeWorktree).toBeUndefined();

    await execFileAsync("git", ["-C", workspaceRoot, "worktree", "remove", "--force", entered.worktreePath], { windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "branch", "-D", entered.worktreeBranch], { windowsHide: true });
  }, 20_000);

  it("removes a changed main-session worktree only after explicit discard confirmation", async () => {
    await execFileAsync("git", ["-C", workspaceRoot, "init", "-b", "main"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.email", "tests@example.com"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.name", "Zenme Tests"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "add", "README.md", "package.json", "src/alpha.ts"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "commit", "-m", "base"], { encoding: "utf8", windowsHide: true });

    const entered = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "enter_worktree",
      arguments: {},
    }, dataDir);
    await fs.writeFile(path.join(entered.worktreePath, "discarded.txt"), "discard me\n");
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "exit_worktree",
      arguments: { action: "remove", discardChanges: true },
    }, dataDir)).resolves.toMatchObject({ action: "remove", discardedFiles: 1, discardedCommits: 0 });
    await expect(fs.access(entered.worktreePath)).rejects.toThrow();
    expect((await getLocalWorkspaceBinding(projectId, dataDir))?.additionalRoots?.some((root) => root.id === entered.rootId)).toBe(false);
    expect((await getAgentExecution(projectId, executionId, dataDir))?.context.workspaceRootId).toBe(entered.originalRootId);
  }, 20_000);

  it("fires cc-haha Worktree and cwd lifecycle Hooks for the main Agent Session", async () => {
    await execFileAsync("git", ["-C", workspaceRoot, "init", "-b", "main"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.email", "tests@example.com"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "config", "user.name", "Zenme Tests"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "add", "README.md", "package.json", "src/alpha.ts"], { encoding: "utf8", windowsHide: true });
    await execFileAsync("git", ["-C", workspaceRoot, "commit", "-m", "base"], { encoding: "utf8", windowsHide: true });
    const hooked = await createAgentExecution({
      projectId,
      instruction: "Use worktree hooks",
      resultNodeId: "hooked-result",
      triggerNodeId: "hooked-trigger",
      selectedNodeIds: [],
      fileDocumentIds: [],
      agentHooks: Object.fromEntries(["WorktreeCreate", "WorktreeRemove", "CwdChanged"].map((event) => [
        event,
        [{ hooks: [{ type: "http", url: `https://hooks.example.test/${event}` }] }],
      ])),
    }, dataDir);
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { hook_event_name: string };
      events.push(payload.hook_event_name);
      return new Response("{}", { status: 200 });
    }));

    const entered = await executeAgentWorkspaceTool({
      projectId,
      executionId: hooked.detail.id,
      name: "enter_worktree",
      arguments: {},
      delegatedModel: "test:model",
    }, dataDir);
    await executeAgentWorkspaceTool({
      projectId,
      executionId: hooked.detail.id,
      name: "exit_worktree",
      arguments: { action: "remove", discardChanges: true },
      delegatedModel: "test:model",
    }, dataDir);

    expect(events).toEqual(["WorktreeCreate", "CwdChanged", "WorktreeRemove", "CwdChanged"]);
    await expect(fs.access(entered.worktreePath)).rejects.toThrow();
  }, 20_000);

  it("runs a cc-haha-style named Team member and keeps the Team open for coordination", async () => {
    const team = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "team_create",
      arguments: { teamName: "reviewers", description: "持续检查项目", maxMembers: 2 },
      turnId: "parent-turn",
    }, dataDir);
    expect(team).toMatchObject({ teamName: "reviewers", status: "planning" });

    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "tester",
        instruction: "检查回归测试边界",
        model: "test:model",
        allowedPathPrefixes: ["src"],
        allowedTools: ["read_file"],
      },
      delegatedCallModel: async () => ({ text: "测试边界检查完成", usage: null }),
      turnId: "parent-turn",
    }, dataDir);
    expect(spawned).toMatchObject({ teamId: team.teamId, name: "tester", background: true });

    await waitForDelegatedOrchestrationRun(projectId, team.teamId, dataDir);
    await expect(getGlobalOrchestration(projectId, team.teamId, dataDir)).resolves.toMatchObject({
      kind: "team",
      status: "waitingReview",
      tasks: [expect.objectContaining({ name: "tester", status: "succeeded", resultSummary: "测试边界检查完成" })],
    });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "send_message",
      arguments: { teamId: team.teamId, to: "tester", message: "补充检查 Windows", model: "test:model" },
      delegatedCallModel: async (input) => {
        expect(input.context).toContain("补充检查 Windows");
        return { text: "Windows 边界检查完成", usage: null };
      },
    }, dataDir)).resolves.toMatchObject({
      recipients: ["tester"],
      reactivatedAgentIds: [spawned.agentId],
      delivered: true,
    });
    await waitForDelegatedOrchestrationRun(projectId, team.teamId, dataDir);
    await expect(getGlobalOrchestration(projectId, team.teamId, dataDir)).resolves.toMatchObject({
      status: "waitingReview",
      tasks: [expect.objectContaining({ name: "tester", status: "succeeded", resultSummary: "Windows 边界检查完成" })],
    });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "team_delete",
      arguments: { teamId: team.teamId },
    }, dataDir)).resolves.toMatchObject({ success: true, teamName: "reviewers" });
  }, 15_000);

  it("resumes an ordinary background Agent by name on the same persisted execution", async () => {
    let calls = 0;
    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "background-reviewer",
        instruction: "Inspect the first concern",
        model: "test:model",
        run_in_background: true,
      },
      delegatedCallModel: async () => {
        calls += 1;
        return { text: calls === 1 ? "first-pass" : "second-pass", usage: null };
      },
      turnId: "ordinary-background-parent",
    }, dataDir);
    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
    const first = await getGlobalOrchestration(projectId, spawned.teamId, dataDir);
    const originalExecutionId = first?.tasks[0].agentExecutionId;
    expect(originalExecutionId).toBeTruthy();
    expect(first?.tasks[0]).toMatchObject({ status: "succeeded", resultSummary: "first-pass" });

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "send_message",
      arguments: { to: "background-reviewer", message: "Inspect the follow-up concern", model: "test:model" },
      delegatedCallModel: async (input) => {
        calls += 1;
        expect(input.context).toContain("Inspect the follow-up concern");
        return { text: "second-pass", usage: null };
      },
    }, dataDir)).resolves.toMatchObject({
      delivered: true,
      reactivatedAgentIds: [spawned.agentId],
    });

    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
    const resumed = await getGlobalOrchestration(projectId, spawned.teamId, dataDir);
    expect(resumed?.tasks[0]).toMatchObject({
      status: "succeeded",
      resultSummary: "second-pass",
      agentExecutionId: originalExecutionId,
    });
    expect(calls).toBe(2);
  }, 15_000);

  it("resumes an ordinary background Agent by raw agentId on the same persisted execution", async () => {
    let calls = 0;
    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "raw-id-reviewer",
        instruction: "Inspect the initial raw-id concern",
        model: "test:model",
        run_in_background: true,
      },
      delegatedCallModel: async () => {
        calls += 1;
        return { text: calls === 1 ? "raw-first-pass" : "raw-second-pass", usage: null };
      },
      turnId: "raw-id-background-parent",
    }, dataDir);
    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
    const first = await getGlobalOrchestration(projectId, spawned.teamId, dataDir);
    const originalExecutionId = first?.tasks[0].agentExecutionId;
    expect(originalExecutionId).toBeTruthy();

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "send_message",
      arguments: { to: spawned.agentId, message: "Inspect the raw-id follow-up concern", model: "test:model" },
      delegatedCallModel: async (input) => {
        calls += 1;
        expect(input.context).toContain("Inspect the raw-id follow-up concern");
        return { text: "raw-second-pass", usage: null };
      },
    }, dataDir)).resolves.toMatchObject({
      delivered: true,
      reactivatedAgentIds: [spawned.agentId],
    });

    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
    await expect(getGlobalOrchestration(projectId, spawned.teamId, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        status: "succeeded",
        resultSummary: "raw-second-pass",
        agentExecutionId: originalExecutionId,
      })],
    });
    expect(calls).toBe(2);
  }, 15_000);

  it("runs the cc-haha mode=plan teammate approval handshake through the main Agent tool entry", async () => {
    const team = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "team_create",
      arguments: { teamName: "planned-reviewers", maxMembers: 2 },
      turnId: "planned-parent-turn",
    }, dataDir);
    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "planner",
        instruction: "先提交计划，经批准后再完成实现",
        mode: "plan",
        model: "test:model",
      },
      delegatedCallModel: async (input) => {
        expect(input.allowedAgentTools).not.toContain("write_file");
        expect(input.allowedAgentTools).toContain("exit_plan_mode");
        return {
          text: "",
          toolCall: {
            name: "exit_plan_mode",
            arguments: { plan: "1. 阅读实现\n2. 修改代码\n3. 运行测试" },
          },
          usage: null,
        };
      },
      turnId: "planned-parent-turn",
    }, dataDir);
    await waitForDelegatedOrchestrationRun(projectId, team.teamId, dataDir);
    const waiting = await getGlobalOrchestration(projectId, team.teamId, dataDir);
    expect(waiting).toMatchObject({
      tasks: [expect.objectContaining({
        id: spawned.agentId,
        status: "waitingApproval",
        planApproval: expect.objectContaining({ status: "pending" }),
      })],
    });
    const requestId = waiting!.tasks[0].planApproval!.requestId;

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "send_message",
      arguments: {
        teamId: team.teamId,
        to: "planner",
        message: { type: "plan_approval_response", request_id: requestId, approve: true },
        model: "test:model",
      },
      delegatedCallModel: async (input) => {
        expect(input.allowedAgentTools).toContain("write_file");
        expect(input.context).toContain("计划已批准，可以开始实施");
        return { text: "计划获批后已完成", usage: null };
      },
    }, dataDir)).resolves.toMatchObject({
      recipients: ["planner"],
      approved: true,
      delivered: true,
    });
    await waitForDelegatedOrchestrationRun(projectId, team.teamId, dataDir);
    await expect(getGlobalOrchestration(projectId, team.teamId, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        id: spawned.agentId,
        status: "succeeded",
        resultSummary: "计划获批后已完成",
        planApproval: expect.objectContaining({ status: "approved", requestId }),
      })],
    });
  }, 15_000);

  it("uses the isolated desktop browser controller and never persists screenshot base64", async () => {
    const previousUrl = process.env.ZENME_BROWSER_CONTROL_URL;
    const previousToken = process.env.ZENME_DESKTOP_TOKEN;
    process.env.ZENME_BROWSER_CONTROL_URL = "http://127.0.0.1:4567/browser";
    process.env.ZENME_DESKTOP_TOKEN = "desktop-secret";
    const screenshotDataUrl = `data:image/png;base64,${Buffer.from("preview").toString("base64")}`;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      url: "http://127.0.0.1:5173/",
      title: "Local app",
      text: "Save changes",
      elements: [{ ref: "e1", tag: "button", name: "Save changes", bounds: { x: 10, y: 20, width: 100, height: 40 } }],
      screenshot: { dataUrl: screenshotDataUrl, mimeType: "image/png", width: 1280, height: 800 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "browser",
        arguments: { operation: "navigate", url: "http://127.0.0.1:5173/", includeScreenshot: true },
      }, dataDir)).resolves.toMatchObject({
        title: "Local app",
        screenshot: { dataUrl: screenshotDataUrl },
        elements: [{ ref: "e1" }],
      });
      expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4567/browser", expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer desktop-secret" }),
      }));
      const persisted = await getAgentExecution(projectId, executionId, dataDir);
      expect(persisted?.toolCalls.at(-1)).toMatchObject({
        name: "browser",
        status: "succeeded",
        output: { screenshot: { mimeType: "image/png", width: 1280, height: 800 } },
      });
      expect(JSON.stringify(persisted?.toolCalls.at(-1)?.output)).not.toContain("base64");
    } finally {
      vi.unstubAllGlobals();
      if (previousUrl === undefined) delete process.env.ZENME_BROWSER_CONTROL_URL;
      else process.env.ZENME_BROWSER_CONTROL_URL = previousUrl;
      if (previousToken === undefined) delete process.env.ZENME_DESKTOP_TOKEN;
      else process.env.ZENME_DESKTOP_TOKEN = previousToken;
    }
  });

  it("confines a Sub-agent's file and command tools to its assigned Workspace Root", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-additional-"));
    try {
      await fs.mkdir(path.join(additionalRoot, "src"));
      await fs.writeFile(path.join(additionalRoot, "src", "alpha.ts"), "export const alpha = 'additional';\n");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots?.at(-1)?.id;
      expect(rootId).toBeTruthy();
      const scoped = await createAgentExecution({
        projectId,
        workspaceRootId: rootId,
        instruction: "只检查附加根",
        resultNodeId: "scoped-result",
        triggerNodeId: "scoped-trigger",
        allowedPathPrefixes: ["src"],
        allowedTools: ["read_file", "shell_command"],
      }, dataDir);

      await expect(executeAgentWorkspaceTool({
        projectId,
        executionId: scoped.detail.id,
        name: "read_file",
        arguments: { relativePath: "src/alpha.ts" },
      }, dataDir)).resolves.toMatchObject({
        rootId,
        content: expect.stringContaining("additional"),
      });
      const primaryRootId = (await getLocalWorkspaceBinding(projectId, dataDir))!.id;
      await expect(executeAgentWorkspaceTool({
        projectId,
        executionId: scoped.detail.id,
        name: "read_file",
        arguments: { rootId: primaryRootId, relativePath: "src/alpha.ts" },
      }, dataDir)).rejects.toThrow("不得访问分配范围之外");
      await expect(proposeAgentCommand({
        projectId,
        executionId: scoped.detail.id,
        rootId: primaryRootId,
        command: "node --version",
        reason: "不应跨根执行",
      }, dataDir)).rejects.toThrow("超出 Sub-agent 分配的 Workspace Root");
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("shares structured project tasks between independent Agent executions", async () => {
    const created = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_create",
      arguments: { subject: "检查 API", description: "确认 API 行为和测试覆盖", owner: "parent" },
      turnId: "parent-turn",
    }, dataDir);
    const secondExecution = await createAgentExecution({
      projectId,
      instruction: "处理共享任务",
      resultNodeId: "sub-result",
      triggerNodeId: "sub-trigger",
      selectedNodeIds: [],
      fileDocumentIds: [],
      allowedTools: ["task_list", "task_get", "task_update"],
    }, dataDir);

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId: secondExecution.detail.id,
      name: "task_list",
      arguments: {},
    }, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({ id: created.task.id, subject: "检查 API", owner: "parent" })],
    });
    await executeAgentWorkspaceTool({
      projectId,
      executionId: secondExecution.detail.id,
      name: "task_update",
      arguments: { taskId: created.task.id, owner: "subagent", status: "in_progress" },
      turnId: "subagent-execution",
    }, dataDir);
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_get",
      arguments: { taskId: created.task.id },
    }, dataDir)).resolves.toMatchObject({
      task: expect.objectContaining({ owner: "subagent", status: "in_progress" }),
    });
    expect((await getProjectAgentSession(projectId, dataDir)).events.filter((event) => event.type === "todo")).toHaveLength(2);
  });

  it("emits TaskCreated and TaskCompleted Hooks at the project task lifecycle boundaries", async () => {
    const hookExecution = await createAgentExecution({
      projectId,
      instruction: "管理项目任务",
      resultNodeId: "task-hook-result",
      triggerNodeId: "task-hook-trigger",
      agentHooks: {
        TaskCreated: [{ matcher: undefined, hooks: [{ type: "http", url: "https://hooks.example.test/TaskCreated" }] }],
        TaskCompleted: [{ matcher: undefined, hooks: [{ type: "http", url: "https://hooks.example.test/TaskCompleted" }] }],
      },
    }, dataDir);
    const events: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body)) as { hook_event_name: string };
      events.push(payload.hook_event_name);
      return new Response("{}", { status: 200 });
    }));
    const created = await executeAgentWorkspaceTool({
      projectId,
      executionId: hookExecution.detail.id,
      name: "task_create",
      arguments: { subject: "完成 Hook 回归", description: "验证任务生命周期" },
      delegatedModel: "test-model",
      turnId: "task-hook-turn",
    }, dataDir);
    await executeAgentWorkspaceTool({
      projectId,
      executionId: hookExecution.detail.id,
      name: "task_update",
      arguments: { taskId: created.task.id, status: "completed" },
      delegatedModel: "test-model",
      turnId: "task-hook-turn",
    }, dataDir);

    expect(events).toEqual(["TaskCreated", "TaskCompleted"]);
  });

  it("projects child tool activity into the parent waterfall exactly once", async () => {
    const child = await createAgentExecution({
      projectId,
      instruction: "读取说明",
      resultNodeId: "child-result",
      triggerNodeId: "child-trigger",
      subtaskId: "subtask-1",
    }, dataDir);
    const call = await startAgentToolCall({
      projectId,
      executionId: child.detail.id,
      name: "read_file",
      arguments: { relativePath: "README.md" },
    }, dataDir);
    await finishAgentToolCall({
      projectId,
      executionId: child.detail.id,
      toolCallId: call.id,
      output: { content: "hello workspace" },
    }, dataDir);
    const projection = {
      projectId,
      turnId: "parent-turn",
      orchestrationId: "orchestration-1",
      tasks: [{ id: "subtask-1", title: "读取说明", agentExecutionId: child.detail.id }],
    };

    await projectDelegatedExecutionEvents(projection, dataDir);
    await projectDelegatedExecutionEvents(projection, dataDir);

    const session = await getProjectAgentSession(projectId, dataDir);
    const projected = session.events.filter((event) => event.data?.delegatedSourceId === `tool:${call.id}`);
    expect(projected.map((event) => event.type)).toEqual(["toolCall", "toolResult"]);
    expect(projected.every((event) => event.data?.uiProjection === true)).toBe(true);
    expect((await getProjectAgentModelContext(projectId, dataDir)).events).toEqual([]);
  });

  it("observes Workspace images without persisting their base64 payload", async () => {
    await sharp({
      create: { width: 3_000, height: 1_500, channels: 3, background: "#7dd3fc" },
    }).png().toFile(path.join(workspaceRoot, "screen.png"));

    const output = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "view_image",
      arguments: { relativePath: "screen.png" },
    }, dataDir);

    expect(output).toMatchObject({
      relativePath: "screen.png",
      mimeType: "image/webp",
      width: 2_048,
      height: 1_024,
      originalWidth: 3_000,
      originalHeight: 1_500,
    });
    expect(output.dataUrl).toMatch(/^data:image\/webp;base64,/);
    const detail = await getAgentExecution(projectId, executionId, dataDir);
    expect(detail?.toolCalls.at(-1)?.output).toMatchObject({ relativePath: "screen.png", width: 2_048, height: 1_024 });
    expect(detail?.toolCalls.at(-1)?.output).not.toHaveProperty("dataUrl");
  });

  it("does not let image observation escape the Workspace", async () => {
    await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } })
      .png().toFile(path.join(outsideRoot, "outside.png"));

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "view_image",
      arguments: { relativePath: "escape-link/outside.png" },
    }, dataDir)).rejects.toThrow(/Workspace|路径|越界|符号链接/);
  });

  it("inspects a non-Git Workspace without treating Git as a prerequisite", async () => {
    const status = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "workspace_status",
      arguments: { recentFileLimit: 5 },
    }, dataDir);

    expect(status).toMatchObject({
      displayName: path.basename(workspaceRoot),
      status: "resolved",
      changeTracking: "none",
      git: { available: false, branch: null, dirty: null },
      permissions: { read: true, write: true, execute: true },
      summary: { files: 4, sensitiveFiles: 1 },
    });
    expect(status.topLevelEntries).toEqual(expect.arrayContaining([
      { kind: "file", relativePath: "README.md" },
      { kind: "directory", relativePath: "src" },
    ]));
    expect(status.topLevelEntries).not.toContainEqual(expect.objectContaining({ relativePath: ".env" }));
    expect(status.recentFiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: "README.md" }),
    ]));
  });

  it("lists, searches and reads only bounded non-sensitive Workspace files", async () => {
    const listed = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "list_directory",
      arguments: {},
    }, dataDir);
    expect(listed.entries).toEqual(expect.arrayContaining([
      { kind: "directory", relativePath: "src" },
      { kind: "file", relativePath: "README.md" },
    ]));
    expect(listed.entries).not.toContainEqual(expect.objectContaining({ relativePath: ".env" }));

    const searched = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "search_files",
      arguments: { query: "needle", maxResults: 10 },
    }, dataDir);
    expect(searched).toMatchObject({
      matches: [{ relativePath: "src/alpha.ts", line: 2, text: "// searchable needle" }],
    });

    const read = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "src/alpha.ts", startLine: 2, endLine: 200 },
    }, dataDir);
    expect(read).toMatchObject({ content: "// searchable needle\n", startLine: 2, endLine: 3 });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: ".env" },
    }, dataDir)).rejects.toMatchObject({ code: "sensitive_path" });
  });

  it("rejects a giant single-line read before it can overflow the Agent context", async () => {
    await fs.writeFile(path.join(workspaceRoot, "src", "large.json"), `{"payload":"${"测".repeat(30_000)}"}\n`, "utf8");

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "src/large.json" },
    }, dataDir)).rejects.toThrow("超过单次读取上限 25,000");
  });

  it("keeps identical relative paths distinct by stable Workspace root ID", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-additional-root-"));
    try {
      await fs.writeFile(path.join(additionalRoot, "README.md"), "additional workspace needle\n", "utf8");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;

      const status = await executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "workspace_status",
        arguments: { rootId, recentFileLimit: 1 },
      }, dataDir);
      expect(status).toMatchObject({
        rootId,
        primary: false,
        roots: expect.arrayContaining([
          expect.objectContaining({ rootId: binding.id, primary: true }),
          expect.objectContaining({ rootId, primary: false }),
        ]),
      });

      await expect(executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "read_file",
        arguments: { rootId, relativePath: "README.md" },
      }, dataDir)).resolves.toMatchObject({
        rootId,
        relativePath: "README.md",
        content: "additional workspace needle\n",
      });
      await expect(executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "read_file",
        arguments: { relativePath: "README.md" },
      }, dataDir)).resolves.toMatchObject({
        relativePath: "README.md",
        content: "hello workspace\n",
      });

      const searched = await executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "search_files",
        arguments: { query: "needle", maxResults: 10 },
      }, dataDir);
      expect(searched.matches).toEqual(expect.arrayContaining([
        expect.objectContaining({ rootId: binding.id, relativePath: "src/alpha.ts" }),
        expect.objectContaining({ rootId, relativePath: "README.md" }),
      ]));
      const globbed = await executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "glob_files",
        arguments: { pattern: "README.md", maxResults: 10 },
      }, dataDir);
      expect(globbed.matches).toEqual(expect.arrayContaining([
        { rootId: binding.id, relativePath: "README.md" },
        { rootId, relativePath: "README.md" },
      ]));

      const edited = await executeAgentWorkspaceTool({
        projectId,
        executionId,
        name: "edit_file",
        arguments: {
          rootId,
          relativePath: "README.md",
          oldText: "additional workspace",
          newText: "updated additional workspace",
        },
      }, dataDir);
      await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toContainEqual(
        expect.objectContaining({ id: edited.changeSetId, rootId }),
      );
      await expect(fs.readFile(path.join(additionalRoot, "README.md"), "utf8"))
        .resolves.toBe("additional workspace needle\n");
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 15_000);

  it("returns structured code diagnostics through the unified workspace tool", async () => {
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }));
    await fs.writeFile(path.join(workspaceRoot, "src", "broken.ts"), "const value: number = 'broken';\n");

    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "code_diagnostics",
      arguments: { relativePaths: ["src/broken.ts"] },
    }, dataDir);

    expect(result).toMatchObject({ available: true, errorCount: 1, configPath: "tsconfig.json" });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 2322, file: "src/broken.ts", severity: "error" }),
    ]);
  });

  it("exposes cc-haha-style semantic code navigation through the unified tool runtime", async () => {
    await fs.writeFile(path.join(workspaceRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: { strict: true, skipLibCheck: true },
      include: ["src/**/*.ts"],
    }));
    await fs.writeFile(path.join(workspaceRoot, "src", "semantic.ts"), "export function semanticValue() { return 42; }\n");
    await fs.writeFile(path.join(workspaceRoot, "src", "alpha.ts"), [
      "import { semanticValue } from './semantic';",
      "export const alpha = semanticValue();",
      "",
    ].join("\n"));

    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "code_intelligence",
      arguments: {
        operation: "goToDefinition",
        filePath: "src/alpha.ts",
        line: 2,
        character: 23,
      },
    }, dataDir);

    expect(result).toMatchObject({
      available: true,
      operation: "goToDefinition",
      items: [expect.objectContaining({ file: "src/semantic.ts", line: 1, name: "semanticValue" })],
    });
    await expect(getAgentExecution(projectId, executionId, dataDir)).resolves.toMatchObject({
      toolCalls: expect.arrayContaining([expect.objectContaining({ name: "code_intelligence", status: "succeeded" })]),
    });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "code_intelligence",
      arguments: { operation: "hover", filePath: ".env", line: 1, character: 1 },
    }, dataDir)).rejects.toMatchObject({ code: "sensitive_path" });
  });

  it("loads a discovered project skill through the shared tool runtime", async () => {
    const skillDirectory = path.join(workspaceRoot, ".zenme", "skills", "inspect-project");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      "name: inspect-project",
      "description: Inspect the current project",
      "---",
      "Use workspace_status before $ARGUMENTS.",
    ].join("\n"));

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "skill",
      arguments: { skill: "inspect-project", args: "reporting" },
    }, dataDir)).resolves.toMatchObject({
      name: "inspect-project",
      content: expect.stringContaining("Use workspace_status before reporting."),
    });
  });

  it("expands model-invoked Skill shell expressions through the normal command runtime", async () => {
    const skillDirectory = path.join(workspaceRoot, ".zenme", "skills", "inspect-git");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      "name: inspect-git",
      "description: Inspect Git",
      "shell: bash",
      "allowed-tools: [Bash(git --version)]",
      "---",
      "Detected version: !`git --version`",
    ].join("\n"));

    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "skill",
      arguments: { skill: "inspect-git" },
    }, dataDir);

    expect(result.content).toMatch(/Detected version: git version/i);
    expect(result.content).not.toContain("!`git --version`");
    expect(result.promptShellState).toBeUndefined();
    expect(result.pendingCommand).toBeUndefined();
  }, 30_000);

  it("resumes a model-invoked Skill shell expression after approval without re-running prior work", async () => {
    const skillDirectory = path.join(workspaceRoot, ".zenme", "skills", "write-marker");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      "name: write-marker",
      "description: Write a marker",
      "shell: bash",
      "---",
      "First: !`printf x >> shell-count.txt && printf first`",
      "Second: !`curl --version | head -n 1`",
    ].join("\n"));

    const approvalExecution = await createAgentExecution({
      projectId,
      instruction: "Run approval Skill",
      resultNodeId: "approval-result",
      triggerNodeId: "approval-request",
      permissionMode: "onRequest",
    }, dataDir);
    const approvalExecutionId = approvalExecution.detail.id;
    const waiting = await executeAgentWorkspaceTool({
      projectId,
      executionId: approvalExecutionId,
      name: "skill",
      arguments: { skill: "write-marker" },
    }, dataDir);
    expect(waiting.promptShellState).toMatchObject({ pendingCommandId: waiting.pendingCommand?.id });
    expect(waiting.pendingCommand).toBeDefined();

    await approveAgentCommand(projectId, approvalExecutionId, waiting.pendingCommand!.id, dataDir);
    await runApprovedAgentCommand({ projectId, executionId: approvalExecutionId, commandId: waiting.pendingCommand!.id }, dataDir);
    const resumed = await continueProjectSkillPromptShell({
      projectId,
      executionId: approvalExecutionId,
      loaded: waiting,
    }, dataDir);

    expect(resumed.content).toContain("First: first");
    expect(resumed.content).toMatch(/Second: curl /i);
    expect(resumed.promptShellState).toBeUndefined();
    expect(await fs.readFile(path.join(workspaceRoot, "shell-count.txt"), "utf8")).toBe("x");
  }, 30_000);

  it("runs a context-fork skill synchronously and returns only its final sub-agent result", async () => {
    const skillDirectory = path.join(workspaceRoot, ".claude", "skills", "forked-review");
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, "SKILL.md"), [
      "---",
      "name: forked-review",
      "description: Review in isolation",
      "context: fork",
      "allowed-tools: [Bash(git config:*)]",
      "effort: high",
      "---",
      "Review $ARGUMENTS without asking the parent to perform the work.",
    ].join("\n"));
    let observedContext = "";
    let observedEffort = "";

    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "skill",
      arguments: { skill: "forked-review", args: "the release" },
      delegatedModel: "test:model",
      delegatedCallModel: async (input) => {
        observedContext = input.context;
        observedEffort = String(input.reasoningEffort);
        return { text: "Forked review complete", usage: null };
      },
      turnId: "parent-turn",
    }, dataDir);

    expect(observedContext).toContain("Review the release without asking the parent");
    expect(observedEffort).toBe("high");
    expect(result).toMatchObject({
      name: "forked-review",
      forked: true,
      status: "succeeded",
      result: "Forked review complete",
      orchestrationId: expect.any(String),
      agentId: expect.any(String),
    });
    await expect(getGlobalOrchestration(projectId, result.orchestrationId!, dataDir)).resolves.toMatchObject({
      tasks: [expect.objectContaining({
        additionalAllowedTools: ["Bash(git config:*)"],
        resultSummary: "Forked review complete",
      })],
    });
    const projectedEvents = (await getProjectAgentSession(projectId, dataDir)).events
      .filter((event) => event.turnId === "parent-turn");
    expect(projectedEvents).toContainEqual(expect.objectContaining({
      type: "status",
      data: expect.objectContaining({
        stage: "delegating",
        orchestrationId: result.orchestrationId,
        totalCount: 1,
      }),
    }));
  }, 15_000);

  it("finds files with bounded Glob patterns", async () => {
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "glob_files",
      arguments: { pattern: "**/*.ts", maxResults: 20 },
    }, dataDir)).resolves.toEqual({ paths: ["src/alpha.ts"], truncated: false });

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "glob_files",
      arguments: { pattern: "../**/*" },
    }, dataDir)).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("rejects traversal and links escaping the authorized root", async () => {
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "../escape.txt" },
    }, dataDir)).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "escape-link/escape.txt" },
    }, dataDir)).rejects.toThrow("授权根目录");
  });

  it("creates an Agent ChangeSet without writing the Workspace", async () => {
    const proposed = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "propose_patch",
      arguments: {
        title: "Update alpha",
        operations: [{
          kind: "modify",
          relativePath: "src/alpha.ts",
          proposedContent: "export const alpha = 2;\n",
        }],
      },
    }, dataDir);
    expect(await fs.readFile(path.join(workspaceRoot, "src", "alpha.ts"), "utf8")).toContain("alpha = 1");
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({
        id: proposed.changeSetId,
        source: "agent",
        sourceExecutionId: executionId,
        status: "proposed",
      }),
    ]);
    await expect(getAgentExecution(projectId, executionId, dataDir)).resolves.toMatchObject({
      changeSetIds: [proposed.changeSetId],
      stage: "editing",
    });
  });

  it("maps Write, Edit and NotebookEdit onto reviewable ChangeSets", async () => {
    await fs.writeFile(path.join(workspaceRoot, "analysis.ipynb"), JSON.stringify({
      cells: [{ cell_type: "code", source: ["print('before')\n"], metadata: {}, outputs: [], execution_count: null }],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    }));

    const written = await executeAgentWorkspaceTool({
      projectId, executionId, name: "write_file",
      arguments: { relativePath: "src/new.ts", content: "export const created = true;\n" },
    }, dataDir);
    const edited = await executeAgentWorkspaceTool({
      projectId, executionId, name: "edit_file",
      arguments: { relativePath: "src/alpha.ts", oldText: "alpha = 1", newText: "alpha = 2" },
    }, dataDir);
    const notebook = await executeAgentWorkspaceTool({
      projectId, executionId, name: "notebook_edit",
      arguments: { relativePath: "analysis.ipynb", cellIndex: 0, source: "print('after')\n" },
    }, dataDir);

    expect(written).toMatchObject({ operation: "create", status: "proposed" });
    expect(edited).toMatchObject({ replacements: 1, status: "proposed" });
    expect(notebook).toMatchObject({ cellIndex: 0, status: "proposed" });
    await expect(fs.stat(path.join(workspaceRoot, "src", "new.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(path.join(workspaceRoot, "src", "alpha.ts"), "utf8")).toContain("alpha = 1");
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toHaveLength(3);
  });

  it("maps a multi-file apply_patch onto one reviewable ChangeSet without touching disk", async () => {
    await fs.writeFile(path.join(workspaceRoot, "src", "old.ts"), "export const old = true;\n");
    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "apply_patch",
      arguments: {
        title: "Update project files",
        patch: `*** Begin Patch
*** Update File: src/alpha.ts
@@ -1,2 +1,2 @@
-export const alpha = 1;
+export const alpha = 2;
 // searchable needle
*** Add File: src/new.ts
+export const created = true;
*** Delete File: src/old.ts
*** End Patch`,
      },
    }, dataDir);

    expect(result).toMatchObject({ operationCount: 3, status: "proposed", paths: ["src/alpha.ts", "src/new.ts", "src/old.ts"] });
    expect(await fs.readFile(path.join(workspaceRoot, "src", "alpha.ts"), "utf8")).toContain("alpha = 1");
    await expect(fs.stat(path.join(workspaceRoot, "src", "new.ts"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(workspaceRoot, "src", "old.ts"))).resolves.toBeTruthy();
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({
        id: result.changeSetId,
        source: "agent",
        status: "proposed",
        operations: [
          expect.objectContaining({ kind: "modify", relativePath: "src/alpha.ts", proposedContent: expect.stringContaining("alpha = 2") }),
          expect.objectContaining({ kind: "create", relativePath: "src/new.ts" }),
          expect.objectContaining({ kind: "delete", relativePath: "src/old.ts" }),
        ],
      }),
    ]);
  });

  it("rejects stale and sensitive apply_patch input before creating a ChangeSet", async () => {
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "apply_patch",
      arguments: { patch: "*** Begin Patch\n*** Update File: src/alpha.ts\n@@\n-not current\n+changed\n*** End Patch" },
    }, dataDir)).rejects.toMatchObject({ code: "invalid_arguments" });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "apply_patch",
      arguments: { patch: "*** Begin Patch\n*** Add File: .env\n+SECRET=exposed\n*** End Patch" },
    }, dataDir)).rejects.toMatchObject({ code: "sensitive_path" });
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([]);
  });

  it("enforces every apply_patch path against a Sub-agent path scope", async () => {
    const child = await createAgentExecution({
      projectId,
      instruction: "只修改 src/allowed",
      resultNodeId: "scoped-patch-result",
      triggerNodeId: "scoped-patch-source",
      allowedPathPrefixes: ["src/allowed"],
      allowedTools: ["apply_patch"],
    }, dataDir);
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId: child.detail.id,
      name: "apply_patch",
      arguments: { patch: "*** Begin Patch\n*** Add File: src/outside.ts\n+export const outside = true;\n*** End Patch" },
    }, dataDir)).rejects.toThrow("路径超出任务范围");
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([]);
  });

  it("rejects retired internal task tools from the generic runtime and still discovers current tools", async () => {
    await expect(executeAgentWorkspaceTool({
      projectId, executionId, name: "todo_write",
      arguments: { items: [{ id: "inspect", content: "检查实现", status: "in_progress" }] },
    }, dataDir)).rejects.toThrow("历史兼容工具不再允许");
    await expect(executeAgentWorkspaceTool({
      projectId, executionId, name: "project_task_list",
      arguments: {},
    }, dataDir)).rejects.toThrow("历史兼容工具不再允许");
    const discovered = await executeAgentWorkspaceTool({
      projectId, executionId, name: "tool_search",
      arguments: { query: "Glob", maxResults: 5 },
    }, dataDir);

    expect(discovered.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "glob_files" })]));
  });

  it("does not return blanket-denied built-in or MCP tools from ToolSearch", async () => {
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: { deny: ["Glob", "mcp__github"] },
    }));
    const discovered = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "tool_search",
      arguments: { query: "Glob", maxResults: 30 },
      deferredToolSearchResults: [{
        name: "mcp__github__create_issue",
        description: "Create issue",
        permission: "execute",
        requiresWorkspace: true,
        parameters: {},
        serverName: "github",
      }],
    }, dataDir);

    expect(discovered.tools.map((tool) => tool.name)).not.toContain("glob_files");
    expect(discovered.tools.map((tool) => tool.name)).not.toContain("mcp__github__create_issue");
  });

  it("enforces cc-haha content permission rules for non-Shell tools", async () => {
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: {
        deny: ["Read(README.md)"],
        ask: ["WebFetch(https://example.com/private)"],
      },
    }));

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "README.md" },
    }, dataDir)).rejects.toMatchObject({
      code: "permission_denied",
      message: expect.stringContaining("read_file"),
    });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: "src/alpha.ts" },
    }, dataDir)).resolves.toMatchObject({ relativePath: "src/alpha.ts" });
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "web_fetch",
      arguments: { url: "https://example.com/private", prompt: "Read the page" },
    }, dataDir)).rejects.toMatchObject({
      code: "approval_required",
      message: expect.stringContaining("web_fetch"),
    });
  });

  it("enters Plan Mode immediately and only asks for confirmation when leaving", async () => {
    const enter = await executeAgentWorkspaceTool({
      projectId, executionId, name: "enter_plan_mode", arguments: {},
    }, dataDir);
    const exit = await executeAgentWorkspaceTool({
      projectId, executionId, name: "exit_plan_mode", arguments: { plan: "## 实施计划\n1. 修改运行时" },
    }, dataDir);

    expect(enter).toMatchObject({ status: "entered", message: expect.stringContaining("已进入规划模式") });
    expect(exit).toMatchObject({
      status: "waitingInput",
      plan: "## 实施计划\n1. 修改运行时",
      options: expect.arrayContaining([expect.objectContaining({ label: "批准并开始实施" })]),
    });
  });

  it("searches explainable project knowledge and can only propose candidate memory", async () => {
    await rebuildProjectKnowledgeIndex({ projectId }, dataDir);
    const knowledge = await executeAgentWorkspaceTool({ projectId, executionId, name: "search_knowledge", arguments: { query: "searchable needle", limit: 10 } }, dataDir);
    expect(knowledge.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: expect.objectContaining({ id: "file:src/alpha.ts" }), evidence: expect.any(Array) }),
    ]));
    const proposed = await executeAgentWorkspaceTool({ projectId, executionId, name: "propose_memory", arguments: {
      kind: "file", title: "Needle location", content: "The needle lives in alpha.", sources: [
        { kind: "workspaceFile", id: "src/alpha.ts", label: "alpha", relativePath: "src/alpha.ts" },
      ],
    } }, dataDir);
    await expect(listProjectMemories(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: proposed.memoryId, status: "candidate", sources: expect.arrayContaining([expect.objectContaining({ kind: "execution", id: executionId })]) }),
    ]);
  });

  it("returns a bounded Git diff without exposing sensitive paths", async () => {
    await execFileAsync("git", ["init"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.email", "agent@example.invalid"], { cwd: workspaceRoot });
    await execFileAsync("git", ["config", "user.name", "Agent Test"], { cwd: workspaceRoot });
    await execFileAsync("git", ["add", "README.md", "src/alpha.ts", "package.json"], { cwd: workspaceRoot });
    await execFileAsync("git", ["commit", "-m", "baseline"], { cwd: workspaceRoot });
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
    await fs.writeFile(path.join(workspaceRoot, "README.md"), "changed\n");
    await fs.writeFile(path.join(workspaceRoot, ".env"), "SECRET=changed\n");

    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "git_diff",
      arguments: {},
    }, dataDir);
    expect(result.diff).toContain("README.md");
    expect(result.diff).not.toContain("SECRET");
    expect(result.diff).not.toContain(".env");
  });

  it("treats Git diff as unavailable capability instead of a failed workspace inspection", async () => {
    const result = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "git_diff",
      arguments: {},
    }, dataDir);

    expect(result).toEqual({
      state: "not_git_repository",
      diff: "",
      truncated: false,
    });
    await expect(getAgentExecution(projectId, executionId, dataDir)).resolves.toMatchObject({
      toolCalls: expect.arrayContaining([
        expect.objectContaining({ name: "git_diff", status: "succeeded" }),
      ]),
    });
  });

  it("launches a deterministic Workflow in the background and exposes its terminal result through TaskOutput", async () => {
    const launched = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      turnId: "workflow-turn",
      name: "workflow",
      arguments: {
        script: `export const meta = { name: "summary", description: "Produce a deterministic result", phases: [{ title: "Summarize" }] };\nphase("Summarize");\nreturn { ok: true };`,
      },
      delegatedModel: "test-model",
    }, dataDir);
    expect(launched).toMatchObject({
      status: "async_launched",
      taskType: "local_workflow",
      workflowName: "summary",
      taskId: expect.any(String),
      runId: expect.any(String),
    });

    const output = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_output",
      arguments: { task_id: launched.taskId, block: true, timeout: 5_000 },
    }, dataDir);
    expect(output).toMatchObject({
      taskId: launched.taskId,
      taskType: "local_workflow",
      status: "succeeded",
      outcome: { result: { ok: true }, agentCount: 0, failures: [] },
      events: expect.arrayContaining([expect.objectContaining({ type: "workflow_phase", title: "Summarize" })]),
    });
  });

  it("uses cc-haha TaskOutput and TaskStop for a background Agent task ID", async () => {
    const orchestration = await createGlobalOrchestration({
      projectId,
      goal: "Inspect the workspace in the background",
      resultNodeId: executionId,
      triggerNodeId: executionId,
      tasks: [{
        name: "inspector",
        title: "Inspect workspace",
        instruction: "Read the project and report findings",
        allowedTools: ["read_file"],
      }],
    }, dataDir);
    const taskId = orchestration.tasks[0].id;

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_output",
      arguments: { task_id: taskId, block: false },
    }, dataDir)).resolves.toMatchObject({
      taskId,
      taskType: "local_agent",
      orchestrationId: orchestration.id,
      agentId: taskId,
      status: "queued",
      prompt: "Read the project and report findings",
    });

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_stop",
      arguments: { task_id: taskId },
    }, dataDir)).resolves.toMatchObject({
      taskId,
      taskType: "local_agent",
      status: "stopped",
    });
  });

  it("does not let an in-flight background Agent response overwrite TaskStop", async () => {
    let markModelStarted!: () => void;
    let markModelAborted!: () => void;
    const modelStarted = new Promise<void>((resolve) => { markModelStarted = resolve; });
    const modelAborted = new Promise<void>((resolve) => { markModelAborted = resolve; });
    const spawned = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "agent_spawn",
      arguments: {
        name: "slow-inspector",
        instruction: "Wait for the test to release the model response",
        model: "test:model",
        run_in_background: true,
      },
      delegatedCallModel: async (input) => {
        markModelStarted();
        return new Promise<{ text: string; usage: null }>((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            markModelAborted();
            reject(new DOMException("Aborted", "AbortError"));
          }, { once: true });
        });
      },
      turnId: "parent-turn",
    }, dataDir);
    await modelStarted;

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_stop",
      arguments: { task_id: spawned.taskId },
    }, dataDir)).resolves.toMatchObject({ status: "stopped" });

    await modelAborted;
    await waitForDelegatedOrchestrationRun(projectId, spawned.teamId, dataDir);
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "task_output",
      arguments: { task_id: spawned.taskId, block: false },
    }, dataDir)).resolves.toMatchObject({
      taskId: spawned.taskId,
      taskType: "local_agent",
      status: "stopped",
      result: undefined,
    });
  });
});

describe("approved agent commands", { timeout: 15_000 }, () => {
  it("runs a command in the explicitly selected additional root and rejects root/cwd mismatches", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-command-root-"));
    try {
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;
      await setLocalWorkspaceRootPermissions({ projectId, rootId, permissions: { gitWrite: true } }, dataDir);
      await setLocalWorkspacePermissions({ projectId, permissions: { read: false } }, dataDir);
      const command = await proposeAgentCommand({
        projectId,
        executionId,
        rootId,
        executable: "git",
        args: ["init"],
        cwd: ".",
        reason: "Initialize the selected additional root",
      }, dataDir);
      expect(command).toMatchObject({ rootId, cwd: "." });
      await approveAgentCommand(projectId, executionId, command.id, dataDir);
      await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
        .resolves.toMatchObject({ status: "succeeded", exitCode: 0 });
      await expect(fs.stat(path.join(additionalRoot, ".git"))).resolves.toMatchObject({});
      await expect(fs.stat(path.join(workspaceRoot, ".git"))).rejects.toMatchObject({ code: "ENOENT" });

      await expect(proposeAgentCommand({
        projectId,
        executionId,
        rootId,
        executable: "git",
        args: ["status", "--short"],
        cwd: workspaceRoot,
        reason: "Do not cross root identities",
      }, dataDir)).rejects.toMatchObject({ code: "invalid_command" });
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("keeps the resolved Node runtime on PATH for native Windows package scripts", () => {
    expect(buildCommandEnvironment(
      "C:\\Tools\\nodejs\\node.exe",
      { Path: "C:\\Windows\\System32" },
      "win32",
    ).Path).toBe("C:\\Tools\\nodejs;C:\\Windows\\System32");
  });

  it("keeps the host Node runtime on PATH for package scripts launched through PowerShell", () => {
    expect(buildCommandEnvironment(
      "powershell",
      { Path: "C:\\Windows\\System32" },
      "win32",
      "C:\\Program Files\\nodejs\\node.exe",
    ).Path).toBe("C:\\Program Files\\nodejs;C:\\Windows\\System32");
  });

  it("keeps declared development scripts in the foreground until the runtime budget expires", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "pnpm",
      args: ["run", "dev"],
      reason: "Start the declared development mode",
    }, dataDir);

    expect(command).toMatchObject({ background: false, requiresExplicitApproval: false });
  });

  it("honors an explicit Skill shell without falling back to the platform default", async () => {
    const bash = await proposeAgentCommand({
      projectId,
      executionId,
      command: "printf shell",
      shell: "bash",
      reason: "Expand Skill prompt",
    }, dataDir);
    const powershell = await proposeAgentCommand({
      projectId,
      executionId,
      command: "Write-Output shell",
      shell: "powershell",
      reason: "Expand Skill prompt",
    }, dataDir);

    expect(bash).toMatchObject({ executable: "bash", args: ["-lc", "printf shell"] });
    expect(powershell).toMatchObject({
      executable: "powershell",
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output shell"],
    });
  });

  it("persists a rejected command without executing it", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["init"],
      reason: "Initialize repository",
    }, dataDir);

    await expect(rejectAgentCommand(projectId, executionId, command.id, dataDir)).resolves.toMatchObject({
      id: command.id,
      status: "rejected",
      error: "用户拒绝执行命令",
    });
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .rejects.toMatchObject({ code: "approval_required" });
    await expect(getAgentExecution(projectId, executionId, dataDir)).resolves.toMatchObject({ stage: "planning" });
  });

  it("runs once in an approved external directory and can persist it as a project root", async () => {
    const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-external-root-"));
    try {
      const once = await proposeAgentCommand({
        projectId,
        executionId,
        executable: "git",
        args: ["init"],
        cwd: externalRoot,
        reason: "Initialize external repository",
      }, dataDir);
      expect(once.externalRoot?.realPath).toBe(await fs.realpath(externalRoot));
      await approveAgentCommand(projectId, executionId, once.id, dataDir);
      await expect(runApprovedAgentCommand({ projectId, executionId, commandId: once.id }, dataDir))
        .resolves.toMatchObject({ status: "succeeded", approvalScope: "once" });

      const persistent = await proposeAgentCommand({
        projectId,
        executionId,
        executable: "git",
        args: ["status", "--short"],
        cwd: externalRoot,
        reason: "Inspect external repository",
      }, dataDir);
      await approveAgentCommand(projectId, executionId, persistent.id, dataDir, "project");
      await expect(getLocalWorkspaceBinding(projectId, dataDir)).resolves.toMatchObject({
        additionalRoots: [expect.objectContaining({ realPath: await fs.realpath(externalRoot) })],
      });
      await expect(runApprovedAgentCommand({ projectId, executionId, commandId: persistent.id }, dataDir))
        .resolves.toMatchObject({ status: "succeeded", approvalScope: "project" });
    } finally {
      await fs.rm(externalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("treats an explicit command approval as execution permission even when the project toggle is off", async () => {
    await setLocalWorkspacePermissions({ projectId, permissions: { execute: false } }, dataDir);
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["init"],
      reason: "Initialize after one explicit approval",
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .resolves.toMatchObject({ status: "succeeded", approvalScope: "once" });
  });

  it("lets never-ask policy run a validated Workspace command without elevating the binding", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["init"],
      reason: "Initialize the bound workspace",
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);

    await expect(runApprovedAgentCommand({
      allowSandboxedWithoutExecutePermission: true,
      projectId,
      executionId,
      commandId: command.id,
    }, dataDir)).resolves.toMatchObject({ status: "succeeded", exitCode: 0 });
  });

  it("classifies workspace-local git init for normal execution and rejects destructive git commands", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["init", "-b", "main"],
      reason: "Initialize the bound workspace",
    }, dataDir);
    expect(command).toMatchObject({
      requiresExplicitApproval: false,
      sandboxMode: "workspace-write",
    });
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .rejects.toMatchObject({ code: "approval_required" });
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .resolves.toMatchObject({ status: "succeeded", exitCode: 0 });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["reset", "--hard"],
      reason: "Destructive command",
    }, dataDir)).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("keeps Git reads available but requires the Root Git-write capability for mutations", async () => {
    await setLocalWorkspacePermissions({ projectId, permissions: { gitWrite: false } }, dataDir);
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["status", "--short"],
      reason: "Inspect repository status",
    }, dataDir)).resolves.toMatchObject({ requiresGitWrite: false });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "git",
      args: ["add", "README.md"],
      reason: "Stage a file",
    }, dataDir)).rejects.toMatchObject({ code: "git_write_not_allowed" });

    await setLocalWorkspacePermissions({ projectId, permissions: { gitWrite: true } }, dataDir);
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      command: "git add README.md",
      reason: "Stage a file through the shell protocol",
    }, dataDir);
    expect(command).toMatchObject({ requiresGitWrite: true, sandboxMode: "workspace-write" });

    await setLocalWorkspacePermissions({ projectId, permissions: { gitWrite: false } }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .rejects.toMatchObject({ code: "git_write_not_allowed" });
  });

  it("requires approval, runs an exact declared test script once, and records output", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["test"],
      reason: "Run the declared test suite",
    }, dataDir);
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .rejects.toMatchObject({ code: "approval_required" });
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    const result = await runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir);
    expect(result).toMatchObject({ status: "succeeded", exitCode: 0 });
    expect(result.stdout).toContain("agent-ok");
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .rejects.toMatchObject({ code: "approval_required" });
  }, 90_000);

  it("applies cc-haha allowed-tools as a turn-scoped command grant", async () => {
    const withoutGrant = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "shell_command",
      arguments: { executable: "git", args: ["config", "--list"], reason: "Inspect Git config" },
    }, dataDir);
    expect(withoutGrant).toMatchObject({ status: "proposed", requiresExplicitApproval: true });

    const withGrant = await executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "shell_command",
      arguments: { executable: "git", args: ["config", "--list"], reason: "Inspect Git config" },
      additionalAllowedTools: ["Bash(git config:*)"],
    }, dataDir);
    expect(withGrant).toMatchObject({ status: "succeeded", exitCode: 0 });
  }, 90_000);

  it("applies cc-haha-compatible project permission rules before command execution", async () => {
    await fs.mkdir(path.join(workspaceRoot, ".zenme"), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: {
        allow: ["Bash(git config:*)"],
        ask: ["Bash(npm test)"],
        deny: ["Bash(git config --global:*)"],
      },
    }));

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "shell_command",
      arguments: { executable: "git", args: ["config", "--list"], reason: "Inspect Git config" },
    }, dataDir)).resolves.toMatchObject({ status: "succeeded", exitCode: 0 });

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "shell_command",
      arguments: { executable: "npm", args: ["test"], reason: "Run tests" },
    }, dataDir)).resolves.toMatchObject({ status: "proposed" });

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "shell_command",
      arguments: { executable: "git", args: ["config", "--global", "user.name"], reason: "Read global Git config" },
    }, dataDir)).rejects.toMatchObject({ code: "permission_denied" });
  }, 90_000);

  it("marks general commands for explicit approval and enforces the five-minute foreground ceiling", async () => {
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["exec", "anything"],
      reason: "arbitrary",
    }, dataDir)).resolves.toMatchObject({ requiresExplicitApproval: true });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["test"],
      reason: "too long",
      timeoutMs: 300_001,
    }, dataDir)).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("allows ordinary structured development commands inside the workspace sandbox", async () => {
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "node",
      args: ["--version"],
      reason: "Inspect the project runtime",
    }, dataDir)).resolves.toMatchObject({
      requiresExplicitApproval: false,
      sandboxMode: "workspace-write",
    });
  });

  it("runs a complete shell script in one validated command and keeps its readable form", async () => {
    const script = process.platform === "win32"
      ? "$env:ZENME_COMMAND_PROTOCOL = 'ok'; Write-Output $env:ZENME_COMMAND_PROTOCOL"
      : "ZENME_COMMAND_PROTOCOL=ok; printf '%s\\n' \"$ZENME_COMMAND_PROTOCOL\"";
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      command: script,
      reason: "Verify complete shell command protocol",
    }, dataDir);

    expect(command).toMatchObject({
      command: script,
      requiresExplicitApproval: true,
      sandboxMode: "danger-full-access",
    });
    if (process.platform !== "win32") return;
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    await expect(runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir))
      .resolves.toMatchObject({ status: "succeeded", stdout: expect.stringContaining("ok") });
  });

  it("classifies script contents instead of treating the PowerShell host as elevation", async () => {
    if (process.platform !== "win32") return;
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      command: "Get-ChildItem . | Select-Object -First 1",
      reason: "Inspect workspace",
    }, dataDir)).resolves.toMatchObject({ requiresExplicitApproval: false, sandboxMode: "workspace-write" });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      command: "Invoke-WebRequest https://example.com",
      reason: "Access network",
    }, dataDir)).resolves.toMatchObject({ requiresExplicitApproval: true, sandboxMode: "danger-full-access" });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      command: "git reset --hard",
      reason: "Destructive command",
    }, dataDir)).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("fails closed for dynamic, compound, redirected and malformed PowerShell", async () => {
    if (process.platform !== "win32") return;
    for (const command of [
      "Get-Process; Invoke-Expression 'Write-Output unsafe'",
      "Get-Process | Stop-Process",
      "Get-Content .\\input.txt > ..\\outside.txt",
      "& $command",
      "Get-ChildItem {",
    ]) {
      await expect(proposeAgentCommand({ projectId, executionId, command, reason: "Check PowerShell policy" }, dataDir))
        .resolves.toMatchObject({ requiresExplicitApproval: true, sandboxMode: "danger-full-access" });
    }
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      command: "Get-ChildItem . | Where-Object { $_.Name -like '*.txt' } | Select-Object -First 1",
      reason: "Read workspace through a safe script-block filter",
    }, dataDir)).resolves.toMatchObject({ requiresExplicitApproval: false, sandboxMode: "workspace-write" });
  }, 30_000);

  it("uses PowerShell path semantics for workspace-local writes and redirections", async () => {
    if (process.platform !== "win32") return;
    for (const command of [
      "Set-Content -LiteralPath .\\local.txt -Value 'ok'",
      "New-Item -ItemType Directory -Path .\\generated -Force",
      "Get-Content .\\package.json > .\\package-copy.txt",
    ]) {
      await expect(proposeAgentCommand({ projectId, executionId, command, reason: "Write within workspace" }, dataDir))
        .resolves.toMatchObject({ requiresExplicitApproval: false, sandboxMode: "workspace-write" });
    }
    for (const command of [
      "Set-Content -LiteralPath ..\\outside.txt -Value 'blocked'",
      "Set-Content -LiteralPath .\\.git\\config -Value 'blocked'",
      "Get-Content .\\package.json > ..\\outside.txt",
      "Set-Content -UnknownParameter value .\\ambiguous.txt",
    ]) {
      await expect(proposeAgentCommand({ projectId, executionId, command, reason: "Reject uncertain or external path" }, dataDir))
        .resolves.toMatchObject({ requiresExplicitApproval: true, sandboxMode: "danger-full-access" });
    }
  }, 30_000);

  it("does not auto-run PowerShell arguments that can expose environment values", async () => {
    if (process.platform !== "win32") return;
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      command: "Write-Output $env:OPENAI_API_KEY",
      reason: "Do not expose inherited values",
    }, dataDir)).resolves.toMatchObject({ requiresExplicitApproval: true, sandboxMode: "danger-full-access" });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      command: "Write-Output 'ordinary literal'",
      reason: "Print a literal",
    }, dataDir)).resolves.toMatchObject({ requiresExplicitApproval: false, sandboxMode: "workspace-write" });
  }, 15_000);

  it("accepts package-manager shorthand only for a script declared by the project", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "pnpm",
      args: ["slow"],
      reason: "Start the declared development-style script",
    }, dataDir);

    expect(command).toMatchObject({
      executable: "pnpm",
      args: ["slow"],
      sandboxMode: "workspace-write",
      status: "proposed",
    });
    await expect(proposeAgentCommand({
      projectId,
      executionId,
      executable: "pnpm",
      args: ["undeclared"],
      reason: "Do not run an undeclared script",
    }, dataDir)).rejects.toMatchObject({ code: "invalid_command" });
  });

  it("executes the trusted pnpm command shim on Windows without shell interpolation", async () => {
    if (process.platform !== "win32") return;
    const shimDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-pnpm-shim-"));
    const cliPath = path.join(shimDirectory, "pnpm.cjs");
    const shimPath = path.join(shimDirectory, "pnpm.cmd");
    const previousPath = process.env.PATH;
    try {
      await fs.writeFile(cliPath, [
        "if (process.argv.slice(2).join(' ') !== 'test') {",
        "  console.error('unexpected pnpm arguments');",
        "  process.exit(2);",
        "}",
        "console.log('agent-ok');",
        "",
      ].join("\n"));
      await fs.writeFile(shimPath, `@echo off\r\n"${process.execPath}" "${cliPath}" %*\r\n`);
      process.env.PATH = `${shimDirectory}${path.delimiter}${previousPath ?? ""}`;

      const command = await proposeAgentCommand({
        projectId, executionId, executable: "pnpm", args: ["test"], reason: "Run pnpm test",
      }, dataDir);
      await approveAgentCommand(projectId, executionId, command.id, dataDir);
      const result = await runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir);
      expect(result).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(result.stdout).toContain("agent-ok");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(shimDirectory, { force: true, recursive: true });
    }
  }, 90_000);

  it("provides a Corepack pnpm bridge to package-script descendants when pnpm is not installed", async () => {
    if (process.platform !== "win32") return;
    const corepackDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-corepack-shim-"));
    const corepackPath = path.join(corepackDirectory, "corepack.cmd");
    const previousPath = process.env.PATH;
    const packageJsonPath = path.join(workspaceRoot, "package.json");
    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8")) as { scripts: Record<string, string>; packageManager?: string };
      packageJson.packageManager = "pnpm@11.16.0";
      packageJson.scripts.bridge = "pnpm --version";
      await fs.writeFile(packageJsonPath, JSON.stringify(packageJson));
      await fs.writeFile(corepackPath, [
        "@echo off",
        "if /I not \"%1\"==\"pnpm\" exit /b 2",
        "echo corepack-pnpm-bridge",
        "exit /b 0",
        "",
      ].join("\r\n"));
      process.env.PATH = [corepackDirectory, path.dirname(process.execPath), process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : ""]
        .filter(Boolean)
        .join(path.delimiter);

      const command = await proposeAgentCommand({
        projectId, executionId, executable: "npm", args: ["run", "bridge"], reason: "Run bridge script",
      }, dataDir);
      await approveAgentCommand(projectId, executionId, command.id, dataDir);
      const result = await runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir);
      expect(result).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(result.stdout).toContain("corepack-pnpm-bridge");
      await expect(fs.access(path.join(dataDir, "agent-command-shims", "corepack", "pnpm.cmd"))).resolves.toBeUndefined();
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await fs.rm(corepackDirectory, { force: true, recursive: true });
    }
  }, 90_000);

  it("falls back to Corepack for a direct pnpm invocation when no pnpm shim exists", async () => {
    if (process.platform !== "win32") return;
    const fakeProgramFiles = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-corepack-install-"));
    const nodeDirectory = path.join(fakeProgramFiles, "nodejs");
    const corepackCliDirectory = path.join(nodeDirectory, "node_modules", "corepack", "dist");
    const previousPath = process.env.PATH;
    const previousProgramFiles = process.env.ProgramFiles;
    try {
      await fs.mkdir(corepackCliDirectory, { recursive: true });
      await fs.writeFile(path.join(nodeDirectory, "corepack.cmd"), "@echo off\r\nexit /b 0\r\n");
      await fs.link(process.execPath, path.join(nodeDirectory, "node.exe"));
      await fs.writeFile(path.join(corepackCliDirectory, "corepack.js"), [
        "if (process.argv.slice(2).join(' ') !== 'pnpm run test') {",
        "  console.error('unexpected corepack arguments');",
        "  process.exit(2);",
        "}",
        "console.log('direct-corepack-pnpm');",
        "",
      ].join("\n"));
      process.env.ProgramFiles = fakeProgramFiles;
      process.env.PATH = [nodeDirectory, process.env.SystemRoot ? path.join(process.env.SystemRoot, "System32") : ""]
        .filter(Boolean)
        .join(path.delimiter);

      const command = await proposeAgentCommand({
        projectId, executionId, executable: "pnpm", args: ["run", "test"], reason: "Run pnpm test via Corepack",
      }, dataDir);
      await approveAgentCommand(projectId, executionId, command.id, dataDir);
      const result = await runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir);
      expect(result).toMatchObject({ status: "succeeded", exitCode: 0 });
      expect(result.stdout).toContain("direct-corepack-pnpm");
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousProgramFiles === undefined) delete process.env.ProgramFiles;
      else process.env.ProgramFiles = previousProgramFiles;
      await fs.rm(fakeProgramFiles, { force: true, recursive: true });
    }
  }, 90_000);

  it("starts, observes and stops a declared background development task", async () => {
    const started = await executeAgentWorkspaceTool({
      projectId, executionId, name: "shell_command",
      arguments: { executable: "npm", args: ["run", "background"], reason: "Start dev service", run_in_background: true },
    }, dataDir);
    expect(started).toMatchObject({
      background: true,
      status: "running",
      outputFilePath: expect.stringContaining(`${started.id}.log`),
    });

    const output = await executeAgentWorkspaceTool({
      projectId, executionId, name: "task_output", arguments: { task_id: started.id, block: true, timeout: 5_000 },
    }, dataDir);
    if (!("stdout" in output)) throw new Error("Expected shell task output");
    expect(output.stdout).toContain("background-ready");
    expect(await fs.readFile(String(output.outputFilePath), "utf8")).toContain("background-ready");
    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: String(output.outputFilePath), startLine: 1, endLine: 20 },
    }, dataDir)).resolves.toMatchObject({
      relativePath: output.outputFilePath,
      content: expect.stringContaining("background-ready"),
    });
    const stopped = await executeAgentWorkspaceTool({
      projectId, executionId, name: "task_stop", arguments: { task_id: started.id },
    }, dataDir);
    expect(stopped.status).toBe("stopped");
    await expect(getAgentBackgroundTask(projectId, started.id, dataDir)).resolves.toMatchObject({
      id: started.id,
      status: "stopped",
    });
  }, 70_000);

  it("notifies once when a background command stalls on an interactive prompt", async () => {
    expect(looksLikeInteractiveCommandPrompt("Continue?\n")).toBe(true);
    expect(looksLikeInteractiveCommandPrompt("server ready\n")).toBe(false);
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "prompt"],
      reason: "Detect an interactive prompt",
      background: true,
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    const stalls: Array<{ commandId: string; tail: string }> = [];
    let resolveStall!: () => void;
    const stalled = new Promise<void>((resolve) => { resolveStall = resolve; });
    const started = await runApprovedAgentCommand({
      projectId,
      executionId,
      commandId: command.id,
      stallCheckIntervalMs: 20,
      stallThresholdMs: 40,
      onStall: (stall) => {
        stalls.push(stall);
        resolveStall();
      },
    }, dataDir);
    expect(started.status).toBe("running");
    await Promise.race([
      stalled,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stall notification timed out")), 2_000)),
    ]);
    expect(stalls).toEqual([
      expect.objectContaining({ commandId: command.id, tail: expect.stringContaining("Continue?") }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stalls).toHaveLength(1);
    await stopAgentBackgroundTask(projectId, command.id, dataDir);
  }, 15_000);

  it("keeps cc-haha-style full shell output on disk while bounding the inline preview", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "large-output"],
      reason: "Verify durable large command output",
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    const result = await runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir);

    expect(result).toMatchObject({
      status: "succeeded",
      outputPreviewTruncated: true,
      outputFileTruncated: false,
      outputFileSize: expect.any(Number),
    });
    expect(result.error).toBeUndefined();
    expect(Buffer.byteLength(result.stdout ?? "", "utf8")).toBeLessThanOrEqual(1024 * 1024);
    const persisted = await fs.readFile(String(result.outputFilePath));
    expect(persisted.length).toBeGreaterThan(1024 * 1024);
    expect(persisted.toString("utf8")).toContain("011999");

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: String(result.outputFilePath), startLine: 11990, endLine: 12030 },
    }, dataDir)).resolves.toMatchObject({
      content: expect.stringContaining("011999"),
    });
  }, 70_000);

  it("lets the same execution read a persisted oversized generic tool result", async () => {
    const complete = Array.from({ length: 2_000 }, (_, index) => `${index}:${"y".repeat(80)}`).join("\n");
    const result = await executeAgentToolPipeline({
      projectId,
      executionId,
      name: "search_files",
      arguments: {},
      execute: async () => complete,
      persistOutput: (output, metadata) => persistAgentToolResultForModel({
        dataDir,
        name: "search_files",
        output,
        projectId,
        toolCallId: metadata.toolCallId,
      }),
    }, dataDir);
    expect(result.persistedOutput).toMatchObject({ persistedOutput: true, outputFilePath: expect.any(String) });
    const persisted = result.persistedOutput as { outputFilePath: string };

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: persisted.outputFilePath, startLine: 1995, endLine: 2000 },
    }, dataDir)).resolves.toMatchObject({
      content: expect.stringContaining("1999:"),
    });
  });

  it("delivers a background command terminal state from its process completion event", async () => {
    const proposed = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "short"],
      reason: "Run a short background command",
      background: true,
    }, dataDir);
    await approveAgentCommand(projectId, executionId, proposed.id, dataDir);
    const started = await runApprovedAgentCommand({
      projectId,
      executionId,
      commandId: proposed.id,
    }, dataDir);

    expect(started).toMatchObject({ id: proposed.id, background: true, status: "running" });
    await expect(waitForAgentBackgroundTaskCompletion(projectId, proposed.id, dataDir)).resolves.toMatchObject({
      id: proposed.id,
      status: "succeeded",
      exitCode: 0,
      stdout: expect.stringContaining("short-finished"),
    });
  }, 70_000);

  it("rejects absolute task output paths not owned by the current execution", async () => {
    const otherExecution = await createAgentExecution({
      projectId,
      instruction: "Other command",
      resultNodeId: "other-agent-result",
      triggerNodeId: "other-agent-request",
      selectedNodeIds: [],
      fileDocumentIds: [],
    }, dataDir);
    const otherCommand = await proposeAgentCommand({
      projectId,
      executionId: otherExecution.detail.id,
      executable: "npm",
      args: ["test"],
      reason: "Create another execution output",
    }, dataDir);

    await expect(executeAgentWorkspaceTool({
      projectId,
      executionId,
      name: "read_file",
      arguments: { relativePath: String(otherCommand.outputFilePath) },
    }, dataDir)).rejects.toMatchObject({ code: "invalid_arguments" });
  });

  it("records agent-owned background commands as stopped when the owning agent exits", async () => {
    const started = await executeAgentWorkspaceTool({
      projectId, executionId, name: "shell_command",
      arguments: { executable: "npm", args: ["run", "background"], reason: "Start agent-owned service", run_in_background: true },
    }, dataDir);
    expect(started.status).toBe("running");

    await stopRunningAgentCommands(projectId, executionId);
    let command = (await getAgentExecution(projectId, executionId, dataDir))?.commandRequests
      .find((candidate) => candidate.id === started.id);
    for (let attempt = 0; attempt < 50 && command?.status === "running"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      command = (await getAgentExecution(projectId, executionId, dataDir))?.commandRequests
        .find((candidate) => candidate.id === started.id);
    }
    expect(command).toMatchObject({ status: "stopped" });
  }, 70_000);

  it("moves a foreground command that exceeds the interaction budget into a trackable background task", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "slow"],
      reason: "Run a command that outlives the foreground interaction budget",
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);

    const running = await runApprovedAgentCommand({
      projectId,
      executionId,
      commandId: command.id,
      foregroundBudgetMs: 25,
    }, dataDir);

    expect(running).toMatchObject({
      id: command.id,
      background: true,
      status: "running",
      outputFilePath: expect.stringContaining(`${command.id}.log`),
    });
    await expect(listAgentBackgroundTasks(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: command.id, background: true, status: "running" }),
    ]);
    await expect(stopAgentBackgroundTask(projectId, command.id, dataDir)).resolves.toMatchObject({ status: "stopped" });
  }, 70_000);

  it("reports one in-place foreground command progress stream after the two-second threshold", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "slow"],
      reason: "Observe a long foreground command",
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    const progress: Array<{ commandId: string; elapsedMs: number; stdout: string; stderr: string }> = [];

    const running = await runApprovedAgentCommand({
      projectId,
      executionId,
      commandId: command.id,
      foregroundBudgetMs: 2_400,
      onProgress: (next) => { progress.push(next); },
    }, dataDir);
    await stopAgentBackgroundTask(projectId, command.id, dataDir);

    expect(running).toMatchObject({ status: "running", background: true });
    expect(progress).toHaveLength(1);
    expect(progress[0]).toMatchObject({
      commandId: command.id,
      elapsedMs: expect.any(Number),
      outputFilePath: expect.stringContaining(`${command.id}.log`),
      stderr: "",
    });
    expect(progress[0].stdout).toContain("slow");
    expect(progress[0].elapsedMs).toBeGreaterThanOrEqual(1_900);
  }, 70_000);

  it("reconciles a background task owned by a previous local-server instance", async () => {
    const proposed = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "dev"],
      reason: "Start previous dev service",
      background: true,
    }, dataDir);
    await updateAgentCommandRequest(projectId, executionId, proposed.id, (command) => {
      command.status = "running";
      command.runtimeInstanceId = "previous-server-instance";
      command.startedAt = new Date().toISOString();
      command.updatedAt = command.startedAt;
    }, dataDir);

    await expect(listAgentBackgroundTasks(projectId, dataDir)).resolves.toEqual([]);
    await expect(getAgentBackgroundTask(projectId, proposed.id, dataDir)).resolves.toMatchObject({
      status: "stopped",
      error: expect.stringContaining("本地服务已重启"),
    });
  });

  it("terminates a declared command at its approved timeout", async () => {
    const command = await proposeAgentCommand({
      projectId,
      executionId,
      executable: "npm",
      args: ["run", "slow"],
      reason: "Verify timeout cleanup",
      timeoutMs: 1_000,
    }, dataDir);
    await approveAgentCommand(projectId, executionId, command.id, dataDir);
    const result = await runApprovedAgentCommand({ projectId, executionId, commandId: command.id }, dataDir);
    expect(result.status).toBe("timedOut");
  }, 20_000);
});
