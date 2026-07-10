import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT_DIR = process.cwd();

function readProjectFile(filePath: string) {
  return readFileSync(path.join(ROOT_DIR, filePath), "utf8");
}

describe("agent panel structure", () => {
  it("keeps AgentPanel focused on orchestration instead of panel UI markup", () => {
    const source = readProjectFile("components/zenme/agent-panel.tsx");

    expect(source).toContain("AgentPanelShell");
    expect(source).toContain("AgentMessageList");
    expect(source).toContain("AgentComposer");
    expect(source).toContain("requestAgentChat");
    expect(source).toContain("readAiChatStreamDeltas");
    expect(source).toContain("applyAssistantMessageContent");
    expect(source).toContain("abortRef.current?.abort()");
    expect(source).not.toContain('fetch("/api/ai/chat"');
    expect(source).not.toContain("JSON.stringify({ model");
    expect(source).not.toContain("new TextDecoder");
    expect(source).not.toContain(".getReader()");
    expect(source).not.toContain('role: "assistant",');
    expect(source).not.toContain("ZenmeCopyButton");
    expect(source).not.toContain("ZenmeModelPicker");
  });

  it("shares AgentMessage from a non-UI type module", () => {
    const canvasClientSource = readProjectFile("components/zenme/canvas-client.tsx");
    const sessionSource = readProjectFile(
      "components/zenme/canvas/agent-session.ts",
    );
    const canvasTypesSource = readProjectFile("components/zenme/canvas/types.ts");

    expect(canvasClientSource).toContain("@/components/zenme/agent-types");
    expect(sessionSource).toContain("@/components/zenme/agent-types");
    expect(canvasTypesSource).toContain("@/components/zenme/agent-types");
    expect(canvasClientSource).not.toContain("type AgentMessage } from");
    expect(sessionSource).not.toContain("@/components/zenme/agent-panel");
    expect(canvasTypesSource).not.toContain("@/components/zenme/agent-panel");
  });
});
