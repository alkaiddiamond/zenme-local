import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";
import { agentEventContentForDisplay, extractAssistantOutputTargets, projectAgentTurnAnswer, projectAgentTurnAnswerDraft, projectTurnCanRetry, projectTurnChangeSetIds, projectTurnCommandForDisplay, projectTurnCompletedStepCount, projectTurnEvidenceEvents, projectTurnEventsForDisplay, projectTurnIsTerminal, projectTurnRunningBackgroundTasks, projectTurnSettledState, projectTurnTerminalError } from "@/components/zenme/nodes/agent-turn-timeline";
import { serializeMcpElicitationFormValues } from "@/components/zenme/mcp-elicitation-form";

const timelineSource = readFileSync(new URL("./agent-turn-timeline.tsx", import.meta.url), "utf8");

describe("AI reply node Agent Turn timeline", () => {
  it("keeps retry and execution evidence actions visually distinct", () => {
    expect(timelineSource).toContain("border-red-200 bg-white");
    expect(timelineSource).toContain("text-red-700");
    expect(timelineSource).toContain("border-zinc-200/80 bg-zinc-50/70");
    expect(timelineSource).toContain("aria-expanded={showEvidence}");
  });

  it("does not resume a form elicitation until every required field is valid", () => {
    const schema = { required: ["format", "includeMetadata"] };
    expect(serializeMcpElicitationFormValues(schema, { includeMetadata: false })).toBe("");
    expect(serializeMcpElicitationFormValues(schema, { format: "svg", includeMetadata: false }))
      .toBe(JSON.stringify({ format: "svg", includeMetadata: false }));
  });

  it("removes terminal color sequences from stored command output", () => {
    expect(agentEventContentForDisplay("\u001b[32mready\u001b[39m\rprogress")).toBe("ready\nprogress");
  });

  it("resolves the latest assistant answer for the requested turn", () => {
    const events = [
      event(1, "assistant", {}, "旧回答"),
      { ...event(2, "assistant", {}, "其他 Turn"), turnId: "turn-2" },
      event(3, "assistant", {}, "最新回答"),
    ];

    expect(projectAgentTurnAnswer(events, "turn-1", "画布缓存")).toBe("最新回答");
    expect(projectAgentTurnAnswer(events, "missing", "画布缓存")).toBe("画布缓存");
  });

  it("shows only the active streamed assistant draft before a tool or terminal state supersedes it", () => {
    const streaming = [
      event(1, "status", { stage: "thinking" }),
      event(2, "assistantDraft", { status: "streaming" }, "正在生成答复"),
    ];
    expect(projectAgentTurnAnswerDraft(streaming, "turn-1")).toBe("正在生成答复");
    expect(projectAgentTurnAnswerDraft([
      ...streaming,
      event(3, "toolCall", { name: "read_file", status: "running" }),
    ], "turn-1")).toBe("");
    expect(projectAgentTurnAnswerDraft([
      ...streaming,
      event(3, "status", { stage: "failed" }),
    ], "turn-1")).toBe("");
  });

  it("projects only the current activity while a turn is running", () => {
    const events = [
      event(1, "status", { stage: "thinking" }),
      event(2, "toolCall", { name: "web_search", status: "running" }),
      event(3, "toolResult", { name: "web_search", status: "succeeded", toolCallEventId: "event-2" }),
      event(4, "status", { stage: "searching" }),
    ];

    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-4"]);
    expect(projectTurnCompletedStepCount(events)).toBe(1);
  });

  it("keeps the planning phase distinct from model thinking", () => {
    const planning = [event(1, "status", { stage: "planning" })];
    const thinking = [...planning, event(2, "status", { stage: "thinking" })];

    expect(projectTurnEventsForDisplay(planning).map((item) => item.data?.stage)).toEqual(["planning"]);
    expect(projectTurnEventsForDisplay(thinking).map((item) => item.data?.stage)).toEqual(["thinking"]);
  });

  it("shows an unresolved tool call instead of accumulated completed cards", () => {
    const events = [
      event(1, "toolCall", { name: "web_search", status: "running" }),
      event(2, "toolResult", { name: "web_search", status: "succeeded", toolCallEventId: "event-1" }),
      event(3, "toolCall", { name: "web_fetch", status: "running" }),
    ];

    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-3"]);
    expect(projectTurnCompletedStepCount(events)).toBe(1);
  });

  it("keeps Workflow progress on one live card and removes it after the final answer", () => {
    const running = [
      event(1, "toolCall", {
        name: "workflow",
        status: "running",
        progress: true,
        runId: "workflow-run-1",
        workflowProgress: { type: "workflow_phase", title: "Review" },
      }, "Workflow 阶段：Review"),
    ];

    expect(projectTurnEventsForDisplay(running).map((item) => item.id)).toEqual(["event-1"]);

    const completed = [
      ...running,
      event(2, "toolResult", {
        name: "workflow",
        status: "succeeded",
        toolCallEventId: "event-1",
      }, "Workflow 已在后台启动"),
      event(3, "assistant", {}, "Workflow 已启动，完成后会通知。"),
      event(4, "status", { stage: "completed" }),
    ];

    expect(projectTurnEventsForDisplay(completed)).toEqual([]);
  });

  it("keeps the structured question visible while the Turn waits for input", () => {
    const events = [
      event(1, "toolCall", { name: "ask_user_question", status: "running" }),
      event(2, "toolResult", {
        name: "ask_user_question",
        status: "waitingInput",
        toolCallEventId: "event-1",
        output: { question: "选择方向", options: [{ label: "A" }, { label: "B" }] },
      }, "选择方向"),
      event(3, "status", { stage: "waitingInput" }),
    ];

    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-2"]);
    expect(projectTurnSettledState(events)).toEqual({ status: "waitingInput" });
  });

  it("keeps an Exit Plan Mode approval visible while the Turn waits", () => {
    const events = [
      event(1, "toolCall", { name: "exit_plan_mode", status: "running" }),
      event(2, "toolResult", {
        name: "exit_plan_mode",
        status: "waitingInput",
        toolCallEventId: "event-1",
        output: {
          plan: "## 实施计划\n1. 修改运行时",
          question: "批准该计划并开始实施吗？",
          options: [{ label: "批准并开始实施" }, { label: "继续修改计划" }],
        },
      }, "## 实施计划\n1. 修改运行时"),
      event(3, "status", { stage: "waitingInput" }),
    ];

    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-2"]);
    expect(projectTurnSettledState(events)).toEqual({ status: "waitingInput" });
  });

  it("shows live Sub-agent progress instead of a static delegation tool card", () => {
    const events = [
      event(1, "toolCall", { name: "delegate_tasks", status: "running" }),
      event(2, "status", {
        stage: "delegating",
        completedCount: 1,
        totalCount: 2,
        runningTitles: ["模块 B"],
      }),
    ];

    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-2"]);
  });

  it("shows the latest projected Sub-agent action while delegation is running", () => {
    const events = [
      event(1, "toolCall", { name: "delegate_tasks", status: "running" }),
      event(2, "status", { stage: "delegating", runningTitles: ["启动服务"] }),
      event(3, "toolCall", {
        name: "run_command",
        status: "running",
        delegated: true,
        delegatedSourceId: "command:1",
        uiProjection: true,
      }, "启动服务：pnpm run dev"),
    ];

    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-3"]);
    expect(projectTurnEventsForDisplay([
      ...events,
      event(4, "toolResult", {
        name: "run_command",
        status: "succeeded",
        delegated: true,
        delegatedSourceId: "command:1",
        toolCallEventId: "event-3",
        uiProjection: true,
      }, "启动服务：后台任务已启动"),
    ]).map((item) => item.id)).toEqual(["event-4"]);
  });

  it("keeps a running background task visible after the foreground Turn settles", () => {
    const started = event(1, "toolResult", {
      executionId: "execution-1",
      name: "run_command",
      status: "succeeded",
      output: {
        id: "task-1",
        executable: "pnpm",
        args: ["run", "dev"],
        status: "running",
      },
    });
    expect(projectTurnRunningBackgroundTasks([started])).toEqual([{
      id: "task-1",
      executionId: "execution-1",
      command: "pnpm run dev",
    }]);

    expect(projectTurnRunningBackgroundTasks([
      started,
      event(2, "assistant", {}, "开发服务已在后台启动"),
      event(3, "status", { stage: "completed" }),
    ])).toEqual([{
      id: "task-1",
      executionId: "execution-1",
      command: "pnpm run dev",
    }]);

    expect(projectTurnRunningBackgroundTasks([
      started,
      event(2, "toolResult", {
        name: "task_output",
        backgroundTaskNotification: true,
        output: { id: "task-1", status: "succeeded" },
      }),
    ])).toEqual([]);
  });

  it("shows the original Shell command instead of its PowerShell wrapper", () => {
    expect(projectTurnCommandForDisplay({
      command: "pnpm run dev",
      executable: "powershell",
      args: ["-NoLogo", "-Command", "pnpm run dev"],
    })).toBe("pnpm run dev");
    expect(projectTurnRunningBackgroundTasks([
      event(1, "toolResult", {
        executionId: "execution-1",
        name: "shell_command",
        status: "succeeded",
        output: {
          id: "task-1",
          command: "pnpm run dev",
          executable: "powershell",
          args: ["-NoLogo", "-Command", "pnpm run dev"],
          status: "running",
        },
      }),
    ])).toEqual([{ id: "task-1", executionId: "execution-1", command: "pnpm run dev" }]);
  });

  it("hides transient statuses and read-only tool traces after completion", () => {
    const events = [
      event(1, "status", { stage: "thinking" }),
      event(2, "toolResult", { name: "web_search", status: "succeeded" }),
      event(3, "thinking", {}, "正在总结"),
      event(4, "toolResult", { name: "run_command", status: "succeeded" }),
      event(5, "assistant", {}, "最终回答"),
      event(6, "status", { stage: "completed" }),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([]);
    expect(projectTurnCompletedStepCount(events)).toBe(0);
  });

  it("does not count a steering-interrupted read as a completed step", () => {
    const events = [
      event(1, "toolCall", { name: "read_file", status: "running" }),
      event(2, "toolResult", { name: "read_file", status: "interrupted", toolCallEventId: "event-1" }),
      event(3, "status", { stage: "steering" }),
    ];

    expect(projectTurnCompletedStepCount(events)).toBe(0);
    expect(projectTurnEventsForDisplay(events).map((item) => item.id)).toEqual(["event-3"]);
  });

  it("shows context compaction while running and moves its result into terminal evidence", () => {
    const runningEvents = [
      event(1, "status", { stage: "thinking" }),
      event(2, "status", { stage: "compacting", sourceTokenEstimate: 80_000 }),
    ];
    expect(projectTurnEventsForDisplay(runningEvents).map((item) => item.id)).toEqual(["event-2"]);

    const completedEvents = [
      ...runningEvents,
      event(3, "compact", { sourceTokenEstimate: 80_000 }, "早期上下文摘要"),
      event(4, "status", { stage: "thinking" }),
      event(5, "assistant", {}, "最终回答"),
      event(6, "status", { stage: "completed" }),
    ];
    expect(projectTurnEventsForDisplay(completedEvents)).toEqual([]);
    expect(projectTurnEvidenceEvents(completedEvents).map((item) => item.id)).toEqual(["event-3"]);
  });

  it("moves Project Memory changes into terminal evidence", () => {
    const events = [
      event(1, "assistant", {}, "最终回答"),
      event(2, "status", { stage: "completed" }),
      event(3, "memory", { source: "autoDream", status: "running" }, "正在整理"),
      event(4, "memory", { source: "autoDream", status: "candidate", memoryId: "memory-1" }, "自动做梦生成候选记忆：架构决策"),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([]);
    expect(projectTurnEvidenceEvents(events).map((item) => item.id)).toEqual(["event-3", "event-4"]);
  });

  it("moves task plans into terminal evidence", () => {
    const events = [
      event(1, "todo", { items: [{ id: "inspect", content: "检查实现", status: "in_progress" }] }),
      event(2, "todo", { items: [{ id: "inspect", content: "检查实现", status: "completed" }] }),
      event(3, "assistant", {}, "已完成"),
      event(4, "status", { stage: "completed" }),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([]);
    expect(projectTurnEvidenceEvents(events).map((item) => item.id)).toEqual(["event-1", "event-2"]);
  });

  it("keeps failed-turn execution details out of the answer body and in evidence", () => {
    const events = [
      event(1, "approval", { status: "rejected" }),
      event(2, "toolResult", { name: "web_fetch", status: "failed" }),
      event(3, "toolResult", { name: "run_command", status: "failed" }),
      event(4, "status", { stage: "failed" }),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([]);
    expect(projectTurnEvidenceEvents(events).map((item) => item.id)).toEqual(["event-1", "event-2", "event-3"]);
  });

  it("filters internal notifications and hook feedback from terminal evidence", () => {
    const events = [
      event(1, "toolCall", { name: "read_file", status: "running" }),
      event(2, "toolResult", { name: "read_file", status: "succeeded", toolCallEventId: "event-1" }, "read result"),
      event(3, "toolResult", { name: "task_output", backgroundTaskNotification: true }, "background complete"),
      event(4, "toolResult", { name: "agent_hook", hookLifecycle: true }, "hook feedback"),
      event(5, "toolResult", { name: "queue", queueMessageId: "queue-1" }, "queued message"),
      event(6, "assistant", {}, "最终回答"),
      event(7, "status", { stage: "completed" }),
    ];

    expect(projectTurnEvidenceEvents(events).map((item) => item.id)).toEqual(["event-2"]);
  });

  it("collapses legacy terminal tool calls into their later result without toolCallEventId", () => {
    const events = [
      event(1, "toolCall", { name: "task_list", status: "running" }),
      event(2, "toolResult", { name: "task_list", status: "failed" }, "参数无效"),
      event(3, "status", { stage: "failed" }),
    ];

    expect(projectTurnEvidenceEvents(events).map((item) => item.id)).toEqual(["event-2"]);
  });

  it("keeps a truly orphaned terminal tool call as interrupted evidence without a running spinner", () => {
    const events = [
      event(1, "toolCall", { name: "task_list", status: "running" }),
      event(2, "status", { stage: "failed" }),
    ];

    expect(projectTurnEvidenceEvents(events).map((item) => item.id)).toEqual(["event-1"]);
    expect(timelineSource).toContain('const running = event.type === "toolCall" && !terminal;');
    expect(timelineSource).toContain("未收到对应结果，已随 Turn 结束");
  });

  it("uses a slower refresh cadence for settled turns that still own background work", () => {
    expect(timelineSource).toContain("const SETTLED_BACKGROUND_REFRESH_MS = 2_000;");
    expect(timelineSource).toContain("const refreshMs = terminal ? SETTLED_BACKGROUND_REFRESH_MS : ACTIVE_TURN_REFRESH_MS;");
  });

  it("uses the latest status when a resumed turn starts running again", () => {
    const events = [
      event(1, "status", { stage: "completed" }),
      event(2, "status", { stage: "thinking" }),
    ];

    expect(projectTurnIsTerminal(events)).toBe(false);
  });

  it("hides a recovered page failure after the turn completes successfully", () => {
    const events = [
      event(1, "toolResult", { name: "web_fetch", status: "failed" }, "网页连接失败"),
      event(2, "assistant", {}, "最终回答"),
      event(3, "status", { stage: "completed" }),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([]);
  });

  it("shows the runtime failure when a failed turn has no final answer", () => {
    const events = [
      event(1, "status", { stage: "thinking" }),
      event(2, "status", { stage: "failed" }),
    ];

    expect(projectTurnTerminalError(events, "Agent 工具调用轮数达到安全上限")).toBe("Agent 工具调用轮数达到安全上限");
    expect(projectTurnTerminalError(events, "Agent 工具调用轮数达到安全上限", "已有回答")).toBe("");
  });

  it("recovers a persisted runtime failure after the canvas is reopened", () => {
    const events = [event(1, "status", { stage: "failed", error: "研究未能形成最终回答" })];

    expect(projectTurnTerminalError(events)).toBe("研究未能形成最终回答");
    expect(projectTurnSettledState(events)).toEqual({ status: "failed", error: "研究未能形成最终回答" });
  });

  it("offers a fresh downstream retry only for failed or stopped Turns", () => {
    expect(projectTurnCanRetry([event(1, "status", { stage: "failed" })])).toBe(true);
    expect(projectTurnCanRetry([event(1, "status", { stage: "stopped" })])).toBe(true);
    expect(projectTurnCanRetry([event(1, "status", { stage: "completed" })])).toBe(false);
    expect(projectTurnCanRetry([event(1, "status", { stage: "waitingApproval" })])).toBe(false);
  });

  it("projects a completed answer back into the canvas node state", () => {
    const events = [
      event(1, "assistant", {}, "最终回答"),
      event(2, "status", { stage: "completed" }),
    ];

    expect(projectTurnSettledState(events, undefined, "最终回答")).toEqual({ status: "done", answer: "最终回答" });
  });

  it("shows an Agent checkpoint while running but never mistakes it for a terminal answer", () => {
    const running = [
      event(1, "assistant", { checkpoint: true }, "我先检查真实状态。"),
      event(2, "toolCall", { name: "workspace_status", status: "running" }),
    ];
    expect(projectAgentTurnAnswer(running, "turn-1")).toBe("我先检查真实状态。");

    const failed = [...running, event(3, "status", { stage: "failed", error: "检查失败" })];
    expect(projectAgentTurnAnswer(failed, "turn-1")).toBeUndefined();
    expect(projectTurnTerminalError(failed, undefined, projectAgentTurnAnswer(failed, "turn-1"))).toBe("检查失败");

    const completed = [
      ...running,
      event(3, "assistant", {}, "Workspace 已检查完成。"),
      event(4, "status", { stage: "completed" }),
    ];
    expect(projectAgentTurnAnswer(completed, "turn-1")).toBe("Workspace 已检查完成。");
  });

  it("projects final loopback URLs into preview actions without scanning code blocks", () => {
    expect(extractAssistantOutputTargets([
      "开发模式已启动：http://127.0.0.1:5173/",
      "```",
      "http://localhost:9999/",
      "```",
      "备用地址 http://[::1]:4173/。",
    ].join("\n"))).toEqual([
      { label: "127.0.0.1:5173", url: "http://127.0.0.1:5173/" },
      { label: "localhost:4173", url: "http://localhost:4173/" },
    ]);
  });

  it("keeps delegated ChangeSets reachable after transient tool events collapse", () => {
    const events = [event(1, "toolResult", {
      name: "delegate_tasks",
      status: "succeeded",
      output: {
        tasks: [
          { changeSetIds: ["change-a", "change-shared"] },
          { changeSetIds: ["change-b", "change-shared"] },
        ],
      },
    })];

    expect(projectTurnChangeSetIds(events)).toEqual(["change-a", "change-shared", "change-b"]);
  });

  it("does not render a stale approval after the same command was rejected and the Turn resumed", () => {
    const events = [
      event(1, "approval", { commandRequestId: "command-a", status: "pending" }),
      event(2, "approval", { commandRequestId: "command-a", status: "rejected" }),
      event(3, "status", { stage: "thinking" }),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([events[2]]);
  });

  it("keeps another delegated command approval visible after its sibling was resolved", () => {
    const events = [
      event(1, "approval", { commandRequestId: "command-a", status: "pending" }),
      event(2, "approval", { commandRequestId: "command-b", status: "pending" }),
      event(3, "approval", { commandRequestId: "command-b", status: "succeeded" }),
      event(4, "status", { stage: "waitingApproval" }),
    ];

    expect(projectTurnEventsForDisplay(events)).toEqual([events[0]]);
  });

  it("keeps main Agent ChangeSets reachable from the AI reply node", () => {
    const events = [
      event(1, "toolResult", {
        name: "edit_file",
        status: "succeeded",
        output: { changeSetId: "change-main", status: "proposed" },
      }),
      event(2, "toolResult", {
        name: "delegate_tasks",
        status: "succeeded",
        output: { changeSetId: "change-main", tasks: [{ changeSetIds: ["change-child"] }] },
      }),
    ];

    expect(projectTurnChangeSetIds(events)).toEqual(["change-main", "change-child"]);
  });
});

function event(
  sequence: number,
  type: ProjectAgentEvent["type"],
  data: Record<string, unknown>,
  content?: string,
): ProjectAgentEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    turnId: "turn-1",
    type,
    createdAt: new Date(sequence * 1_000).toISOString(),
    data,
    content,
  };
}
