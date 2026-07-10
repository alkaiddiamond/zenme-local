import type { CanvasNode } from "./types";

export function createAgentContextFromActionNode(
  node: CanvasNode | undefined,
) {
  if (!node) {
    return undefined;
  }

  if (node.data.kind === "note") {
    return `阅读笔记：${node.data.title}\n来源：${node.data.sourceBookTitle ?? ""}\n原文：${node.data.selectedText ?? ""}\n备注：${node.data.comment ?? ""}`;
  }

  return `节点「${node.data.title}」（类型：${node.data.kind}）`;
}
