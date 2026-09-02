import type { Edge } from "@xyflow/react";

import type { CanvasNode } from "./types";

export function collectAgentTurnReferences(input: {
  edges: Edge[];
  nodeId: string;
  nodes: CanvasNode[];
}) {
  const inboundByTarget = input.edges.reduce((result, edge) => {
    const sources = result.get(edge.target) ?? [];
    sources.push(edge.source);
    result.set(edge.target, sources);
    return result;
  }, new Map<string, string[]>());
  const reachableNodeIds = new Set<string>();
  const queue = [input.nodeId];

  while (queue.length > 0) {
    const nodeId = queue.shift();
    if (!nodeId || reachableNodeIds.has(nodeId)) continue;
    reachableNodeIds.add(nodeId);
    queue.push(...(inboundByTarget.get(nodeId) ?? []));
  }

  const referencedNodes = input.nodes.filter((node) =>
    reachableNodeIds.has(node.id) && node.data.nodeLifecycle !== "archived"
  );
  const fileDocumentIds = [...new Set(referencedNodes.flatMap((node) =>
    node.data.workspaceFileDocumentId
      ? [node.data.workspaceFileDocumentId]
      : [],
  ))];
  const readingAssetIds = [...new Set(referencedNodes.flatMap((node) =>
    node.data.readingAssetId ? [node.data.readingAssetId] : [],
  ))];

  return {
    fileDocumentIds,
    readingAssetIds,
    selectedNodeIds: referencedNodes.map((node) => node.id),
  };
}

export function createAgentContextFromActionNode(
  node: CanvasNode | undefined,
) {
  if (!node) {
    return undefined;
  }

  if (node.data.kind === "note") {
    return `阅读笔记：${node.data.title}\n来源：${node.data.sourceBookTitle ?? ""}\n原文：${node.data.selectedText ?? ""}\n备注：${node.data.comment ?? ""}`;
  }

  if (node.data.kind === "workspaceFile" && node.data.workspaceRelativePath) {
    return `Workspace 文件节点「${node.data.title}」\nRoot ID：${node.data.workspaceRootId ?? "主根（旧节点未记录 ID）"}\n相对路径：${node.data.workspaceRelativePath}`;
  }

  return `节点「${node.data.title}」（类型：${node.data.kind}）`;
}
