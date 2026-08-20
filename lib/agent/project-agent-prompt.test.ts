import { describe, expect, it } from "vitest";

import { PROJECT_AGENT_SYSTEM_PROMPT } from "@/lib/agent/project-agent-prompt";

describe("project agent system prompt", () => {
  it("carries cc-haha working discipline into every Agent Turn", () => {
    expect(PROJECT_AGENT_SYSTEM_PROMPT).toContain("优先使用专用工具");
    expect(PROJECT_AGENT_SYSTEM_PROMPT).toContain("多个互不依赖的只读动作");
    expect(PROJECT_AGENT_SYSTEM_PROMPT).toContain("避免 sleep 和轮询循环");
    expect(PROJECT_AGENT_SYSTEM_PROMPT).toContain("Git 提交、推送、建分支或创建 PR 仅在用户明确要求时执行");
    expect(PROJECT_AGENT_SYSTEM_PROMPT).toContain("第一次工具调用前");
    expect(PROJECT_AGENT_SYSTEM_PROMPT).toContain("简短 checkpoint");
  });
});
