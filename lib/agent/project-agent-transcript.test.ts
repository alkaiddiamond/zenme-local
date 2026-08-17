import { describe, expect, it } from "vitest";

import { projectAgentTranscript } from "@/lib/agent/project-agent-transcript";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

function event(input: Partial<ProjectAgentEvent> & Pick<ProjectAgentEvent, "id" | "sequence" | "type">): ProjectAgentEvent {
  return {
    turnId: "turn-1",
    createdAt: "2026-08-17T00:00:00.000Z",
    ...input,
  };
}

describe("project agent transcript", () => {
  it("preserves cc-haha-style tool use and tool result relationships", () => {
    expect(projectAgentTranscript([
      event({ id: "user-1", sequence: 1, type: "user", content: "检查项目状态" }),
      event({ id: "call-1", sequence: 2, type: "toolCall", data: { name: "workspace_status", arguments: {} } }),
      event({ id: "result-1", sequence: 3, type: "toolResult", content: "项目可用", data: { name: "workspace_status", toolCallEventId: "call-1" } }),
      event({ id: "assistant-1", sequence: 4, type: "assistant", content: "项目状态正常。" }),
    ])).toEqual([
      { role: "user", content: "检查项目状态" },
      { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "workspace_status", arguments: {} }] },
      { role: "tool", content: "项目可用", toolCallId: "call-1", name: "workspace_status" },
      { role: "assistant", content: "项目状态正常。" },
    ]);
  });

  it("projects background completion notifications as user input", () => {
    expect(projectAgentTranscript([
      event({
        id: "notification-1",
        sequence: 1,
        type: "toolResult",
        content: "后台任务已完成",
        data: { backgroundTaskNotification: true, queueMessageId: "queue-1" },
      }),
    ])).toEqual([{ role: "user", content: "后台任务已完成" }]);
  });

  it("keeps lifecycle Hook feedback in the chronological model transcript", () => {
    expect(projectAgentTranscript([
      event({
        id: "hook-1",
        sequence: 1,
        type: "toolResult",
        content: "prompt hook context",
        data: { name: "agent_hook", hookLifecycle: true, status: "succeeded" },
      }),
    ])).toEqual([{ role: "user", content: "prompt hook context" }]);
  });

  it("preserves structured tool output instead of reducing it to a UI summary", () => {
    expect(projectAgentTranscript([
      event({ id: "call-1", sequence: 1, type: "toolCall", data: { name: "ask_user_question", arguments: {} } }),
      event({
        id: "result-1",
        sequence: 2,
        type: "toolResult",
        content: "用户回答：核心工具",
        data: {
          name: "ask_user_question",
          toolCallEventId: "call-1",
          output: { answer: "核心工具", status: "answered" },
        },
      }),
    ])).toEqual([
      { role: "assistant", content: "", toolCalls: [{ id: "call-1", name: "ask_user_question", arguments: {} }] },
      {
        role: "tool",
        content: '{"answer":"核心工具","status":"answered"}',
        toolCallId: "call-1",
        name: "ask_user_question",
      },
    ]);
  });
});
