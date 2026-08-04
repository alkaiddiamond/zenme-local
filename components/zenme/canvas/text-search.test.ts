import { describe, expect, it } from "vitest";

import { searchCanvasNodes } from "@/components/zenme/canvas/text-search";
import type { CanvasNode } from "@/components/zenme/canvas/types";

function createNode(id: string, data: CanvasNode["data"]): CanvasNode {
  return { id, data, position: { x: 0, y: 0 }, type: data.kind };
}

describe("canvas text search", () => {
  const nodes = [
    createNode("text", {
      kind: "text",
      plainText: "雨后的山谷十分安静",
      title: "场景设定",
    }),
    createNode("agent", {
      aiPrompt: "分析叙事节奏",
      aiResponse: "主角在黄昏时回到村庄",
      kind: "agent",
      title: "分析结果",
    }),
    createNode("rich", {
      kind: "code",
      richTextHtml: "<p>Launch &amp; return</p>",
      title: "流程",
    }),
    createNode("lyrics", {
      kind: "lyrics",
      musicLyrics: [{ start: 0, text: "月光落在河面" }],
      title: "歌词",
    }),
  ];

  it("searches titles and visible node content", () => {
    expect(searchCanvasNodes(nodes, "场景").map((result) => result.id)).toEqual(["text"]);
    expect(searchCanvasNodes(nodes, "黄昏 村庄").map((result) => result.id)).toEqual(["agent"]);
    expect(searchCanvasNodes(nodes, "Launch & return").map((result) => result.id)).toEqual(["rich"]);
    expect(searchCanvasNodes(nodes, "月光").map((result) => result.id)).toEqual(["lyrics"]);
  });

  it("ignores case and empty queries", () => {
    expect(searchCanvasNodes(nodes, "launch")).toHaveLength(1);
    expect(searchCanvasNodes(nodes, "   ")).toEqual([]);
  });
});
