import { describe, expect, it } from "vitest";

import { normalizeProjectAgentMcpServers } from "@/lib/agent/project-agent-mcp";

describe("custom Agent MCP definitions", () => {
  it("normalizes inherited and Agent-private cc-haha server definitions", () => {
    expect(normalizeProjectAgentMcpServers([
      "shared-tools",
      { local: { command: "node", args: ["server.mjs"], env: { MODE: "agent" } } },
      { remote: { type: "http", url: "https://mcp.example.test/api", headers: { Authorization: "Bearer local" } } },
      { events: { type: "sse", url: "http://127.0.0.1:8787/sse" } },
      { inheritedSdk: { type: "sdk", name: "shared-tools" } },
    ])).toEqual([
      "shared-tools",
      { local: { type: "stdio", command: "node", args: ["server.mjs"], env: { MODE: "agent" } } },
      { remote: { type: "http", url: "https://mcp.example.test/api", headers: { Authorization: "Bearer local" } } },
      { events: { type: "sse", url: "http://127.0.0.1:8787/sse" } },
      { inheritedSdk: { type: "sdk", name: "shared-tools" } },
    ]);
  });

  it("drops malformed commands, URLs, names and non-string secrets", () => {
    expect(normalizeProjectAgentMcpServers([
      "bad server name",
      { "../escape": { command: "node" } },
      { missing: { type: "stdio" } },
      { file: { type: "http", url: "file:///secret" } },
      { badHeader: { type: "http", url: "https://mcp.example.test", headers: { token: 123 } } },
    ])).toEqual([
      { badHeader: { type: "http", url: "https://mcp.example.test" } },
    ]);
  });
});
