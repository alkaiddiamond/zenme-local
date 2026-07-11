import { describe, expect, it } from "vitest";

import { migrateCanvasSnapshot } from "./canvas-migrations";

describe("migrateCanvasSnapshot", () => {
  it("migrates legacy image edit nodes into referenced image generation nodes", () => {
    const result = migrateCanvasSnapshot({
      version: 1,
      nodes: [
        {
          id: "source",
          type: "image",
          data: { kind: "image", title: "参考图" },
          position: { x: 0, y: 0 },
        },
        {
          id: "legacy",
          type: "imageEdit",
          data: {
            kind: "imageEdit",
            imageEditModel: "legacy-model",
            imageEditPrompt: "调整图片",
            sourceImageTitle: "参考图",
            sourceImageUrl: "/source.png",
            title: "图片编辑",
          },
          position: { x: 600, y: 0 },
          style: { height: 520, width: 420 },
        },
      ],
      edges: [{ id: "edge", source: "source", target: "legacy" }],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: "2026-07-12T00:00:00.000Z",
    });

    expect(result?.migrated).toBe(true);
    expect(result?.snapshot).toMatchObject({
      version: 2,
      nodes: [
        { id: "source", type: "image" },
        {
          id: "legacy",
          type: "imageGeneration",
          height: 260,
          width: 520,
          data: {
            imageOperation: "generate",
            imageModel: "legacy-model",
            imagePrompt: "调整图片",
            imageReferenceNodeIds: ["source"],
            kind: "imageGeneration",
            title: "图片生成",
          },
          style: { height: 260, width: 520 },
        },
      ],
    });
    expect(result?.snapshot.nodes[1]).not.toHaveProperty("data.sourceImageUrl");
    expect(result?.snapshot.nodes[1]).not.toHaveProperty("data.sourceImageTitle");
    expect(result?.snapshot.nodes[1]).not.toHaveProperty("data.imageEditModel");
    expect(result?.snapshot.nodes[1]).not.toHaveProperty("data.imageEditPrompt");
  });

  it("leaves current snapshots untouched", () => {
    const snapshot = {
      version: 2,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: "2026-07-12T00:00:00.000Z",
    } as const;
    expect(migrateCanvasSnapshot(snapshot)).toEqual({
      migrated: false,
      snapshot,
    });
  });
});
