import { describe, expect, it } from "vitest";

import { buildContextualImageGenerationPrompt } from "./image-generation-context";
import { collectTextGenerationContext } from "./text-generation-context";

describe("buildContextualImageGenerationPrompt", () => {
  it("separates upstream context from the user's image instruction", () => {
    const context = collectTextGenerationContext({
      edges: [{ id: "agent-to-image", source: "agent", target: "image-request" }],
      nodeId: "image-request",
      nodes: [
        {
          id: "agent",
          position: { x: 0, y: 0 },
          data: {
            aiPrompt: "给我一个画面创意",
            aiResponse: "一只猫坐在向日葵花田里。",
            kind: "agent",
            title: "方案",
          },
        },
      ],
    });
    const result = buildContextualImageGenerationPrompt({
      context,
      prompt: "  以该内容生成一张 9:16 插画  ",
    });

    expect(result).toBe([
      "请根据以下上游画布内容理解用户指代，并执行图片生成任务。",
      "",
      "上游画布内容：",
      "上游上下文 L1\nAI 回复节点「方案」\n提问：\n给我一个画面创意\n回答：\n一只猫坐在向日葵花田里。",
      "",
      "用户图片生成指令：",
      "以该内容生成一张 9:16 插画",
    ].join("\n"));
  });

  it("keeps a standalone image prompt unchanged when there is no text context", () => {
    expect(buildContextualImageGenerationPrompt({
      context: "  ",
      prompt: "  一只晒太阳的猫  ",
    })).toBe("一只晒太阳的猫");
  });

  it("collects only selected direct text references when a selection is provided", () => {
    const context = collectTextGenerationContext({
      edges: [
        { id: "a-to-image", source: "text-a", target: "image-request" },
        { id: "b-to-image", source: "text-b", target: "image-request" },
      ],
      nodeId: "image-request",
      nodes: [
        {
          id: "text-a",
          position: { x: 0, y: 0 },
          data: { kind: "text", plainText: "不要使用", title: "提示 A" },
        },
        {
          id: "text-b",
          position: { x: 0, y: 0 },
          data: { kind: "text", plainText: "秋日柔光", title: "提示 B" },
        },
      ],
      sourceNodeIds: ["text-b"],
    });

    expect(context).toContain("提示 B");
    expect(context).toContain("秋日柔光");
    expect(context).not.toContain("提示 A");
    expect(context).not.toContain("不要使用");
  });
});
