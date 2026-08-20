import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateProjectToolPermission,
  isProjectToolBlanketDenied,
  loadProjectPermissionRules,
  parseProjectPermissionRule,
  shellRuleMatches,
} from "@/lib/agent/project-permission-rules";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })));
});

describe("project permission rules", () => {
  it("parses cc-haha tool rules with escaped parentheses", () => {
    expect(parseProjectPermissionRule('Bash(python -c "print\\(1\\)")', "allow", "project"))
      .toMatchObject({ toolName: "Bash", content: 'python -c "print(1)"' });
    const wildcard = parseProjectPermissionRule("Bash(*)", "allow", "project");
    expect(wildcard).toMatchObject({ toolName: "Bash" });
    expect(wildcard).not.toHaveProperty("content");
  });

  it("matches exact, legacy prefix and wildcard shell rules", () => {
    expect(shellRuleMatches("pnpm test", "pnpm test")).toBe(true);
    expect(shellRuleMatches("pnpm test:*", "pnpm test unit")).toBe(true);
    expect(shellRuleMatches("git *", "git")).toBe(true);
    expect(shellRuleMatches("git *", "git status")).toBe(true);
    expect(shellRuleMatches("git *", "pnpm git status")).toBe(false);
  });

  it("loads user, project and local settings and applies deny then ask then allow precedence", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-permissions-"));
    temporaryDirectories.push(directory);
    const dataDir = path.join(directory, "data");
    const homeDir = path.join(directory, "home");
    const workspace = path.join(directory, "workspace");
    await fs.mkdir(path.join(homeDir, ".claude"), { recursive: true });
    await fs.mkdir(path.join(workspace, ".zenme"), { recursive: true });
    const project = await createLocalProject({ name: "Rules", prompt: "", model: "" }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspace }, dataDir);
    await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(pnpm test:*)"] },
    }));
    await fs.writeFile(path.join(workspace, ".zenme", "settings.json"), JSON.stringify({
      permissions: { ask: ["Bash(pnpm test unit)"] },
    }));
    await fs.writeFile(path.join(workspace, ".zenme", "settings.local.json"), JSON.stringify({
      permissions: { deny: ["Bash(pnpm test unit)"] },
    }));

    const rules = await loadProjectPermissionRules(project.id, dataDir, { homeDir });
    expect(evaluateProjectToolPermission({ name: "shell_command", content: "pnpm test unit", rules })).toBe("deny");
    expect(evaluateProjectToolPermission({ name: "shell_command", content: "pnpm test other", rules })).toBe("allow");
  });

  it("maps cc-haha tool names to Zenme tool names", () => {
    const rules = [
      { behavior: "deny" as const, source: "project" as const, toolName: "Read" },
      { behavior: "ask" as const, source: "project" as const, toolName: "WebFetch" },
    ];
    expect(evaluateProjectToolPermission({ name: "read_file", rules })).toBe("deny");
    expect(evaluateProjectToolPermission({ name: "web_fetch", rules })).toBe("ask");
  });

  it("identifies blanket-denied tools and MCP server prefixes before model exposure", () => {
    const rules = [
      { behavior: "deny" as const, source: "project" as const, toolName: "Read" },
      { behavior: "deny" as const, source: "project" as const, toolName: "Bash(pnpm test)" },
      { behavior: "deny" as const, source: "policy" as const, toolName: "mcp__github" },
    ];
    expect(isProjectToolBlanketDenied("read_file", rules)).toBe(true);
    expect(isProjectToolBlanketDenied("shell_command", rules)).toBe(false);
    expect(isProjectToolBlanketDenied("mcp__github__create_issue", rules)).toBe(true);
    expect(isProjectToolBlanketDenied("mcp__filesystem__read_file", rules)).toBe(false);
  });

  it("loads cc-haha managed-settings base and alphabetical drop-ins", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-managed-permissions-"));
    temporaryDirectories.push(directory);
    const dataDir = path.join(directory, "data");
    const managedDirectory = path.join(directory, "managed");
    await fs.mkdir(path.join(managedDirectory, "managed-settings.d"), { recursive: true });
    const project = await createLocalProject({ name: "Managed rules", prompt: "", model: "" }, dataDir);
    await fs.writeFile(path.join(managedDirectory, "managed-settings.json"), JSON.stringify({
      permissions: { allow: ["Read"] },
    }));
    await fs.writeFile(path.join(managedDirectory, "managed-settings.d", "20-deny.json"), JSON.stringify({
      permissions: { deny: ["WebFetch(https://blocked.example/*)"] },
    }));
    await fs.writeFile(path.join(managedDirectory, "managed-settings.d", "10-ask.json"), JSON.stringify({
      permissions: { ask: ["Agent"] },
    }));

    const rules = await loadProjectPermissionRules(project.id, dataDir, {
      homeDir: path.join(directory, "home"),
      managedDirectories: [managedDirectory],
    });

    expect(rules.filter((rule) => rule.source === "policy")).toHaveLength(3);
    expect(evaluateProjectToolPermission({ name: "read_file", rules })).toBe("allow");
    expect(evaluateProjectToolPermission({ name: "agent_spawn", rules })).toBe("ask");
    expect(evaluateProjectToolPermission({
      name: "web_fetch",
      content: "https://blocked.example/page",
      rules,
    })).toBe("deny");
  });

  it("honors allowManagedPermissionRulesOnly as a hard policy boundary", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-managed-only-permissions-"));
    temporaryDirectories.push(directory);
    const dataDir = path.join(directory, "data");
    const homeDir = path.join(directory, "home");
    const managedDirectory = path.join(directory, "managed");
    await fs.mkdir(path.join(homeDir, ".zenme"), { recursive: true });
    await fs.mkdir(managedDirectory, { recursive: true });
    const project = await createLocalProject({ name: "Managed-only rules", prompt: "", model: "" }, dataDir);
    await fs.writeFile(path.join(homeDir, ".zenme", "settings.json"), JSON.stringify({
      permissions: { allow: ["Bash(*)"], deny: ["Read"] },
    }));
    await fs.writeFile(path.join(managedDirectory, "managed-settings.json"), JSON.stringify({
      allowManagedPermissionRulesOnly: true,
      permissions: { ask: ["Bash(git status)"], allow: ["Read"] },
    }));

    const rules = await loadProjectPermissionRules(project.id, dataDir, {
      homeDir,
      managedDirectories: [managedDirectory],
    });

    expect(new Set(rules.map((rule) => rule.source))).toEqual(new Set(["policy"]));
    expect(evaluateProjectToolPermission({ name: "read_file", rules })).toBe("allow");
    expect(evaluateProjectToolPermission({ name: "shell_command", content: "git status", rules })).toBe("ask");
    expect(evaluateProjectToolPermission({ name: "shell_command", content: "pnpm test", rules })).toBeUndefined();
  });
});
