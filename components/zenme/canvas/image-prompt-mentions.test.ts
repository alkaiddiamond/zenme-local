import { describe, expect, it } from "vitest";

import {
  expandImagePromptMentions,
  mergeReferenceNodeIds,
  normalizeImagePromptContent,
} from "./image-prompt-mentions";

describe("image prompt mentions", () => {
  it("keeps inline references on the same line as their leading text", () => {
    expect(normalizeImagePromptContent(
      "基于\n风格色调生成图片",
      [{ nodeId: "image-1", offset: 3 }],
    )).toEqual({
      mentions: [{ nodeId: "image-1", offset: 2 }],
      prompt: "基于风格色调生成图片",
    });
  });

  it("expands image and text chips into explicit request placeholders", () => {
    expect(expandImagePromptMentions({
      imageReferenceNodeIds: ["image-1"],
      mentions: [
        { nodeId: "image-1", offset: 3 },
        { nodeId: "text-1", offset: 13 },
      ],
      prompt: "基于\n风格色调和对应的 以 作为参考生成图片",
      references: [
        { kind: "image", nodeId: "image-1", title: "图片生成" },
        { kind: "text", nodeId: "text-1", title: "文本" },
      ],
    })).toBe(
      "基于【参考图片1：图片生成】风格色调和对应的 以【引用文本：文本】作为参考生成图片",
    );
  });

  it("combines explicitly selected references with prompt mentions", () => {
    expect(mergeReferenceNodeIds(
      ["image-1"],
      [
        { nodeId: "text-1", offset: 0 },
        { nodeId: "unrelated", offset: 0 },
      ],
      [{ nodeId: "text-1" }],
    )).toEqual(["image-1", "text-1"]);
  });

  it("shows every connected candidate by default until selection is customized", () => {
    expect(mergeReferenceNodeIds(
      undefined,
      [],
      [{ nodeId: "image-1" }, { nodeId: "image-2" }],
    )).toEqual(["image-1", "image-2"]);
  });
});
