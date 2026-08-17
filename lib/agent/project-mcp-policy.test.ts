import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isProjectMcpServerAllowed, loadProjectMcpPolicy } from "@/lib/agent/project-mcp-policy";
import { createLocalProject } from "@/lib/local/project-repository";
import { bindLocalWorkspace } from "@/lib/local/workspace-repository";

describe("project MCP managed policy", () => {
  it("matches cc-haha name, exact command and wildcard URL semantics with deny precedence", () => {
    expect(isProjectMcpServerAllowed({
      allowed: [{ serverName: "named" }, { serverCommand: ["node", "server.js"] }],
      denied: [{ serverName: "denied" }],
      allowManagedOnly: false,
    }, { name: "named", command: "node", args: ["other.js"] })).toBe(false);
    expect(isProjectMcpServerAllowed({
      allowed: [{ serverCommand: ["node", "server.js"] }],
      denied: [],
      allowManagedOnly: false,
    }, { name: "stdio", command: "node", args: ["server.js"] })).toBe(true);
    expect(isProjectMcpServerAllowed({
      allowed: [{ serverUrl: "https://*.example.com/*" }],
      denied: [{ serverUrl: "https://private.example.com/*" }],
      allowManagedOnly: false,
    }, { name: "remote", url: "https://private.example.com/mcp" })).toBe(false);
    expect(isProjectMcpServerAllowed({ allowed: [], denied: [], allowManagedOnly: false }, { name: "any" })).toBe(false);
    expect(isProjectMcpServerAllowed({ denied: [], allowManagedOnly: false }, { name: "any" })).toBe(true);
  });

  it("uses only managed allowlist when configured but still merges editable denylists", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-policy-data-"));
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-policy-home-"));
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-policy-workspace-"));
    const managed = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-policy-managed-"));
    try {
      const projectId = (await createLocalProject({ name: "MCP policy", prompt: "", model: "" }, dataDir)).id;
      await bindLocalWorkspace({ projectId, rootPath: workspace }, dataDir);
      await fs.mkdir(path.join(homeDir, ".claude"));
      await fs.writeFile(path.join(homeDir, ".claude", "settings.json"), JSON.stringify({
        allowedMcpServers: [{ serverName: "user-allowed" }],
        deniedMcpServers: [{ serverName: "managed-allowed" }],
      }));
      await fs.mkdir(path.join(workspace, ".claude"));
      await fs.writeFile(path.join(workspace, ".claude", "settings.local.json"), JSON.stringify({
        deniedMcpServers: [{ serverCommand: ["node", "blocked.js"] }],
      }));
      await fs.writeFile(path.join(managed, "managed-settings.json"), JSON.stringify({
        allowManagedMcpServersOnly: true,
        allowedMcpServers: [{ serverName: "managed-allowed" }],
      }));

      const policy = await loadProjectMcpPolicy(projectId, dataDir, {
        homeDir,
        managedDirectories: [managed],
      });
      expect(policy).toEqual({
        allowed: [{ serverName: "managed-allowed" }],
        denied: [{ serverName: "managed-allowed" }, { serverCommand: ["node", "blocked.js"] }],
        allowManagedOnly: true,
      });
      expect(isProjectMcpServerAllowed(policy, { name: "managed-allowed" })).toBe(false);
      expect(isProjectMcpServerAllowed(policy, { name: "user-allowed" })).toBe(false);
    } finally {
      await Promise.all([dataDir, homeDir, workspace, managed].map((directory) => fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      })));
    }
  });
});
