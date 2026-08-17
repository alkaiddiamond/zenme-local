import { describe, expect, it } from "vitest";

import { applyAgentDetailsFold, applyCanvasNodeLifecycle } from "@/components/zenme/canvas/convergence";
import type { CanvasNode } from "@/components/zenme/canvas/types";

const node: CanvasNode = { id: "result", type: "globalAgent", position: { x: 0, y: 0 }, style: { height: 520, width: 680 }, data: { kind: "globalAgent", title: "Result", nodeLifecycle: "knowledge", globalOrchestrationId: "orchestration-1" } };

describe("canvas convergence", () => {
  it("archives by lifecycle without deleting the persistent node reference and restores its prior role", () => {
    const archived = applyCanvasNodeLifecycle([node], node.id, "archived");
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ id: "result", data: { globalOrchestrationId: "orchestration-1", nodeLifecycle: "archived", nodeLifecycleBeforeArchive: "knowledge" } });
    const restored = applyCanvasNodeLifecycle(archived, node.id, archived[0].data.nodeLifecycleBeforeArchive!);
    expect(restored[0].data.nodeLifecycle).toBe("knowledge");
  });

  it("folds execution presentation without changing the underlying domain reference", () => {
    const folded = applyAgentDetailsFold([node], node.id, true);
    expect(folded[0]).toMatchObject({ style: { height: 168 }, data: { agentDetailsFolded: true, agentExpandedHeight: 520, globalOrchestrationId: "orchestration-1" } });
    const expanded = applyAgentDetailsFold(folded, node.id, false);
    expect(expanded[0].style?.height).toBe(520);
  });
});
