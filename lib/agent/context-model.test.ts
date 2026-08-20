import { describe, expect, it } from "vitest";

import {
  applyAgentContextSnapshot,
  createAgentContextLayers,
  createAgentContextSnapshot,
  parseAgentContextSnapshot,
} from "@/lib/agent/context-model";

describe("agent context snapshot", () => {
  it("builds the five runtime context layers explicitly", () => {
    const layers = createAgentContextLayers({
      projectSummary: "project background",
      conversationSummary: "conversation summary",
      conversationEvents: [{
        id: "event-1",
        sequence: 1,
        turnId: "turn-1",
        type: "user",
        createdAt: "now",
        content: "current request",
      }],
      currentNodeContext: "current node",
      connectedGraphContext: "connected graph",
      prompt: "current instruction",
    });

    expect(layers).toMatchObject({
      project: { summary: "project background" },
      conversation: { summary: "conversation summary", events: [{ turnId: "turn-1" }] },
      graph: { connectedContext: "connected graph" },
      currentNode: { content: "current node" },
      instruction: { prompt: "current instruction" },
    });
  });

  it("prefers the structured snapshot while keeping legacy fields as fallback", () => {
    const snapshot = createAgentContextSnapshot({
      prompt: "structured prompt",
      currentNodeContext: "structured node",
      connectedGraphContext: "structured graph",
      conversationId: "conv-a",
      selectedNodeIds: ["node-a"],
      fileDocumentIds: ["file-a"],
    });

    expect(applyAgentContextSnapshot({
      prompt: "legacy prompt",
      currentNodeContext: "legacy node",
      connectedGraphContext: "legacy graph",
      conversationId: "legacy-conversation",
      selectedNodeIds: ["legacy-node"],
      fileDocumentIds: ["legacy-file"],
      canvasContext: "legacy context",
      contextSnapshot: snapshot,
    })).toMatchObject({
      prompt: "structured prompt",
      currentNodeContext: "structured node",
      connectedGraphContext: "structured graph",
      conversationId: "conv-a",
      selectedNodeIds: ["node-a"],
      fileDocumentIds: ["file-a"],
      canvasContext: "legacy context",
    });
  });

  it("parses only the supported version and known serializable fields", () => {
    expect(parseAgentContextSnapshot({
      version: 1,
      instruction: { prompt: "answer current node" },
      currentNode: { content: "current node" },
      graph: { connectedContext: "graph" },
      conversation: { conversationId: "conv-a" },
      references: { selectedNodeIds: ["a", 1], fileDocumentIds: ["f"] },
      legacy: { canvasContext: "legacy" },
      unknown: "ignored",
    })).toEqual({
      version: 1,
      instruction: { prompt: "answer current node" },
      currentNode: { content: "current node" },
      graph: { connectedContext: "graph" },
      conversation: { conversationId: "conv-a" },
      references: { selectedNodeIds: ["a"], fileDocumentIds: ["f"] },
      legacy: { canvasContext: "legacy" },
    });
    expect(parseAgentContextSnapshot({ version: 2, instruction: { prompt: "x" } })).toBeUndefined();
    expect(parseAgentContextSnapshot({ version: 1, instruction: {} })).toBeUndefined();
  });

  it("does not disturb legacy callers that have no structured snapshot", () => {
    const legacy = {
      prompt: "legacy prompt",
      currentNodeContext: "legacy node",
      conversationId: "legacy-conversation",
    };
    expect(applyAgentContextSnapshot(legacy)).toBe(legacy);
  });
});
