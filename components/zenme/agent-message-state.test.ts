import { describe, expect, it } from "vitest";

import {
  appendAgentAssistantMessage,
  appendAgentUserMessage,
  appendEmptyAssistantMessage,
  applyAssistantMessageContent,
  getActiveProjectAgentTurnId,
  hasActiveProjectAgentTurn,
  hasPendingProjectAgentBackgroundTask,
  hasPendingProjectAgentMemoryTask,
} from "./agent-message-state";
import type { AgentMessage } from "./agent-types";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

describe("agent message state helpers", () => {
  it("appends a completed assistant message", () => {
    expect(appendAgentAssistantMessage([{ role: "user", content: "hello" }], "done"))
      .toEqual([
        { role: "user", content: "hello" },
        { role: "assistant", content: "done" },
      ]);
  });

  it("appends user and assistant messages without mutating previous messages", () => {
    const initial: AgentMessage[] = [{ role: "assistant", content: "你好" }];

    const withUser = appendAgentUserMessage(initial, "继续");
    const withAssistant = appendEmptyAssistantMessage(withUser);

    expect(initial).toEqual([{ role: "assistant", content: "你好" }]);
    expect(withUser).toEqual([
      { role: "assistant", content: "你好" },
      { role: "user", content: "继续" },
    ]);
    expect(withAssistant).toEqual([
      { role: "assistant", content: "你好" },
      { role: "user", content: "继续" },
      { role: "assistant", content: "" },
    ]);
  });

  it("updates only the latest assistant placeholder", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "写一句" },
      { role: "assistant", content: "" },
    ];

    expect(applyAssistantMessageContent(messages, "完成")).toEqual([
      { role: "user", content: "写一句" },
      { role: "assistant", content: "完成" },
    ]);
    expect(messages[1].content).toBe("");
  });

  it("does not rewrite history when the last message is not assistant", () => {
    const messages: AgentMessage[] = [{ role: "user", content: "等待中" }];

    expect(applyAssistantMessageContent(messages, "不应写入")).toEqual(messages);
  });

  it("detects active durable turns and ignores settled turns", () => {
    const event = (sequence: number, turnId: string, type: ProjectAgentEvent["type"], data?: Record<string, unknown>): ProjectAgentEvent => ({
      id: `${turnId}-${sequence}`,
      sequence,
      turnId,
      type,
      createdAt: new Date(sequence).toISOString(),
      data,
    });
    const settled = [
      event(1, "old", "user"),
      event(2, "old", "status", { stage: "completed" }),
    ];
    expect(hasActiveProjectAgentTurn(settled)).toBe(false);
    expect(hasActiveProjectAgentTurn([...settled, event(3, "active", "user")])).toBe(true);
    expect(getActiveProjectAgentTurnId([...settled, event(3, "active", "user")])).toBe("active");
    expect(hasActiveProjectAgentTurn([...settled, event(3, "approval", "user"), event(4, "approval", "status", { stage: "waitingApproval" })])).toBe(false);
    expect(hasActiveProjectAgentTurn([...settled, event(3, "resumed", "user"), event(4, "resumed", "status", { stage: "waitingApproval" }), event(5, "resumed", "approval", { status: "succeeded" })])).toBe(true);
    expect(hasActiveProjectAgentTurn([...settled, event(3, "old", "memory", { source: "autoDream", status: "candidate" })])).toBe(false);
  });

  it("keeps polling a background command after its foreground Turn settles", () => {
    const event = (sequence: number, data: Record<string, unknown>): ProjectAgentEvent => ({
      id: `event-${sequence}`,
      sequence,
      turnId: "turn-1",
      type: "toolResult",
      createdAt: new Date(sequence).toISOString(),
      data,
    });
    const started = event(1, {
      name: "run_command",
      output: { id: "task-1", status: "running" },
    });
    expect(hasPendingProjectAgentBackgroundTask([started])).toBe(true);
    expect(hasPendingProjectAgentBackgroundTask([
      started,
      {
        id: "status-2",
        projectId: "project-1",
        turnId: "turn-1",
        sequence: 2,
        type: "status",
        createdAt: new Date(2).toISOString(),
        data: { stage: "completed" },
      },
    ])).toBe(true);
    expect(hasPendingProjectAgentBackgroundTask([
      started,
      event(2, {
        name: "task_output",
        backgroundTaskNotification: true,
        output: { id: "task-1", status: "succeeded" },
      }),
    ])).toBe(false);
  });

  it("keeps polling while auto-dream is producing a memory candidate", () => {
    const event = (sequence: number, status: string): ProjectAgentEvent => ({
      id: `memory-${sequence}`,
      sequence,
      turnId: "turn-1",
      type: "memory",
      createdAt: new Date(sequence).toISOString(),
      data: { source: "autoDream", status },
    });
    expect(hasPendingProjectAgentMemoryTask([event(1, "running")])).toBe(true);
    expect(hasPendingProjectAgentMemoryTask([event(1, "running"), event(2, "candidate")])).toBe(false);
    expect(hasPendingProjectAgentMemoryTask([event(1, "running"), event(2, "failed")])).toBe(false);
  });
});
