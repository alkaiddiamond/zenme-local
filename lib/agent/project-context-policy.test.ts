import { describe, expect, it } from "vitest";

import {
  planProjectAgentCompaction,
  projectProjectAgentToolResultsForModel,
  PROJECT_AGENT_TOOL_RESULT_CLEARED,
  thinProjectAgentToolResults,
} from "@/lib/agent/project-context-policy";
import type { ProjectAgentEvent, ProjectAgentSession } from "@/lib/agent/project-session-types";

describe("project agent context policy", () => {
  it("keeps complete recent turns instead of splitting tool call and result events", () => {
    const session = makeSession([
      ...turn("turn-1", 1, "first"),
      ...turn("turn-2", 3, "second"),
      ...turn("turn-3", 5, "third", true),
      ...turn("turn-4", 9, "fourth"),
    ]);
    const plan = planProjectAgentCompaction(session, {
      minTokens: 1,
      minTextMessages: 2,
      maxTokens: 100,
    });

    expect(plan).not.toBeNull();
    expect(new Set(plan!.eventsToKeep.map((event) => event.turnId))).toEqual(new Set(["turn-4"]));
    expect(plan!.eventsToKeep.map((event) => event.type)).toEqual(["user", "assistant"]);
    expect(plan!.compactedThroughSequence).toBe(8);
    expect(plan!.eventsToSummarize.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("keeps a pending approval turn even when it is older than the recent tail", () => {
    const events = [
      ...turn("turn-1", 1, "first"),
      event(3, "turn-2", "approval", undefined, { status: "pending", commandRequestId: "command-1" }),
      ...turn("turn-3", 4, "third"),
    ];
    const plan = planProjectAgentCompaction(makeSession(events), {
      minTokens: 1,
      minTextMessages: 1,
      maxTokens: 1,
    });

    expect(plan?.eventsToSummarize.map((item) => item.turnId)).toEqual(["turn-1", "turn-1"]);
    expect(plan?.eventsToKeep.map((item) => item.turnId)).toEqual(["turn-2", "turn-3", "turn-3"]);
  });

  it("protects an unresolved tool call but releases the turn after its result is recorded", () => {
    const unresolved = event(3, "turn-2", "toolCall", undefined, { status: "requested" });
    const baseEvents = [
      ...turn("turn-1", 1, "first"),
      unresolved,
      ...turn("turn-3", 4, "third"),
    ];
    const config = { minTokens: 1, minTextMessages: 1, maxTokens: 1 };

    expect(planProjectAgentCompaction(makeSession(baseEvents), config)?.eventsToKeep
      .map((item) => item.turnId)).toEqual(["turn-2", "turn-3", "turn-3"]);

    const resolvedEvents = [
      ...baseEvents.slice(0, 3),
      event(4, "turn-2", "toolResult", "done", { toolCallEventId: unresolved.id }),
      ...turn("turn-3", 5, "third"),
    ];
    expect(planProjectAgentCompaction(makeSession(resolvedEvents), config)?.eventsToKeep
      .map((item) => item.turnId)).toEqual(["turn-3", "turn-3"]);
  });

  it("clears only old tool payloads in the model projection and leaves source events unchanged", () => {
    const events = [
      event(1, "turn-1", "toolResult", "large old output", { name: "read_file", toolCallId: "tool-1", output: "x".repeat(20_000) }),
      event(2, "turn-2", "toolResult", "recent output", { name: "read_file", toolCallId: "tool-2", output: "ok" }),
      event(3, "turn-3", "user", "continue"),
    ];
    const projected = thinProjectAgentToolResults(events, { keepRecent: 1, minSavedTokens: 1 });

    expect(projected.clearedEventIds).toEqual(["event-1"]);
    expect(projected.events[0]).toMatchObject({
      content: PROJECT_AGENT_TOOL_RESULT_CLEARED,
      data: { compacted: true, toolCallId: "tool-1" },
    });
    expect(projected.events[1]).toBe(events[1]);
    expect(events[0]?.content).toBe("large old output");
    expect(events[0]?.data?.output).toHaveLength(20_000);
  });

  it("can thin completed payloads inside the latest active turn without mutating history", () => {
    const oldCall = event(2, "turn-1", "toolCall", undefined, {
      status: "succeeded",
      name: "write_file",
      arguments: { relativePath: "large.txt", content: "x".repeat(20_000) },
    });
    const events = [
      event(1, "turn-1", "user", "continue"),
      oldCall,
      event(3, "turn-1", "toolResult", "written", {
        name: "write_file",
        status: "succeeded",
        toolCallEventId: oldCall.id,
        output: "x".repeat(20_000),
      }),
      event(4, "turn-1", "toolResult", "recent", { name: "write_file", output: "ok" }),
    ];

    const projected = thinProjectAgentToolResults(events, {
      keepRecent: 1,
      minSavedTokens: 1,
      protectLatestUserTurn: false,
    });

    expect(projected.clearedEventIds).toEqual(["event-3"]);
    expect(projected.events[1]?.data).toMatchObject({
      compacted: true,
      arguments: { relativePath: "large.txt" },
    });
    expect(JSON.stringify(projected.events[1]?.data)).not.toContain("x".repeat(1_000));
    expect(events[1]?.data?.arguments).toMatchObject({ content: "x".repeat(20_000) });
  });

  it("keeps durable tool results even when they are older than the retained tail", () => {
    const events = [
      event(1, "turn-1", "toolResult", "approval state", {
        name: "ask_user_question",
        output: "x".repeat(20_000),
      }),
      event(2, "turn-2", "toolResult", "large file", {
        name: "read_file",
        output: "x".repeat(20_000),
      }),
      event(3, "turn-3", "toolResult", "recent file", { name: "read_file", output: "ok" }),
    ];

    const projected = thinProjectAgentToolResults(events, { keepRecent: 1, minSavedTokens: 1 });

    expect(projected.clearedEventIds).toEqual(["event-2"]);
    expect(projected.events[0]).toBe(events[0]);
  });

  it("normalizes legacy command calls and results only in the model projection", () => {
    const events = [
      event(1, "turn-1", "toolCall", undefined, { name: "run_command", arguments: { command: "pnpm dev" } }),
      event(2, "turn-1", "toolResult", "legacy background result", {
        name: "run_command",
        toolCallEventId: "event-1",
        output: { id: "task-1", status: "running", outputFilePath: "C:/tmp/task-1.log" },
      }),
    ];

    const projected = projectProjectAgentToolResultsForModel(events);

    expect(projected.map((item) => item.data?.name)).toEqual(["shell_command", "shell_command"]);
    expect(projected[1]?.content).toContain("Command running in background with ID: task-1.");
    expect(events.map((item) => item.data?.name)).toEqual(["run_command", "run_command"]);
  });

  it("drops legacy Shell task_list history without hiding current Task V2 task_list", () => {
    const events = [
      event(1, "turn-1", "toolCall", undefined, { name: "task_list", arguments: { status: "running", limit: 20 } }),
      event(2, "turn-1", "toolResult", "task_list 完成", {
        name: "task_list",
        toolCallEventId: "event-1",
        output: {
          tasks: [{ id: "shell-1", executable: "pnpm", args: ["run", "dev"], status: "running" }],
          guidance: "需要重启任务时，把 restartCommand 原样传给 shell_command。",
        },
      }),
      event(3, "turn-2", "toolCall", undefined, { name: "task_list", arguments: {} }),
      event(4, "turn-2", "toolResult", "task_list 完成：项目任务", {
        name: "task_list",
        toolCallEventId: "event-3",
        output: { tasks: [{ id: "project-1", subject: "检查实现", status: "pending" }] },
      }),
    ];

    const projected = projectProjectAgentToolResultsForModel(events);

    expect(projected.map((item) => item.id)).toEqual(["event-3", "event-4"]);
  });

  it("migrates legacy tool protocol only in the model projection", () => {
    const events = [
      event(1, "turn-1", "toolCall", undefined, {
        name: "run_command",
        arguments: { command: "npm run dev", background: true },
      }),
      event(2, "turn-1", "toolResult", "running", {
        name: "run_command",
        toolCallEventId: "event-1",
        output: { id: "shell-1", status: "running" },
      }),
      event(3, "turn-2", "toolCall", undefined, { name: "project_task_list", arguments: {} }),
      event(4, "turn-2", "toolResult", "tasks", {
        name: "project_task_list",
        toolCallEventId: "event-3",
        output: { tasks: [] },
      }),
    ];

    const projected = projectProjectAgentToolResultsForModel(events);

    expect(projected[0]?.data).toMatchObject({
      name: "shell_command",
      arguments: { command: "npm run dev", run_in_background: true },
    });
    expect(projected[2]?.data?.name).toBe("task_list");
    expect(projected[3]?.data?.name).toBe("task_list");
    expect(events[0]?.data).toMatchObject({ name: "run_command", arguments: { background: true } });
  });

  it("keeps retired runtime strategy tools out of new model context", () => {
    const events = [
      event(1, "turn-1", "toolCall", undefined, { name: "restart_service", arguments: { port: 5173 } }),
      event(2, "turn-1", "toolResult", "restarted", { name: "restart_service", toolCallEventId: "event-1" }),
      event(3, "turn-2", "toolCall", undefined, { name: "todo_write", arguments: { items: [] } }),
      event(4, "turn-2", "toolResult", "saved", { name: "todo_write", toolCallEventId: "event-3" }),
      event(5, "turn-3", "assistant", {}, "current answer"),
    ];

    expect(projectProjectAgentToolResultsForModel(events).map((item) => item.id)).toEqual(["event-5"]);
  });
  it("does not microcompact when the actual token saving is below the threshold", () => {
    const events = [
      event(1, "turn-1", "toolResult", "small", { name: "read_file", output: "tiny" }),
      event(2, "turn-2", "toolResult", "recent", { name: "read_file", output: "ok" }),
    ];

    const projected = thinProjectAgentToolResults(events, { keepRecent: 1, minSavedTokens: 100 });

    expect(projected).toEqual({
      events,
      clearedEventIds: [],
      newlyClearedEventIds: [],
      estimatedTokensSaved: 0,
      newlyEstimatedTokensSaved: 0,
    });
  });

  it("keeps a recorded microcompact boundary without repeatedly reporting the same result as new", () => {
    const events = [
      event(1, "turn-1", "toolResult", "large", { name: "read_file", output: "x".repeat(20_000) }),
      event(2, "turn-2", "toolResult", "recent", { name: "read_file", output: "ok" }),
    ];

    const projected = thinProjectAgentToolResults(events, {
      clearedEventIds: ["event-1"],
      keepRecent: 1,
    });

    expect(projected.clearedEventIds).toEqual(["event-1"]);
    expect(projected.newlyClearedEventIds).toEqual([]);
    expect(projected.events[0]?.content).toBe(PROJECT_AGENT_TOOL_RESULT_CLEARED);
  });
});

function turn(turnId: string, sequence: number, content: string, withTool = false) {
  const events = [
    event(sequence, turnId, "user", `${content} request`),
    event(sequence + 1, turnId, "assistant", `${content} response`),
  ];
  if (withTool) {
    events.push(
      event(sequence + 2, turnId, "toolCall", undefined, { status: "succeeded", toolCallId: `${turnId}-tool` }),
      event(sequence + 3, turnId, "toolResult", "tool output", { status: "succeeded", toolCallId: `${turnId}-tool` }),
    );
  }
  return events;
}

function event(
  sequence: number,
  turnId: string,
  type: ProjectAgentEvent["type"],
  content?: string,
  data?: Record<string, unknown>,
): ProjectAgentEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    turnId,
    type,
    content,
    data,
    createdAt: new Date(1_700_000_000_000 + sequence).toISOString(),
  };
}

function makeSession(events: ProjectAgentEvent[]): ProjectAgentSession {
  return {
    version: 1,
    id: "session-1",
    projectId: "project-1",
    events,
    compactCheckpoints: [],
    taskPlan: [],
    context: {
      modelId: null,
      contextWindowTokens: null,
      inputTokens: 0,
      outputTokens: 0,
      estimatedEffectiveTokens: 0,
      compactedThroughSequence: 0,
      activeSummary: "",
      consecutiveCompactionFailures: 0,
    },
    createdAt: new Date(1_700_000_000_000).toISOString(),
    updatedAt: new Date(1_700_000_000_000).toISOString(),
  };
}
