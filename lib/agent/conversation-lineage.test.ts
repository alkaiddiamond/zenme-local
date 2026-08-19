import { describe, expect, it } from "vitest";

import { resolveConversationLineage } from "@/lib/agent/conversation-lineage";

describe("resolveConversationLineage", () => {
  it("treats an unconnected node as a conversation root", () => {
    expect(resolveConversationLineage({ edges: [], nodeId: "B" })).toEqual({
      directParentNodeIds: [],
      ancestorNodeIds: [],
      isConversationRoot: true,
    });
  });

  it("collects connected ancestors from near to far", () => {
    expect(resolveConversationLineage({
      edges: [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
      ],
      nodeId: "C",
    })).toEqual({
      directParentNodeIds: ["B"],
      ancestorNodeIds: ["B", "A"],
      isConversationRoot: false,
    });
  });

  it("keeps multiple direct parents explicit without merging their transcripts", () => {
    expect(resolveConversationLineage({
      edges: [
        { source: "A", target: "C" },
        { source: "B", target: "C" },
      ],
      nodeId: "C",
    })).toEqual({
      directParentNodeIds: ["A", "B"],
      ancestorNodeIds: ["A", "B"],
      isConversationRoot: false,
    });
  });
});
