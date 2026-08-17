import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isMcpToolName,
  parseProjectMcpToolCall,
  normalizeResourceContents,
  createMcpConnectionIdentity,
  resolveProjectMcpWorkspaceRoot,
  searchProjectMcpTools,
  applyProjectMcpCustomizationPolicy,
  listProjectMcpResources,
  type ProjectMcpTool,
} from "@/lib/agent/mcp-runtime";
import { createLocalProject } from "@/lib/local/project-repository";
import { addLocalWorkspaceRoot, bindLocalWorkspace, setLocalWorkspaceRootPermissions } from "@/lib/local/workspace-repository";
import { updateLocalSettings } from "@/lib/local/settings";

const tool: ProjectMcpTool = {
  name: "mcp__filesystem__read_text_file",
  serverId: "filesystem",
  serverName: "Filesystem",
  remoteName: "read_text_file",
  description: "Read a text file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  readOnly: true,
};

describe("MCP runtime protocol", () => {
  it("discovers matching MCP tools without exposing unrelated definitions", () => {
    const unrelated: ProjectMcpTool = {
      ...tool,
      name: "mcp__filesystem__write_file",
      remoteName: "write_file",
      description: "Write a file",
      readOnly: false,
    };

    expect(searchProjectMcpTools([tool, unrelated], "read text", 5)).toEqual([
      expect.objectContaining({ name: tool.name, permission: "read" }),
    ]);
  });

  it("accepts only qualified MCP tool names", () => {
    expect(isMcpToolName(tool.name)).toBe(true);
    expect(isMcpToolName("read_text_file")).toBe(false);
    expect(isMcpToolName("mcp__filesystem__bad name")).toBe(false);
  });

  it("bounds text resources and excludes binary payloads from model context", () => {
    const normalized = normalizeResourceContents([
      { uri: "file:///README.md", mimeType: "text/markdown", text: "hello" },
      { uri: "file:///image.png", mimeType: "image/png", blob: "aGVsbG8=" },
    ]);
    expect(normalized).toEqual({
      contents: [
        { uri: "file:///README.md", mimeType: "text/markdown", text: "hello" },
        { uri: "file:///image.png", mimeType: "image/png", binary: true },
      ],
      truncated: false,
    });
  });

  it("validates discovered tool arguments before dispatch", () => {
    expect(parseProjectMcpToolCall([tool], tool.name, { path: "README.md" })).toEqual({
      name: tool.name,
      arguments: { path: "README.md" },
    });
    expect(parseProjectMcpToolCall([tool], tool.name, {})).toBeNull();
    expect(parseProjectMcpToolCall([tool], tool.name, { path: 42 })).toBeNull();
    expect(parseProjectMcpToolCall([], tool.name, { path: "README.md" })).toBeNull();
  });

  it("keeps only plugin and managed-Agent MCP sources under plugin-only policy", () => {
    const settingsServer = {
      id: "user-server",
      name: "User server",
      enabled: true,
      command: "node",
      args: ["server.js"],
      access: "readOnly" as const,
      connectTimeoutMs: 1_000,
      callTimeoutMs: 1_000,
    };
    const pluginSpecs = ["plugin-server"];
    const projectAgentSpecs = ["project-agent-server"];
    expect(applyProjectMcpCustomizationPolicy({
      restricted: true,
      settingsServers: [settingsServer],
      pluginSpecs,
      agentSpecs: projectAgentSpecs,
      agentSource: "project",
    })).toEqual({ settingsServers: [], specs: pluginSpecs });
    expect(applyProjectMcpCustomizationPolicy({
      restricted: true,
      settingsServers: [settingsServer],
      pluginSpecs,
      agentSpecs: ["managed-agent-server"],
      agentSource: "policy",
    })).toEqual({ settingsServers: [], specs: ["plugin-server", "managed-agent-server"] });
  });

  it("does not expose user-configured MCP resources when MCP customization is plugin-only", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-policy-data-"));
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-policy-managed-"));
    try {
      const projectId = (await createLocalProject({ name: "MCP policy", prompt: "", model: "" }, dataDir)).id;
      await updateLocalSettings({
        mcpServers: [{
          id: "user-server",
          name: "User server",
          enabled: true,
          command: "node",
          args: ["server.js"],
          access: "readOnly",
          connectTimeoutMs: 1_000,
          callTimeoutMs: 1_000,
        }],
      }, dataDir);
      await fs.writeFile(path.join(managedRoot, "managed-settings.json"), JSON.stringify({
        strictPluginOnlyCustomization: ["mcp"],
      }));

      await expect(listProjectMcpResources({ projectId, managedDirectories: [managedRoot] }, dataDir))
        .resolves.toEqual({ resources: [], failures: [] });
    } finally {
      await Promise.all([dataDir, managedRoot].map((directory) => fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      })));
    }
  });

  it("does not start a configured MCP server when the managed allowlist is empty", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-allowlist-data-"));
    const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-allowlist-managed-"));
    try {
      const projectId = (await createLocalProject({ name: "MCP allowlist", prompt: "", model: "" }, dataDir)).id;
      await updateLocalSettings({
        mcpServers: [{
          id: "must-not-spawn",
          name: "Must not spawn",
          enabled: true,
          command: "this-command-must-never-run",
          args: [],
          access: "readOnly",
          connectTimeoutMs: 1_000,
          callTimeoutMs: 1_000,
        }],
      }, dataDir);
      await fs.writeFile(path.join(managedRoot, "managed-settings.json"), JSON.stringify({
        allowManagedMcpServersOnly: true,
        allowedMcpServers: [],
      }));

      await expect(listProjectMcpResources({ projectId, managedDirectories: [managedRoot] }, dataDir))
        .resolves.toEqual({ resources: [], failures: [] });
    } finally {
      await Promise.all([dataDir, managedRoot].map((directory) => fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      })));
    }
  });

  it("binds MCP resolution and connection identity to the selected Workspace Root", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-data-"));
    const primaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-primary-"));
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-mcp-additional-"));
    try {
      const projectId = (await createLocalProject({ name: "MCP roots", prompt: "", model: "" }, dataDir)).id;
      await bindLocalWorkspace({ projectId, rootPath: primaryRoot }, dataDir);
      let binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const additionalRootId = binding.additionalRoots?.at(-1)?.id;
      expect(additionalRootId).toBeTruthy();
      await expect(resolveProjectMcpWorkspaceRoot(projectId, dataDir, additionalRootId)).rejects.toThrow("授权读取和执行");
      binding = await setLocalWorkspaceRootPermissions({
        projectId,
        rootId: additionalRootId!,
        permissions: { execute: true },
      }, dataDir);
      const resolved = await resolveProjectMcpWorkspaceRoot(projectId, dataDir, additionalRootId);
      expect(resolved).toMatchObject({ id: additionalRootId, realPath: binding.additionalRoots?.at(-1)?.realPath });
      const server = {
        id: "server-1",
        name: "Filesystem",
        enabled: true,
        command: "node",
        args: ["server.mjs"],
        access: "readOnly" as const,
        connectTimeoutMs: 1_000,
        callTimeoutMs: 1_000,
      };
      const primaryIdentity = createMcpConnectionIdentity({ dataDir, projectId, root: { ...resolved, id: binding.id, realPath: binding.realPath }, server });
      const additionalIdentity = createMcpConnectionIdentity({ dataDir, projectId, root: resolved, server });
      expect(additionalIdentity.cacheKey).toContain(additionalRootId!);
      expect(additionalIdentity.cacheKey).not.toBe(primaryIdentity.cacheKey);
      expect(additionalIdentity.configKey).not.toBe(primaryIdentity.configKey);
    } finally {
      await Promise.all([dataDir, primaryRoot, additionalRoot].map((directory) =>
        fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })));
    }
  });
});
