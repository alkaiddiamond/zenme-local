import type { Edge } from "@xyflow/react";

import { NODE_RIGHT_HANDLE_ID } from "@/components/zenme/node-types";

import {
  createTaskCanvasNode,
  createTextCanvasNode,
} from "./node-factories";
import type { CanvasNode } from "./types";

type PerformanceSeedInput = {
  count: number;
  edgeCount?: number;
  edgesPerRow?: number;
  kind?: "mixed" | "task" | "text";
};

export function createPerformanceSeedCanvas({
  count,
  edgeCount,
  edgesPerRow = 1,
  kind = "text",
}: PerformanceSeedInput) {
  const safeCount = Math.min(Math.max(Math.floor(count), 1), 1_000);
  const columns = Math.ceil(Math.sqrt(safeCount));
  const horizontalGap = 620;
  const verticalGap = 360;
  const nodes: CanvasNode[] = Array.from({ length: safeCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const position = {
      x: column * horizontalGap,
      y: row * verticalGap,
    };
    if (kind === "task" || (kind === "mixed" && index % 3 === 1)) {
      return createTaskCanvasNode({
        id: `perf-task-${index + 1}`,
        name: `性能任务 ${index + 1}`,
        position,
        tags: index % 4 === 0 ? ["性能", "大画布"] : ["性能"],
      });
    }

    if (kind === "mixed" && index % 3 === 2) {
      return {
        id: `perf-image-${index + 1}`,
        type: "image",
        position,
        style: { height: 260, width: 420 },
        data: {
          imageGenerated: true,
          kind: "image",
          title: `性能图片 ${index + 1}`,
        },
      } satisfies CanvasNode;
    }

    const text = createPerformanceSeedText(index);
    return createTextCanvasNode({
      id: `perf-text-${index + 1}`,
      plainText: text,
      position,
      richTextHtml: `<p>${text}</p>`,
      title: `性能节点 ${index + 1}`,
    });
  });
  const edges: Edge[] = [];

  if (edgeCount !== undefined) {
    const safeEdgeCount = Math.min(
      Math.max(Math.floor(edgeCount), 0),
      Math.min(2_000, safeCount * Math.max(safeCount - 1, 0)),
    );
    for (let index = 0; index < safeEdgeCount; index += 1) {
      const sourceIndex = index % safeCount;
      const targetOffset = Math.floor(index / safeCount) + 1;
      const targetIndex = (sourceIndex + targetOffset) % safeCount;
      if (sourceIndex === targetIndex) continue;
      edges.push(createPerformanceSeedEdge(
        nodes[sourceIndex],
        nodes[targetIndex],
        index,
      ));
    }
    return { edges, nodes };
  }

  for (let index = 0; index < safeCount - 1; index += 1) {
    if (index % columns >= Math.max(edgesPerRow, 1)) {
      continue;
    }

    edges.push(createPerformanceSeedEdge(nodes[index], nodes[index + 1], index));
  }

  return { edges, nodes };
}

function createPerformanceSeedEdge(
  source: CanvasNode,
  target: CanvasNode,
  index: number,
): Edge {
  return {
    id: `perf-edge-${index + 1}-${source.id}-${target.id}`,
    source: source.id,
    sourceHandle: NODE_RIGHT_HANDLE_ID,
    target: target.id,
    type: "default",
  };
}

function createPerformanceSeedText(index: number) {
  return `用于大画布性能验证的文本内容 ${index + 1}。这里包含足够的中文文本，用于模拟真实文本节点的渲染、保存和历史记录压力。`;
}
