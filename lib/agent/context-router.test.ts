import { describe, expect, it } from "vitest";

import { formatAgentCanvasContext } from "@/lib/agent/context-router";

describe("formatAgentCanvasContext", () => {
  it("places the current node before connected graph context", () => {
    const context = formatAgentCanvasContext({
      currentNodeContext: "当前问题",
      connectedGraphContext: "上游背景",
    });

    expect(context.indexOf("当前问题")).toBeLessThan(context.indexOf("上游背景"));
    expect(context).toContain("当前用户指令 > 当前节点 > 显式连线/选择的画布上下文 > 当前 Conversation 历史 > Project 背景");
  });

  it("does not duplicate the legacy canvas context when layered context exists", () => {
    const context = formatAgentCanvasContext({
      currentNodeContext: "当前问题",
      connectedGraphContext: "上游背景",
      legacyCanvasContext: "旧版拼接内容",
    });

    expect(context).not.toContain("旧版拼接内容");
  });

  it("falls back to the legacy canvas context for old snapshots", () => {
    expect(formatAgentCanvasContext({ legacyCanvasContext: "旧上下文" })).toBe(
      "本轮明确选择的画布上下文：\n旧上下文",
    );
  });
});
