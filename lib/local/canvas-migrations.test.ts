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
      version: 3,
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

  it("leaves current snapshots without player jobs untouched", () => {
    const snapshot = {
      version: 3,
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

  it("normalizes legacy task metadata and fills the new defaults", () => {
    const result = migrateCanvasSnapshot({
      version: 3,
      nodes: [
        {
          id: "legacy-task",
          type: "task",
          position: { x: 0, y: 0 },
          data: {
            kind: "task",
            taskStatus: "archived",
            taskUrgency: "urgent",
          },
        },
        {
          id: "empty-task",
          type: "task",
          position: { x: 100, y: 0 },
          data: { kind: "task" },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: "2026-07-17T00:00:00.000Z",
    });

    expect(result?.migrated).toBe(true);
    expect(result?.snapshot.nodes).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          taskComplexity: "simple",
          taskPriority: "P3",
          taskStatus: "paused",
          taskUrgency: "run",
        }),
      }),
      expect.objectContaining({
        data: expect.objectContaining({
          taskComplexity: "simple",
          taskPriority: "P3",
          taskStatus: "inProgress",
          taskUrgency: "stand",
        }),
      }),
    ]);
  });

  it("moves legacy analysis state from a player into an analysis node", () => {
    const result = migrateCanvasSnapshot({
      version: 3,
      nodes: [{
        id: "player-1",
        type: "musicPlayer",
        position: { x: 100, y: 200 },
        data: {
          kind: "musicPlayer",
          title: "Song · 播放器",
          musicDuration: 120,
          musicJobId: "job-1",
          musicJobStatus: "running",
        },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: "2026-07-13T00:00:00.000Z",
    });
    expect(result?.migrated).toBe(true);
    expect(result?.snapshot.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "player-1", data: expect.not.objectContaining({ musicJobId: "job-1" }) }),
      expect.objectContaining({
        type: "musicAnalysis",
        data: expect.objectContaining({ musicJobId: "job-1", musicParentPlayerNodeId: "player-1" }),
      }),
    ]));
  });

  it("migrates music analysis state and child nodes under a player", () => {
    const result = migrateCanvasSnapshot({
      version: 2,
      nodes: [
        { id: "music-1", type: "music", position: { x: 10, y: 20 }, data: { kind: "music", title: "Song", musicJobId: "job-1", musicJobStatus: "succeeded" } },
        { id: "analysis-1", type: "musicAnalysis", position: { x: 700, y: 20 }, data: { kind: "musicAnalysis", title: "分析" } },
      ],
      edges: [{ id: "old-edge", source: "music-1", target: "analysis-1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: "2026-07-13T00:00:00.000Z",
    });
    expect(result?.snapshot.version).toBe(3);
    expect(result?.snapshot.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "music-player:music-1", data: expect.objectContaining({ kind: "musicPlayer" }) }),
      expect.objectContaining({ id: "analysis-1", data: expect.objectContaining({ musicJobId: "job-1", musicParentPlayerNodeId: "music-player:music-1" }) }),
    ]));
    expect(result?.snapshot.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "music-1", target: "music-player:music-1" }),
      expect.objectContaining({ source: "music-player:music-1", target: "analysis-1" }),
    ]));
  });
});
