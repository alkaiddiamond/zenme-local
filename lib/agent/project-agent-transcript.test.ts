import { describe, expect, it } from "vitest";

import { projectAgentTranscript, projectConversationEvents } from "@/lib/agent/project-agent-transcript";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

function event(input: Partial<ProjectAgentEvent> & Pick<ProjectAgentEvent, "id" | "sequence" | "type">): ProjectAgentEvent {
  return {
    turnId: "turn-1",
    createdAt: "2026-08-17T00:00:00.000Z",
    ...input,
  };
}

describe("project agent transcript", () => {
  it("projects only turns from the requested conversation", () => {
    const events = [
      event({ id: "a-user", sequence: 1, turnId: "turn-a", conversationId: "conv-a", type: "user", content: "A" }),
      event({ id: "a-assistant", sequence: 2, turnId: "turn-a", type: "assistant", content: "A reply" }),
      event({ id: "b-user", sequence: 3, turnId: "turn-b", conversationId: "conv-b", type: "user", content: "B" }),
      event({ id: "b-assistant", sequence: 4, turnId: "turn-b", type: "assistant", content: "B reply" }),
    ];
    expect(projectConversationEvents(events, "conv-b").map((item) => item.id)).toEqual([
      "b-user",
      "b-assistant",
    ]);
    expect(projectConversationEvents(events).map((item) => item.id)).toEqual([
      "a-user",
      "a-assistant",
      "b-user",
      "b-assistant",
    ]);
  });

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
