import type { Edge } from "@xyflow/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ReadingAsset } from "@/lib/reading/types";

import { createOpenReadingWorkspaceUpdate } from "./reading-workspace-update";
import type { CanvasNode } from "./types";

function node(input: {
  data?: Partial<CanvasNode["data"]>;
  id: string;
  position?: { x: number; y: number };
  type?: string;
}): CanvasNode {
  return {
    id: input.id,
    position: input.position ?? { x: 0, y: 0 },
    type: input.type ?? "book",
    data: {
      kind: "book",
      title: input.id,
      ...input.data,
    },
  } as CanvasNode;
}

const asset: ReadingAsset = {
  id: "asset-1",
  ownerId: "user-1",
  projectId: "project-1",
  nodeId: "book-1",
  title: "地师",
  format: "epub",
  fileName: "地师.epub",
  filePath: "user/project/reading/original/asset.epub",
  coverPath: "user/project/reading/covers/asset.webp",
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T02:00:00.000Z",
};

describe("open reading workspace update", () => {
  it("focuses a created reader without changing the current canvas zoom", () => {
    const canvasClientSource = readFileSync(
      new URL("../canvas-client.tsx", import.meta.url),
      "utf8",
    );
    const openReaderSource = canvasClientSource.slice(
      canvasClientSource.indexOf("async function openReadingWorkspace"),
      canvasClientSource.indexOf("function createConnectedPlaceholder"),
    );

    expect(openReaderSource).toContain(
      "createPreservedZoomNodeFocusOptions",
    );
    expect(openReaderSource).toContain("flow.getViewport().zoom");
    expect(openReaderSource).not.toContain(
      "fitView({ duration: 220, padding: 0.16 })",
    );
  });

  it("returns null when the node has no reading asset", () => {
    expect(
      createOpenReadingWorkspaceUpdate({
        actionNode: node({ id: "book-1" }),
        edges: [],
        nodes: [node({ id: "book-1" })],
        readerNodeId: "reader-1",
      }),
    ).toBeNull();
  });

  it("creates a reader node from an existing reading asset id", () => {
    const book = node({
      data: { readingAssetId: "asset-existing", title: "旧书" },
      id: "book-1",
      position: { x: 100, y: 200 },
    });
    const update = createOpenReadingWorkspaceUpdate({
      actionNode: book,
      edges: [],
      nodes: [book],
      readerNodeId: "reader-1",
    });

    expect(update?.nextNodes.map((item) => item.id)).toEqual([
      "book-1",
      "reader-1",
    ]);
    expect(update?.createdNodes[0]).toMatchObject({
      data: { kind: "reader", readingAssetId: "asset-existing", title: "阅读：旧书" },
      position: { x: 468, y: 200 },
    });
    expect(update?.nodeUpdates).toEqual([]);
  });

  it("updates the source book node when a reading asset was just prepared", () => {
    const book = node({
      data: { fileName: "地师.epub", originalUrl: "https://example.com/book.epub" },
      id: "book-1",
      position: { x: 100, y: 200 },
    });
    const existingEdge: Edge = { id: "old-edge", source: "a", target: "b" };

    const update = createOpenReadingWorkspaceUpdate({
      actionNode: book,
      edges: [existingEdge],
      nodes: [book],
      preparedAsset: asset,
      readerNodeId: "reader-1",
    });

    expect(update?.nextEdges).toHaveLength(2);
    const updatedBook = update?.nextNodes.find((item) => item.id === "book-1");
    expect(updatedBook).toMatchObject({
      data: {
        readingAssetId: "asset-1",
        title: "地师",
      },
    });
    expect(updatedBook?.data.coverUrl).toContain(
      "/api/reading/assets/asset-1/cover",
    );
    expect(update?.createdNodes[0]).toMatchObject({
      data: { kind: "reader", readingAssetId: "asset-1", title: "阅读：地师" },
    });
    expect(update?.nodeUpdates).toHaveLength(1);
    expect(update?.nodeUpdates[0]).toMatchObject({
      id: "book-1",
      before: book,
    });
  });
});
