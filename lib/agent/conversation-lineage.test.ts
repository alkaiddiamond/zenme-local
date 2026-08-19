import { describe, expect, it } from "vitest";

import {
  resolveConversationLineage,
  resolveConversationRoute,
  resolveInheritedConversation,
  shouldForkConversation,
} from "@/lib/agent/conversation-lineage";

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

  it("inherits a single connected conversation but refuses to merge multiple conversations", () => {
    const events = [
      { id: "e1", sequence: 1, turnId: "turn-a", conversationId: "conv-a", type: "user" as const, createdAt: "now" },
      { id: "e2", sequence: 2, turnId: "turn-b", conversationId: "conv-b", type: "user" as const, createdAt: "now" },
    ];
    expect(resolveInheritedConversation({ events, turnIds: ["turn-a"] })).toEqual({
      conversationId: "conv-a",
      parentTurnId: "turn-a",
      parentConversationIds: ["conv-a"],
    });
    expect(resolveInheritedConversation({ events, turnIds: ["turn-a", "turn-b"] })).toEqual({
      conversationId: undefined,
      parentTurnId: "turn-a",
      parentConversationIds: ["conv-a", "conv-b"],
    });
  });

  it("keeps a linear path in the same conversation", () => {
    expect(shouldForkConversation({
      edges: [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
      ],
      nodeId: "C",
    })).toBe(false);
  });

  it("forks when the current path crosses a graph branch", () => {
    expect(shouldForkConversation({
      edges: [
        { source: "A", target: "B" },
        { source: "A", target: "D" },
        { source: "B", target: "C" },
      ],
      nodeId: "C",
    })).toBe(true);
  });

  it("forks a second child run from the same source node", () => {
    expect(shouldForkConversation({
      edges: [{ source: "source", target: "existing-child" }],
      nodeId: "source",
    })).toBe(true);
  });

  it("creates a new conversation for a fork while retaining the parent conversation", () => {
    const events = [
      { id: "e1", sequence: 1, turnId: "turn-a", conversationId: "conv-a", type: "user" as const, createdAt: "now" },
    ];
    expect(resolveConversationRoute({
      edges: [
        { source: "A", target: "B" },
        { source: "A", target: "D" },
      ],
      events,
      nodeId: "B",
      turnIds: ["turn-a"],
      createConversationId: () => "conv-b",
    })).toEqual({
      conversationId: "conv-b",
      parentTurnId: "turn-a",
      parentConversationIds: ["conv-a"],
      forked: true,
    });
  });
});
