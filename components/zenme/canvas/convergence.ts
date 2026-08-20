import type { CanvasNodeData } from "@/components/zenme/node-types";
import type { CanvasNode } from "@/components/zenme/canvas/types";

export function applyCanvasNodeLifecycle(nodes: CanvasNode[], nodeId: string, lifecycle: NonNullable<CanvasNodeData["nodeLifecycle"]>) {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    const currentLifecycle = node.data.nodeLifecycle ?? "working";
    return {
      ...node,
      selected: lifecycle === "archived" ? false : node.selected,
      data: {
        ...node.data,
        nodeLifecycle: lifecycle,
        nodeLifecycleBeforeArchive: lifecycle === "archived" && currentLifecycle !== "archived" ? currentLifecycle : node.data.nodeLifecycleBeforeArchive,
      },
    };
  });
}

export function applyAgentDetailsFold(nodes: CanvasNode[], nodeId: string, folded: boolean) {
  return nodes.map((node) => {
    if (node.id !== nodeId || (node.data.kind !== "agentExecution" && node.data.kind !== "globalAgent")) return node;
    const defaultHeight = node.data.kind === "globalAgent" ? 520 : 440;
    const currentHeight = typeof node.style?.height === "number" ? node.style.height : defaultHeight;
    const expandedHeight = folded ? currentHeight : node.data.agentExpandedHeight ?? defaultHeight;
    return { ...node, style: { ...node.style, height: folded ? 168 : expandedHeight }, data: { ...node.data, agentDetailsFolded: folded, agentExpandedHeight: folded ? currentHeight : node.data.agentExpandedHeight } };
  });
}
