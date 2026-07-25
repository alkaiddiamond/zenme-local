import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  consumeHomePromptRequest,
  createHomePromptCanvas,
  rememberHomePromptRequest,
} from "./home-prompt";

describe("home prompt project bootstrap", () => {
  it("creates a text node containing the submitted prompt", () => {
    const snapshot = createHomePromptCanvas({
      model: "provider/model",
      nodeId: "prompt-node",
      prompt: "  帮我整理这段想法  ",
      updatedAt: "2026-07-25T00:00:00.000Z",
    });

    expect(snapshot).toMatchObject({
      version: 3,
      nodes: [
        {
          id: "prompt-node",
          type: "text",
          data: {
            createdAt: "2026-07-25T00:00:00.000Z",
            kind: "text",
            plainText: "帮我整理这段想法",
            textGenerationModel: "provider/model",
            textGenerationPrompt: "帮我整理这段想法",
          },
        },
      ],
      edges: [],
    });
  });

  it("consumes the automatic request exactly once", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => values.delete(key)),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    };
    const request = {
      model: "provider/model",
      nodeId: "prompt-node",
      prompt: "继续生成",
    };

    rememberHomePromptRequest("project-1", request, storage);
    expect(consumeHomePromptRequest("project-1", storage)).toEqual(request);
    expect(consumeHomePromptRequest("project-1", storage)).toBeNull();
  });

  it("wires the consumed request into the existing canvas generation path", () => {
    const source = readFileSync(
      new URL("../canvas-client.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("consumeHomePromptRequest(projectId)");
    expect(source).toContain("submitTextGenerationNode(request.nodeId");
  });
});
