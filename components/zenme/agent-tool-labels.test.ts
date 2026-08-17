import { describe, expect, it } from "vitest";

import { getActiveAgentToolLabel, getAgentToolLabel } from "@/components/zenme/agent-tool-labels";
import { MODEL_AGENT_TOOL_DEFINITIONS } from "@/lib/agent/tool-registry";

describe("Agent tool activity labels", () => {
  it("gives every model-visible built-in tool a user-facing completed and active label", () => {
    for (const definition of MODEL_AGENT_TOOL_DEFINITIONS) {
      expect(getAgentToolLabel(definition.name)).not.toBe(definition.name);
      expect(getActiveAgentToolLabel(definition.name)).not.toContain(definition.name);
      expect(getAgentToolLabel(definition.name).trim()).not.toBe("");
      expect(getActiveAgentToolLabel(definition.name).trim()).not.toBe("");
    }
  });

  it("keeps discovered MCP tools readable without exposing their full internal identifier", () => {
    expect(getAgentToolLabel("mcp__filesystem__read_file")).toBe("MCP · read file");
    expect(getActiveAgentToolLabel("mcp__filesystem__read_file")).toBe("正在调用 MCP · read file");
  });
});
