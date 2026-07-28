import { describe, expect, it } from "vitest";

import { inspectCanvasNodeExecution } from "@/components/zenme/canvas/execution-preflight";
import type { CanvasNode } from "@/components/zenme/canvas/types";

function createNode(data: CanvasNode["data"]): CanvasNode {
  return { id: "node-1", type: data.kind, position: { x: 0, y: 0 }, data };
}

describe("execution preflight", () => {
  it("rejects missing provider models before a request is submitted", () => {
    const result = inspectCanvasNodeExecution({
      availableModelIds: [],
      node: createNode({
        kind: "videoGeneration",
        title: "视频生成",
        videoPrompt: "让画面动起来",
        videoModel: "provider/video-model",
      }),
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "model_unavailable" }));
  });

  it("returns normalized execution input when preflight succeeds", () => {
    const result = inspectCanvasNodeExecution({
      availableModelIds: ["provider/image-model"],
      node: createNode({
        kind: "imageGeneration",
        title: "图片生成",
        imagePrompt: "一只企鹅",
        imageModel: "provider/image-model",
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      kind: "image",
      model: "provider/image-model",
      prompt: "一只企鹅",
      issues: [],
    });
  });

  it("does not treat non-executable result nodes as requests", () => {
    const result = inspectCanvasNodeExecution({
      availableModelIds: [],
      node: createNode({ kind: "video", title: "视频结果" }),
    });
    expect(result.issues[0]?.code).toBe("node_not_executable");
  });
});
