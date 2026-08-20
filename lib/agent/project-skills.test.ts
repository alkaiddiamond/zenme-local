import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatProjectSkillListing,
  listProjectSkills,
  loadProjectSkill,
  resolveProjectSlashCommand,
} from "@/lib/agent/project-skills";
import { createLocalProject } from "@/lib/local/project-repository";
import { addLocalWorkspaceRoot, bindLocalWorkspace } from "@/lib/local/workspace-repository";

describe("project skills", () => {
  let dataDir: string;
  let workspaceRoot: string;
  let projectId: string;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skills-data-"));
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skills-workspace-"));
    projectId = (await createLocalProject({ name: "Skills", prompt: "", model: "" }, dataDir)).id;
    await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("discovers project skills and loads full instructions with arguments", async () => {
    const directory = path.join(workspaceRoot, ".zenme", "skills", "release-check");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "SKILL.md"), [
      "---",
      "name: release-check",
      "description: Validate a desktop release",
      "---",
      "Read ${ZENME_SKILL_DIR}/checklist.md and validate $ARGUMENTS.",
    ].join("\n"));

    await expect(listProjectSkills(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ name: "release-check", description: "Validate a desktop release", source: "project", primary: true }),
    ]);
    const loaded = await loadProjectSkill({ projectId, dataDir, skill: "release-check", args: "windows" });
    expect(loaded.content).toContain("checklist.md and validate windows");
    expect(loaded.content).not.toContain("---\nname:");
    expect(formatProjectSkillListing(await listProjectSkills(projectId, dataDir)))
      .toContain("release-check: Validate a desktop release");
  });

  it("loads managed Skills and Commands first and prevents lower scopes from shadowing them", async () => {
    const managedDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skills-managed-"));
    try {
      const managedSkill = path.join(managedDirectory, ".claude", "skills", "release-check");
      const projectSkill = path.join(workspaceRoot, ".claude", "skills", "release-check");
      await fs.mkdir(managedSkill, { recursive: true });
      await fs.mkdir(projectSkill, { recursive: true });
      await fs.mkdir(path.join(managedDirectory, ".claude", "commands"), { recursive: true });
      await fs.writeFile(path.join(managedSkill, "SKILL.md"), [
        "---", "name: release-check", "description: Managed release policy", "---", "Run managed checks for $ARGUMENTS.",
      ].join("\n"));
      await fs.writeFile(path.join(projectSkill, "SKILL.md"), [
        "---", "name: release-check", "description: Project override", "---", "Unsafe project override.",
      ].join("\n"));
      await fs.writeFile(path.join(managedDirectory, ".claude", "commands", "policy-audit.md"), [
        "---", "description: Managed audit command", "---", "Audit $ARGUMENTS under policy.",
      ].join("\n"));

      const options = { managedDirectories: [managedDirectory] };
      await expect(listProjectSkills(projectId, dataDir, undefined, options)).resolves.toEqual([
        expect.objectContaining({ name: "release-check", source: "policy", description: "Managed release policy" }),
        expect.objectContaining({ name: "policy-audit", source: "policy", command: true }),
      ]);
      await expect(loadProjectSkill({
        projectId,
        dataDir,
        skill: "release-check",
        args: "desktop",
        ...options,
      })).resolves.toMatchObject({
        source: "policy",
        content: expect.stringContaining("Run managed checks for desktop"),
      });
      await expect(resolveProjectSlashCommand({
        projectId,
        dataDir,
        prompt: "/policy-audit dependencies",
        ...options,
      })).resolves.toMatchObject({ source: "policy", content: expect.stringContaining("Audit dependencies under policy") });
    } finally {
      await fs.rm(managedDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("blocks project and user Skills when managed policy requires plugin-only customization", async () => {
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skills-policy-"));
    try {
      const projectDirectory = path.join(workspaceRoot, ".claude", "skills", "project-review");
      const userDirectory = path.join(dataDir, "skills", "user-review");
      const managedDirectory = path.join(managedRoot, ".claude", "skills", "managed-review");
      await fs.mkdir(projectDirectory, { recursive: true });
      await fs.mkdir(userDirectory, { recursive: true });
      await fs.mkdir(managedDirectory, { recursive: true });
      await fs.writeFile(path.join(projectDirectory, "SKILL.md"), "---\nname: project-review\ndescription: Project\n---\nproject");
      await fs.writeFile(path.join(userDirectory, "SKILL.md"), "---\nname: user-review\ndescription: User\n---\nuser");
      await fs.writeFile(path.join(managedDirectory, "SKILL.md"), "---\nname: managed-review\ndescription: Managed\n---\nmanaged");
      await fs.writeFile(path.join(managedRoot, "managed-settings.json"), JSON.stringify({
        strictPluginOnlyCustomization: ["skills"],
      }));

      await expect(listProjectSkills(projectId, dataDir, undefined, { managedDirectories: [managedRoot] }))
        .resolves.toEqual([expect.objectContaining({ name: "managed-review", source: "policy" })]);
    } finally {
      await fs.rm(managedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("keeps a project Skill but removes its frontmatter Hooks when only Hooks are plugin-only", async () => {
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skill-hooks-policy-"));
    try {
      const directory = path.join(workspaceRoot, ".claude", "skills", "review");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "SKILL.md"), [
        "---",
        "name: review",
        "description: Review",
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

      await expect(loadProjectSkill({
        projectId,
        dataDir,
        skill: "review",
        managedDirectories: [managedRoot],
      })).resolves.toMatchObject({ name: "review", source: "project", hooks: undefined });
    } finally {
      await fs.rm(managedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("matches cc-haha named arguments, append fallback, and inherited model semantics", async () => {
    const directory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "deploy.md"), [
      "---",
      "description: Deploy an environment",
      "arguments: environment channel",
      "model: inherit",
      "---",
      "Deploy $environment through $channel.",
    ].join("\n"));
    await fs.writeFile(path.join(directory, "note.md"), [
      "---",
      "description: Record a note",
      "---",
      "Record this note.",
    ].join("\n"));

    await expect(resolveProjectSlashCommand({
      projectId,
      dataDir,
      prompt: '/deploy "staging west" canary',
    })).resolves.toMatchObject({
      model: undefined,
      content: expect.stringContaining("Deploy staging west through canary."),
    });
    await expect(resolveProjectSlashCommand({
      projectId,
      dataDir,
      prompt: "/note remember this",
    })).resolves.toMatchObject({
      content: expect.stringContaining("Record this note.\n\nARGUMENTS: remember this"),
    });
  });

  it("preserves all Skill hooks including once metadata", async () => {
    const directory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "hooked.md"), [
      "---",
      "hooks:",
      "  PreToolUse:",
      "    - matcher: Glob",
      "      hooks:",
      "        - type: http",
      "          url: https://hooks.example.test/persistent",
      "        - type: http",
      "          url: https://hooks.example.test/once",
      "          once: true",
      "---",
      "Inspect the project.",
    ].join("\n"));

    const loaded = await loadProjectSkill({ projectId, dataDir, skill: "hooked", args: "" });
    expect(loaded.hooks?.PreToolUse?.[0]).toMatchObject({
      matcher: "Glob",
      hooks: [
        { type: "http", url: "https://hooks.example.test/persistent" },
        { type: "http", url: "https://hooks.example.test/once", once: true },
      ],
    });
  });

  it("preserves the exact cc-haha shell frontmatter contract", async () => {
    const directory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "powershell-info.md"), [
      "---",
      "shell: powershell",
      "---",
      "Version: !`$PSVersionTable.PSVersion`",
    ].join("\n"));

    await expect(loadProjectSkill({ projectId, dataDir, skill: "powershell-info" }))
      .resolves.toMatchObject({ shell: "powershell" });
  });

  it("resolves user slash commands locally with cc-haha frontmatter and indexed arguments", async () => {
    const directory = path.join(workspaceRoot, ".claude", "commands");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "release.md"), [
      "---",
      "description: Prepare a release",
      "argument-hint: <platform> <channel>",
      "allowed-tools:",
      "  - Bash(pnpm test:*)",
      "  - Read",
      "disable-model-invocation: true",
      "model: test:fast",
      "effort: high",
      "context: fork",
      "agent: release-reviewer",
      "---",
      "Release $ARGUMENTS[0] on $1. Full: $ARGUMENTS.",
    ].join("\n"));

    await expect(listProjectSkills(projectId, dataDir)).resolves.toContainEqual(expect.objectContaining({
      name: "release",
      command: true,
      argumentHint: "<platform> <channel>",
      disableModelInvocation: true,
      userInvocable: undefined,
    }));
    await expect(resolveProjectSlashCommand({
      projectId,
      dataDir,
      prompt: '/release "Windows desktop" beta',
    })).resolves.toMatchObject({
      name: "release",
      allowedTools: ["Bash(pnpm test:*)", "Read"],
      command: true,
      model: "test:fast",
      effort: "high",
      executionContext: "fork",
      agent: "release-reviewer",
      content: expect.stringContaining("Release Windows desktop on beta. Full: \"Windows desktop\" beta."),
    });
    await expect(loadProjectSkill({
      projectId,
      dataDir,
      skill: "release",
    })).rejects.toThrow("disable-model-invocation");
  });

  it("blocks direct invocation of model-only skills", async () => {
    const directory = path.join(workspaceRoot, ".zenme", "skills", "internal-review");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "SKILL.md"), [
      "---",
      "name: internal-review",
      "description: Internal review",
      "user-invocable: false",
      "---",
      "Review the current change.",
    ].join("\n"));

    await expect(resolveProjectSlashCommand({
      projectId,
      dataDir,
      prompt: "/internal-review",
    })).rejects.toThrow("user-invocable: false");
    await expect(loadProjectSkill({
      projectId,
      dataDir,
      skill: "internal-review",
    })).resolves.toMatchObject({ name: "internal-review", userInvocable: false });
  });

  it("prefers project skills over user skills with the same name", async () => {
    const projectDirectory = path.join(workspaceRoot, ".claude", "skills", "shared");
    const userDirectory = path.join(dataDir, "skills", "shared");
    await fs.mkdir(projectDirectory, { recursive: true });
    await fs.mkdir(userDirectory, { recursive: true });
    await fs.writeFile(path.join(projectDirectory, "SKILL.md"), "---\nname: shared\ndescription: Project version\n---\nproject");
    await fs.writeFile(path.join(userDirectory, "SKILL.md"), "---\nname: shared\ndescription: User version\n---\nuser");

    await expect(listProjectSkills(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ name: "shared", description: "Project version", source: "project", primary: true }),
    ]);
    await expect(loadProjectSkill({ projectId, dataDir, skill: "../shared" })).rejects.toThrow();
  });

  it("discovers duplicate skill names per Workspace Root and loads the assigned root's version", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skills-additional-"));
    try {
      const primaryDirectory = path.join(workspaceRoot, ".agents", "skills", "build");
      const additionalDirectory = path.join(additionalRoot, ".agents", "skills", "build");
      await fs.mkdir(primaryDirectory, { recursive: true });
      await fs.mkdir(additionalDirectory, { recursive: true });
      await fs.writeFile(path.join(primaryDirectory, "SKILL.md"), "---\nname: build\ndescription: Primary build\n---\nprimary instructions");
      await fs.writeFile(path.join(additionalDirectory, "SKILL.md"), "---\nname: build\ndescription: Additional build\n---\nadditional instructions");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const additionalRootId = binding.additionalRoots?.at(-1)?.id;
      expect(additionalRootId).toBeTruthy();

      const all = await listProjectSkills(projectId, dataDir);
      expect(all.filter((skill) => skill.name === "build")).toEqual([
        expect.objectContaining({ description: "Primary build", rootId: binding.id, primary: true }),
        expect.objectContaining({ description: "Additional build", rootId: additionalRootId, primary: false }),
      ]);
      await expect(listProjectSkills(projectId, dataDir, additionalRootId)).resolves.toEqual([
        expect.objectContaining({ description: "Additional build", rootId: additionalRootId }),
      ]);
      await expect(loadProjectSkill({
        projectId,
        dataDir,
        skill: "build",
        rootId: additionalRootId,
      })).resolves.toMatchObject({
        rootId: additionalRootId,
        content: expect.stringContaining("additional instructions"),
      });
    } finally {
      await fs.rm(additionalRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("loads enabled cc-haha plugin skills with a plugin namespace", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-skills-home-"));
    try {
      const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "reviewer");
      await fs.mkdir(path.join(pluginRoot, "skills", "review"), { recursive: true });
      await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
      await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
      await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
        enabledPlugins: { "reviewer@market": true },
      }));
      await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
        version: 2,
        plugins: { "reviewer@market": [{ scope: "user", installPath: pluginRoot }] },
      }));
      await fs.writeFile(path.join(pluginRoot, "skills", "review", "SKILL.md"), [
        "---",
        "name: ignored-by-plugin-namespace",
        "description: Review a change",
        "---",
        "Review from ${CLAUDE_SKILL_DIR}.",
      ].join("\n"));

      await expect(listProjectSkills(projectId, dataDir, undefined, { homeDir })).resolves.toContainEqual(
        expect.objectContaining({ name: "reviewer:review", source: "plugin", description: "Review a change" }),
      );
      await expect(loadProjectSkill({
        projectId,
        dataDir,
        skill: "reviewer:review",
        homeDir,
      })).resolves.toMatchObject({
        name: "reviewer:review",
        source: "plugin",
        content: expect.stringContaining("Review from"),
      });
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("loads cc-haha legacy plugin commands as namespaced prompt commands", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-commands-home-"));
    try {
      const pluginRoot = path.join(homeDir, ".claude", "plugins", "cache", "reviewer");
      const pluginDataRoot = path.join(homeDir, ".claude", "plugins", "data", "reviewer-market");
      await fs.mkdir(path.join(pluginRoot, "commands", "git"), { recursive: true });
      await fs.mkdir(path.join(pluginRoot, ".claude-plugin"), { recursive: true });
      await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
      await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
        enabledPlugins: { "reviewer@market": true },
        pluginConfigs: { "reviewer@market": { options: { STYLE: "concise" } } },
      }));
      await fs.writeFile(path.join(homeDir, ".claude", ".credentials.json"), JSON.stringify({
        pluginSecrets: { "reviewer@market": { TOKEN: "never-send-to-model" } },
      }));
      await fs.writeFile(path.join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({
        name: "reviewer",
        userConfig: {
          STYLE: { type: "string", title: "Style", description: "Review style", required: true },
          TOKEN: { type: "string", title: "Token", description: "Secret token", required: true, sensitive: true },
        },
      }));
      await fs.writeFile(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"), JSON.stringify({
        version: 2,
        plugins: { "reviewer@market": [{ scope: "user", installPath: pluginRoot }] },
      }));
      await fs.writeFile(path.join(pluginRoot, "commands", "git", "review.md"), [
        "---",
        "description: Review a Git change",
        "---",
        "Review $ARGUMENTS as ${user_config.STYLE} from ${CLAUDE_PLUGIN_ROOT}; persist at ${CLAUDE_PLUGIN_DATA}; auth ${user_config.TOKEN}.",
      ].join("\n"));

      await expect(listProjectSkills(projectId, dataDir, undefined, { homeDir })).resolves.toContainEqual(
        expect.objectContaining({ name: "reviewer:git:review", source: "plugin", description: "Review a Git change" }),
      );
      const loaded = await loadProjectSkill({
        projectId,
        dataDir,
        skill: "reviewer:git:review",
        args: "HEAD",
        homeDir,
      });
      expect(loaded.content).toContain("Review HEAD as concise from");
      expect(loaded.content).toContain("[sensitive option 'TOKEN' not available in skill content]");
      expect(loaded.content).not.toContain("never-send-to-model");
      expect(loaded.content).toContain((await fs.realpath(pluginRoot)).replaceAll("\\", "/"));
      expect(loaded.content).toContain(pluginDataRoot.replaceAll("\\", "/"));
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
});
