import { describe, expect, it } from "vitest";

import {
  resolveConversationLineage,
  resolveConversationRoute,
  resolveInheritedConversation,
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
      turnIdByNodeId: new Map([["A", "turn-a"]]),
      createConversationId: () => "conv-b",
    })).toEqual({
      conversationId: "conv-b",
      parentTurnId: "turn-a",
      parentConversationIds: ["conv-a"],
      forked: true,
    });
  });

  it("keeps later nodes on the forked branch in the same conversation", () => {
    const events = [
      { id: "e1", sequence: 1, turnId: "turn-a", conversationId: "conv-a", type: "user" as const, createdAt: "now" },
      {
        id: "e2",
        sequence: 2,
        turnId: "turn-b",
        conversationId: "conv-b",
        parentTurnId: "turn-a",
        type: "user" as const,
        createdAt: "now",
        data: { parentConversationIds: ["conv-a"] },
      },
    ];
    expect(resolveConversationRoute({
      edges: [
        { source: "A", target: "B" },
        { source: "A", target: "X" },
        { source: "B", target: "C" },
        { source: "C", target: "D" },
      ],
      events,
      nodeId: "D",
      turnIdByNodeId: new Map([
        ["A", "turn-a"],
        ["B", "turn-b"],
      ]),
      createConversationId: () => "must-not-fork",
    })).toEqual({
      conversationId: "conv-b",
      parentTurnId: "turn-b",
      parentConversationIds: ["conv-b"],
      forked: false,
    });
  });

  it("forks a second child from the current conversation anchor", () => {
    const events = [
      { id: "e1", sequence: 1, turnId: "turn-b", conversationId: "conv-b", type: "user" as const, createdAt: "now" },
    ];
    expect(resolveConversationRoute({
      edges: [{ source: "B", target: "existing-child" }],
      events,
      nodeId: "B",
      turnIdByNodeId: new Map([["B", "turn-b"]]),
      createConversationId: () => "conv-c",
    })).toEqual({
      conversationId: "conv-c",
      parentTurnId: "turn-b",
      parentConversationIds: ["conv-b"],
      forked: true,
    });
  });

  it("treats only nearest conversations on direct incoming paths as merge parents", () => {
    const events = [
      { id: "e1", sequence: 1, turnId: "turn-a", conversationId: "conv-a", type: "user" as const, createdAt: "now" },
      { id: "e2", sequence: 2, turnId: "turn-b", conversationId: "conv-b", type: "user" as const, createdAt: "now" },
      { id: "e3", sequence: 3, turnId: "turn-x", conversationId: "conv-x", type: "user" as const, createdAt: "now" },
    ];
    expect(resolveConversationRoute({
      edges: [
        { source: "A", target: "B" },
        { source: "B", target: "C" },
        { source: "X", target: "C" },
      ],
      events,
      nodeId: "C",
      turnIdByNodeId: new Map([
        ["A", "turn-a"],
        ["B", "turn-b"],
        ["X", "turn-x"],
      ]),
      createConversationId: () => "conv-c",
    })).toEqual({
      conversationId: "conv-c",
      parentTurnId: "turn-b",
      parentConversationIds: ["conv-b", "conv-x"],
      forked: true,
    });
  });
});
