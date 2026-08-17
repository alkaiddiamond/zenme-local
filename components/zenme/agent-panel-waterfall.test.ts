import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentEventWaterfall } from "@/components/zenme/agent-panel-parts";
import type { ProjectAgentEvent } from "@/lib/agent/project-session-types";

function event(
  sequence: number,
  type: ProjectAgentEvent["type"],
  content?: string,
  data?: Record<string, unknown>,
): ProjectAgentEvent {
  return {
    id: `event-${sequence}`,
    sequence,
    turnId: "turn-1",
    type,
    content,
    data,
    createdAt: new Date(sequence).toISOString(),
  };
}

describe("AgentEventWaterfall", () => {
  it("keeps turn order, collapses completed activity and shows only the latest final answer", () => {
    const events = [
      event(1, "user", "启动后台任务"),
      event(2, "thinking", "正在判断启动方式"),
      event(3, "toolCall", undefined, { name: "shell_command", status: "running" }),
      event(4, "toolResult", "后台任务已启动", { name: "run_command", status: "succeeded", output: { id: "task-1", status: "running" } }),
      event(5, "assistant", "任务已经启动。"),
      event(6, "toolResult", "后台任务已完成", { name: "task_output", status: "succeeded", backgroundTaskNotification: true, output: { id: "task-1", status: "succeeded" } }),
      event(7, "assistant", "任务已经完成。"),
      event(8, "status", undefined, { stage: "completed" }),
    ];
    const html = renderToStaticMarkup(createElement(AgentEventWaterfall, {
      events,
      messages: [
        { role: "user", content: "启动后台任务" },
        { role: "assistant", content: "任务已经启动。" },
        { role: "assistant", content: "任务已经完成。" },
      ],
      onApproveCommand: () => undefined,
      onCopyMessage: () => undefined,
    }));

    expect(html).toContain("执行记录 (5)");
    expect(html).toContain("思考过程");
    expect(html).not.toContain("任务已经启动。</div>");
    expect(html).toContain("任务已经完成。</div>");
    expect(html.indexOf("启动后台任务")).toBeLessThan(html.indexOf("执行记录"));
    expect(html.indexOf("执行记录")).toBeLessThan(html.indexOf("任务已经完成。"));
  });

  it("keeps a pending user question visible and records memory events", () => {
    const events = [
      event(1, "user", "继续规划"),
      event(2, "toolResult", "请选择优先方向", {
        name: "ask_user_question",
        status: "waitingInput",
        output: { options: [{ label: "Agent", description: "优先 Agent 循环" }, { label: "Memory" }] },
      }),
      event(3, "status", undefined, { stage: "waitingInput" }),
      event(4, "memory", "自动做梦生成候选记忆：优先 Agent", { status: "candidate" }),
    ];
    const html = renderToStaticMarkup(createElement(AgentEventWaterfall, {
      events,
      messages: [{ role: "user", content: "继续规划" }],
      onApproveCommand: () => undefined,
      onCopyMessage: () => undefined,
    }));

    expect(html).toContain("等待用户回答");
    expect(html).toContain("请选择优先方向");
    expect(html).toContain("Agent");
    expect(html).toContain("Project Memory");
    expect(html).toContain("执行记录 (3)");
  });

  it("does not keep a recovered tool failure as the completed turn's active state", () => {
    const events = [
      event(1, "user", "读取页面后继续"),
      event(2, "toolResult", "第一次读取失败", { name: "web_fetch", status: "failed" }),
      event(3, "toolResult", "第二次读取成功", { name: "web_fetch", status: "succeeded" }),
      event(4, "assistant", "页面已经读取并完成总结。"),
      event(5, "status", undefined, { stage: "completed" }),
    ];
    const html = renderToStaticMarkup(createElement(AgentEventWaterfall, {
      events,
      messages: [
        { role: "user", content: "读取页面后继续" },
        { role: "assistant", content: "页面已经读取并完成总结。" },
      ],
      onApproveCommand: () => undefined,
      onCopyMessage: () => undefined,
    }));

    expect(html.match(/第一次读取失败/g)).toHaveLength(1);
    expect(html).toContain("页面已经读取并完成总结。");
    expect(html).toContain("执行记录 (3)");
  });
});
