import type { Edge } from "@xyflow/react";

import { getReadingCoverUrl } from "@/components/zenme/canvas/files";
import { createReaderCanvasNode } from "@/components/zenme/canvas/node-factories";
import type { CanvasNode } from "@/components/zenme/canvas/types";
import type { ReadingAsset } from "@/lib/reading/types";

export function createOpenReadingWorkspaceUpdate(input: {
  actionNode: CanvasNode;
  edges: Edge[];
  nodes: CanvasNode[];
  preparedAsset?: ReadingAsset;
  readerNodeId: string;
}) {
  const readingAssetId =
    input.preparedAsset?.id ?? input.actionNode.data.readingAssetId;

  if (!readingAssetId) {
    return null;
  }

  let sourceNode = input.actionNode;
  let nextNodesBase = input.nodes;
  const nodeUpdates: Array<{
    after: CanvasNode;
    before: CanvasNode;
    id: string;
  }> = [];

  if (input.preparedAsset) {
    sourceNode = {
      ...input.actionNode,
      data: {
        ...input.actionNode.data,
        title: input.preparedAsset.title,
        readingAssetId: input.preparedAsset.id,
        coverUrl: getReadingCoverUrl(input.preparedAsset),
      },
    };
    nextNodesBase = input.nodes.map((node) =>
      node.id === input.actionNode.id ? sourceNode : node,
    );
    nodeUpdates.push({
      id: input.actionNode.id,
      before: input.actionNode,
      after: sourceNode,
    });
  }

  const { edge: nextEdge, node: nextNode } = createReaderCanvasNode({
    id: input.readerNodeId,
    readingAssetId,
    sourceNode,
  });

  return {
    createdEdges: [nextEdge],
    createdNodes: [nextNode],
    nextEdges: [...input.edges, nextEdge],
    nextNodes: [...nextNodesBase, nextNode],
    nodeUpdates,
  };
}
