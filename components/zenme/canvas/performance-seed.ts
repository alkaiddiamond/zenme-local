import type { Edge } from "@xyflow/react";

import { NODE_RIGHT_HANDLE_ID } from "@/components/zenme/node-types";

import { createTextCanvasNode } from "./node-factories";
import type { CanvasNode } from "./types";

type PerformanceSeedInput = {
  count: number;
  edgesPerRow?: number;
};

export function createPerformanceSeedCanvas({
  count,
  edgesPerRow = 1,
}: PerformanceSeedInput) {
  const safeCount = Math.min(Math.max(Math.floor(count), 1), 500);
  const columns = Math.ceil(Math.sqrt(safeCount));
  const horizontalGap = 620;
  const verticalGap = 360;
  const nodes: CanvasNode[] = Array.from({ length: safeCount }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return createTextCanvasNode({
      id: `perf-text-${index + 1}`,
      plainText: createPerformanceSeedText(index),
      position: {
        x: column * horizontalGap,
        y: row * verticalGap,
      },
      richTextHtml: `<p>${createPerformanceSeedText(index)}</p>`,
      title: `性能节点 ${index + 1}`,
    });
  });
  const edges: Edge[] = [];

  for (let index = 0; index < safeCount - 1; index += 1) {
    if (index % columns >= Math.max(edgesPerRow, 1)) {
      continue;
    }

    edges.push({
      id: `perf-edge-${index + 1}-${index + 2}`,
      source: nodes[index].id,
      sourceHandle: NODE_RIGHT_HANDLE_ID,
      target: nodes[index + 1].id,
      type: "default",
    });
  }

  return { edges, nodes };
}

function createPerformanceSeedText(index: number) {
  return `用于大画布性能验证的文本内容 ${index + 1}。这里包含足够的中文文本，用于模拟真实文本节点的渲染、保存和历史记录压力。`;
}
