import { createTextCanvasNode } from "@/components/zenme/canvas/node-factories";
import type { CanvasSnapshot } from "@/components/zenme/canvas/types";

const HOME_PROMPT_REQUEST_PREFIX = "zenme.home-prompt-request.v1.";

export type HomePromptRequest = {
  model: string;
  nodeId: string;
  prompt: string;
};

export function createHomePromptCanvas(input: {
  model: string;
  nodeId: string;
  prompt: string;
  updatedAt?: string;
}): CanvasSnapshot {
  const prompt = input.prompt.trim();
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const node = createTextCanvasNode({
    id: input.nodeId,
    model: input.model,
    plainText: prompt,
    position: { x: 120, y: 120 },
  });

  return {
    version: 3,
    nodes: [
      {
        ...node,
        data: {
          ...node.data,
          createdAt: updatedAt,
          textGenerationPrompt: prompt,
        },
      },
    ],
    edges: [],
    viewport: { x: 160, y: 120, zoom: 1 },
    updatedAt,
  };
}

export function rememberHomePromptRequest(
  projectId: string,
  request: HomePromptRequest,
  storage: Pick<Storage, "setItem"> = window.sessionStorage,
) {
  storage.setItem(
    `${HOME_PROMPT_REQUEST_PREFIX}${projectId}`,
    JSON.stringify(request),
  );
}

export function consumeHomePromptRequest(
  projectId: string,
  storage: Pick<Storage, "getItem" | "removeItem"> = window.sessionStorage,
): HomePromptRequest | null {
  const key = `${HOME_PROMPT_REQUEST_PREFIX}${projectId}`;
  const raw = storage.getItem(key);
  storage.removeItem(key);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<HomePromptRequest>;
    if (
      typeof value.model !== "string" ||
      !value.model.trim() ||
      typeof value.nodeId !== "string" ||
      !value.nodeId.trim() ||
      typeof value.prompt !== "string" ||
      !value.prompt.trim()
    ) {
      return null;
    }
    return {
      model: value.model,
      nodeId: value.nodeId,
      prompt: value.prompt,
    };
  } catch {
    return null;
  }
}
