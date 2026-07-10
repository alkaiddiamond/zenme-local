import { describe, expect, it } from "vitest";

import {
  createCodeNodeDataUpdate,
  createTextGenerationNodeDataUpdate,
  createTextNodeDataUpdate,
} from "./node-updates";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
  type?: string;
}): CanvasNode {
  return {
    id: input.id,
    position: { x: 0, y: 0 },
    type: input.type ?? "text",
    data: {
      kind: "text",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

describe("canvas node data update helpers", () => {
  it("updates text and markdown nodes while preserving history snapshots", () => {
    const text = node({
      data: { kind: "text", plainText: "old", richTextHtml: "<p>old</p>" },
      id: "text",
    });

    const update = createTextNodeDataUpdate({
      nodeId: "text",
      nodes: [text],
      updates: { plainText: "new", richTextHtml: "<p>new</p>" },
    });

    expect(update?.nextNodes[0].data).toMatchObject({
      plainText: "new",
      richTextHtml: "<p>new</p>",
    });
    expect(update?.beforeNodeSnapshots.get("text")?.data).toMatchObject({
      plainText: "old",
      richTextHtml: "<p>old</p>",
    });
  });

  it("returns null for unchanged text updates and updates legacy code nodes", () => {
    const code = node({
      data: { codeContent: "print(1)", kind: "code" },
      id: "code",
      type: "code",
    });
    const text = node({ data: { kind: "text", plainText: "same" }, id: "text" });

    expect(
      createTextNodeDataUpdate({
        nodeId: "text",
        nodes: [text],
        updates: { plainText: "same" },
      }),
    ).toBeNull();
    expect(
      createTextNodeDataUpdate({
        nodeId: "code",
        nodes: [code],
        updates: { plainText: "new" },
      })?.nextNodes[0].data,
    ).toMatchObject({
      codeContent: "print(1)",
      kind: "code",
      plainText: "new",
    });
  });

  it("updates code nodes", () => {
    const code = node({
      data: { codeContent: "print(1)", codeLanguage: "python", kind: "code" },
      id: "code",
      type: "code",
    });

    expect(
      createCodeNodeDataUpdate({
        nodeId: "code",
        nodes: [code],
        updates: { codeContent: "console.log(1)", codeLanguage: "javascript" },
      })?.nextNodes[0].data,
    ).toMatchObject({
      codeContent: "console.log(1)",
      codeLanguage: "javascript",
    });
  });

  it("updates text generation nodes", () => {
    const textGeneration = node({
      data: {
        kind: "textGeneration",
        textGenerationModel: "glm-4.5",
        textGenerationPrompt: "old",
      },
      id: "generator",
      type: "textGeneration",
    });

    expect(
      createTextGenerationNodeDataUpdate({
        nodeId: "generator",
        nodes: [textGeneration],
        updates: { textGenerationPrompt: "new" },
      })?.nextNodes[0].data,
    ).toMatchObject({
      textGenerationModel: "glm-4.5",
      textGenerationPrompt: "new",
    });
  });

  it("updates text generation composer state on merged text-like nodes", () => {
    const text = node({
      data: {
        kind: "text",
        plainText: "正文",
        textGenerationModel: "glm-4.5",
        textGenerationPrompt: "old prompt",
      },
      id: "text",
      type: "text",
    });
    const note = node({
      data: {
        comment: "笔记",
        kind: "note",
        textGenerationModel: "glm-4.5",
      },
      id: "note",
      type: "note",
    });

    expect(
      createTextGenerationNodeDataUpdate({
        nodeId: "text",
        nodes: [text],
        updates: {
          textGenerationModel: "glm-5.2",
          textGenerationPrompt: "next prompt",
        },
      })?.nextNodes[0].data,
    ).toMatchObject({
      plainText: "正文",
      textGenerationModel: "glm-5.2",
      textGenerationPrompt: "next prompt",
    });

    expect(
      createTextGenerationNodeDataUpdate({
        nodeId: "note",
        nodes: [note],
        updates: {
          textGenerationModel: "glm-5.2",
          textGenerationPrompt: "基于笔记继续",
        },
      })?.nextNodes[0].data,
    ).toMatchObject({
      comment: "笔记",
      textGenerationModel: "glm-5.2",
      textGenerationPrompt: "基于笔记继续",
    });
  });
});
