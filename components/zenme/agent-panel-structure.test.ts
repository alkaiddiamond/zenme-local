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
    expect(source).toContain("AgentEventWaterfall");
    expect(source).toContain("AgentComposer");
    expect(source).toContain("getProjectAgentSessionFromApi");
    expect(source).toContain("runProjectAgentTurnFromApi");
    expect(source).toContain("steerProjectAgentTurnFromApi");
    expect(source).toContain("allowSteering={hasActiveTurn}");
    expect(source).toContain("abortRef.current?.abort()");
    expect(source).not.toContain('fetch("/api/ai/chat"');
    expect(source).not.toContain("requestAgentChat");
    expect(source).not.toContain("readAiChatStreamDeltas");
    expect(source).not.toContain("JSON.stringify({ model");
    expect(source).not.toContain("new TextDecoder");
    expect(source).not.toContain(".getReader()");
    expect(source).not.toContain('role: "assistant",');
    expect(source).not.toContain("ZenmeCopyButton");
    expect(source).not.toContain("ZenmeModelPicker");
  });

  it("renders Project Agent events as turn-scoped waterfall records", () => {
    const source = readProjectFile("components/zenme/agent-panel-parts.tsx");

    expect(source).toContain("export function AgentEventWaterfall");
    expect(source).toContain("执行记录 (");
    expect(source).toContain("上下文已压缩");
    expect(source).toContain("正在处理后台任务结果");
    expect(source).toContain("已完成 {completedStepCount} 个步骤");
  });

  it("shares AgentMessage from a non-UI type module without duplicating chat state in the canvas", () => {
    const canvasClientSource = readProjectFile("components/zenme/canvas-client.tsx");
    const sessionSource = readProjectFile(
      "components/zenme/canvas/agent-session.ts",
    );
    const canvasTypesSource = readProjectFile("components/zenme/canvas/types.ts");

    expect(sessionSource).toContain("@/components/zenme/agent-types");
    expect(canvasTypesSource).toContain("@/components/zenme/agent-types");
    expect(canvasClientSource).not.toContain("@/components/zenme/agent-types");
    expect(canvasClientSource).not.toContain("agentMessages");
    expect(canvasClientSource).not.toContain("<AgentPanel");
    expect(sessionSource).not.toContain("@/components/zenme/agent-panel");
    expect(canvasTypesSource).not.toContain("@/components/zenme/agent-panel");
  });
});
