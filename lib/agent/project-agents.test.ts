import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { formatProjectAgentDefinitionListing, listProjectAgentDefinitions, loadProjectAgentDefinition } from "@/lib/agent/project-agents";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

describe("project agent definitions", () => {
  let dataDir: string;
  let workspaceRoot: string;
  let projectId: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agents-data-"));
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agents-workspace-"));
    projectId = (await createLocalProject({ name: "Agents", prompt: "", model: "" }, dataDir)).id;
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("loads cc-haha-compatible Markdown agent settings", async () => {
    const directory = path.join(workspaceRoot, ".claude", "agents");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "reviewer.md"), [
      "---",
      "name: reviewer",
      "description: Review implementation and tests",
      "tools: [Read, Grep, Bash, Edit]",
      "disallowedTools:",
      "  - Bash",
      "skills: release-check, security-check",
      "model: inherit",
      "effort: high",
      "maxTurns: 12",
      "background: true",
      "memory: project",
      "isolation: worktree",
      "permissionMode: bypassPermissions",
      "criticalSystemReminder_EXPERIMENTAL: Always verify the final result.",
      "color: cyan",
      "mcpServers:",
      "  - local-tools",
      "  - reviewer-http:",
      "      type: http",
      "      url: https://mcp.example.test/api",
      "      headers:",
      "        X-Agent: reviewer",
      "hooks:",
      "  PreToolUse:",
      "    - matcher: Bash",
      "      hooks:",
      "        - type: command",
      "          command: npm run lint",
      "          timeout: 30",
      "  Stop:",
      "    - hooks:",
      "        - type: prompt",
      "          prompt: Verify the result before stopping.",
      "initialPrompt: Inspect repository instructions first.",
      "---",
      "You are a strict code reviewer.",
    ].join("\n"));

    const loaded = await loadProjectAgentDefinition({ projectId, dataDir, agentType: "reviewer" });
    expect(loaded).toMatchObject({
      agentType: "reviewer",
      description: "Review implementation and tests",
      tools: ["read_file", "view_image", "search_files", "shell_command", "edit_file", "apply_patch"],
      disallowedTools: ["shell_command"],
      skills: ["release-check", "security-check"],
      model: "inherit",
      effort: "high",
      maxTurns: 12,
      background: true,
      memory: "project",
      isolation: "worktree",
      permissionMode: "neverAsk",
      criticalSystemReminder: "Always verify the final result.",
      color: "cyan",
      mcpServers: [
        "local-tools",
        {
          "reviewer-http": {
            type: "http",
            url: "https://mcp.example.test/api",
            headers: { "X-Agent": "reviewer" },
          },
        },
      ],
      hooks: {
        PreToolUse: [{
          matcher: "Bash",
          hooks: [{ type: "command", command: "npm run lint", timeout: 30 }],
        }],
        Stop: [{
          hooks: [{ type: "prompt", prompt: "Verify the result before stopping." }],
        }],
      },
      initialPrompt: "Inspect repository instructions first.",
      systemPrompt: "You are a strict code reviewer.",
      source: "project",
      primary: true,
    });
    expect(formatProjectAgentDefinitionListing([loaded])).toContain("reviewer: Review implementation and tests");
  });

  it("prefers a project definition and ignores oversized definitions", async () => {
    const projectDirectory = path.join(workspaceRoot, ".zenme", "agents");
    const userDirectory = path.join(dataDir, "agents");
    await fs.mkdir(projectDirectory, { recursive: true });
    await fs.mkdir(userDirectory, { recursive: true });
    await fs.writeFile(path.join(projectDirectory, "shared.md"), "---\nname: shared\ndescription: Project\n---\nproject prompt");
    await fs.writeFile(path.join(userDirectory, "shared.md"), "---\nname: shared\ndescription: User\n---\nuser prompt");
    await fs.writeFile(path.join(projectDirectory, "large.md"), `---\nname: large\ndescription: Large\n---\n${"x".repeat(100_001)}`);

    const definitions = await listProjectAgentDefinitions(projectId, dataDir);
    expect(definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ agentType: "shared", description: "Project", source: "project" }),
      expect.objectContaining({ agentType: "general-purpose", source: "built-in" }),
      expect.objectContaining({ agentType: "Explore", source: "built-in" }),
      expect.objectContaining({ agentType: "Plan", source: "built-in" }),
      expect.objectContaining({ agentType: "verification", source: "built-in" }),
    ]));
    expect(definitions.some((definition) => definition.agentType === "large")).toBe(false);
    expect(definitions.filter((definition) => definition.agentType === "shared")).toHaveLength(1);
  });

  it("provides cc-haha-style built-in agents and lets project definitions override them", async () => {
    const initial = await listProjectAgentDefinitions(projectId, dataDir);
    const explore = initial.find((definition) => definition.agentType === "Explore");
    const verification = initial.find((definition) => definition.agentType === "verification");
    expect(explore).toMatchObject({ source: "built-in", model: "inherit" });
    expect(explore?.tools).toEqual(expect.arrayContaining(["read_file", "glob_files", "search_files", "shell_command", "tool_search"]));
    expect(explore?.tools).not.toEqual(expect.arrayContaining(["write_file", "edit_file", "apply_patch", "notebook_edit"]));
    expect(verification).toMatchObject({ source: "built-in", background: true });
    expect(verification?.tools).toEqual(expect.arrayContaining(["shell_command", "browser", "code_diagnostics"]));
    expect(verification?.tools).not.toEqual(expect.arrayContaining(["write_file", "edit_file", "apply_patch", "notebook_edit"]));
    expect(formatProjectAgentDefinitionListing([explore!])).toContain("Zenme 内建 Agent");

    const directory = path.join(workspaceRoot, ".claude", "agents");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "Explore.md"), [
      "---",
      "name: Explore",
      "description: Project-specific explorer",
      "tools: [Read, Grep]",
      "---",
      "Use this repository's custom exploration rules.",
    ].join("\n"));

    await expect(loadProjectAgentDefinition({ projectId, dataDir, agentType: "Explore" })).resolves.toMatchObject({
      source: "project",
      description: "Project-specific explorer",
      systemPrompt: "Use this repository's custom exploration rules.",
    });
  });

  it("lets a managed agent override lower-scope definitions", async () => {
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agents-managed-"));
    try {
      const projectDirectory = path.join(workspaceRoot, ".claude", "agents");
      const managedDirectory = path.join(managedRoot, ".claude", "agents");
      await fs.mkdir(projectDirectory, { recursive: true });
      await fs.mkdir(managedDirectory, { recursive: true });
      await fs.writeFile(path.join(projectDirectory, "reviewer.md"), "---\nname: reviewer\ndescription: Project reviewer\n---\nproject prompt");
      await fs.writeFile(path.join(managedDirectory, "reviewer.md"), [
        "---",
        "name: reviewer",
        "description: Managed reviewer",
        "permissionMode: bypassPermissions",
        "hooks:",
        "  Stop:",
        "    - hooks:",
        "        - type: prompt",
        "          prompt: Verify policy requirements.",
        "---",
        "managed prompt",
      ].join("\n"));

      const loaded = await loadProjectAgentDefinition({
        projectId,
        dataDir,
        agentType: "reviewer",
        managedDirectories: [managedRoot],
      });
      expect(loaded).toMatchObject({
        description: "Managed reviewer",
        systemPrompt: "managed prompt",
        source: "policy",
        permissionMode: "neverAsk",
        hooks: { Stop: [{ hooks: [{ type: "prompt", prompt: "Verify policy requirements." }] }] },
      });
      expect(formatProjectAgentDefinitionListing([loaded])).toContain("托管策略 Agent");
    } finally {
      await fs.rm(managedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("blocks project and user Agents when managed policy requires plugin-only customization", async () => {
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agents-policy-"));
    try {
      const projectDirectory = path.join(workspaceRoot, ".claude", "agents");
      const userDirectory = path.join(dataDir, "agents");
      const managedDirectory = path.join(managedRoot, ".claude", "agents");
      await fs.mkdir(projectDirectory, { recursive: true });
      await fs.mkdir(userDirectory, { recursive: true });
      await fs.mkdir(managedDirectory, { recursive: true });
      await fs.writeFile(path.join(projectDirectory, "project.md"), "---\nname: project\ndescription: Project\n---\nproject");
      await fs.writeFile(path.join(userDirectory, "user.md"), "---\nname: user\ndescription: User\n---\nuser");
      await fs.writeFile(path.join(managedDirectory, "managed.md"), "---\nname: managed\ndescription: Managed\n---\nmanaged");
      await fs.writeFile(path.join(managedRoot, "managed-settings.json"), JSON.stringify({
        strictPluginOnlyCustomization: ["agents"],
      }));

      const definitions = await listProjectAgentDefinitions(projectId, dataDir, undefined, { managedDirectories: [managedRoot] });
      expect(definitions).toEqual(expect.arrayContaining([
        expect.objectContaining({ agentType: "managed", source: "policy" }),
        expect.objectContaining({ agentType: "general-purpose", source: "built-in" }),
        expect.objectContaining({ agentType: "Explore", source: "built-in" }),
        expect.objectContaining({ agentType: "Plan", source: "built-in" }),
        expect.objectContaining({ agentType: "verification", source: "built-in" }),
      ]));
      expect(definitions.some((definition) => definition.agentType === "project" || definition.agentType === "user")).toBe(false);
    } finally {
      await fs.rm(managedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("keeps a project Agent but removes its frontmatter Hooks when only Hooks are plugin-only", async () => {
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-hooks-policy-"));
    try {
      const projectDirectory = path.join(workspaceRoot, ".claude", "agents");
      await fs.mkdir(projectDirectory, { recursive: true });
      await fs.writeFile(path.join(projectDirectory, "reviewer.md"), [
        "---",
        "name: reviewer",
        "description: Project reviewer",
        "hooks:",
        "  PreToolUse:",
        "    - hooks:",
        "        - type: command",
        "          command: echo project-hook",
        "---",
        "review",
      ].join("\n"));
      await fs.writeFile(path.join(managedRoot, "managed-settings.json"), JSON.stringify({
        strictPluginOnlyCustomization: ["hooks"],
      }));

      await expect(loadProjectAgentDefinition({
        projectId,
        dataDir,
        agentType: "reviewer",
        managedDirectories: [managedRoot],
      })).resolves.toMatchObject({ agentType: "reviewer", source: "project", hooks: undefined });
    } finally {
      await fs.rm(managedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("loads enabled plugin agents with namespaces and ignores per-agent privilege escalation", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agents-home-"));
    try {
      const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "reviewer");
      await fs.mkdir(path.join(pluginRoot, "agents"), { recursive: true });
      await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
      await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
        enabledPlugins: { "reviewer@market": true },
      }));
      await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
        version: 2,
        plugins: { "reviewer@market": [{ scope: "user", installPath: pluginRoot }] },
      }));
      await fs.writeFile(path.join(pluginRoot, "agents", "strict.md"), [
        "---",
        "name: strict",
        "description: Strict plugin reviewer",
        "skills: [review]",
        "permissionMode: bypassPermissions",
        "mcpServers: [hidden-server]",
        "hooks:",
        "  PreToolUse: []",
        "---",
        "Review changes carefully.",
      ].join("\n"));

      const loaded = await loadProjectAgentDefinition({
        projectId,
        dataDir,
        agentType: "reviewer:strict",
        homeDir,
      });
      expect(loaded).toMatchObject({
        agentType: "reviewer:strict",
        source: "plugin",
        skills: ["reviewer:review"],
        permissionMode: undefined,
        mcpServers: undefined,
        hooks: undefined,
      });
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
