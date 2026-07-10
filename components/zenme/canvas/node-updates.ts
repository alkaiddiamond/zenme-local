import type { CanvasNodeData } from "@/components/zenme/node-types";

import { createCanvasHistoryNodeSnapshot } from "./geometry";
import type { CanvasNode } from "./types";

type NodeUpdateResult = {
  beforeNodeSnapshots: Map<string, CanvasNode>;
  nextNodes: CanvasNode[];
};

export function createTextNodeDataUpdate(input: {
  nodeId: string;
  nodes: CanvasNode[];
  updates: Partial<
    Pick<
      CanvasNodeData,
      | "codeContent"
      | "codeLanguage"
      | "plainText"
      | "richTextHtml"
      | "textMode"
      | "title"
    >
  >;
}) {
  return createCanvasNodeDataUpdate({
    ...input,
    changedKeys: [
      "codeContent",
      "codeLanguage",
      "plainText",
      "richTextHtml",
      "textMode",
      "title",
    ],
    allowedKinds: new Set(["text", "markdown", "code"]),
  });
}

export function createCodeNodeDataUpdate(input: {
  nodeId: string;
  nodes: CanvasNode[];
  updates: Partial<Pick<CanvasNodeData, "codeContent" | "codeLanguage" | "title">>;
}) {
  return createCanvasNodeDataUpdate({
    ...input,
    changedKeys: ["codeContent", "codeLanguage", "title"],
    allowedKinds: new Set(["code"]),
  });
}

export function createTextGenerationNodeDataUpdate(input: {
  nodeId: string;
  nodes: CanvasNode[];
  updates: Partial<
    Pick<CanvasNodeData, "textGenerationModel" | "textGenerationPrompt">
  >;
}) {
  return createCanvasNodeDataUpdate({
    ...input,
    changedKeys: ["textGenerationModel", "textGenerationPrompt"],
    allowedKinds: new Set([
      "agent",
      "code",
      "markdown",
      "note",
      "text",
      "textGeneration",
    ]),
  });
}

export function createImageEditNodeDataUpdate(input: {
  nodeId: string;
  nodes: CanvasNode[];
  updates: Partial<
    Pick<
      CanvasNodeData,
      | "fileId"
      | "imageEditAspectRatio"
      | "imageEditError"
      | "imageEditModel"
      | "imageEditQuality"
      | "imageEditPrompt"
      | "imageEditStatus"
      | "originalUrl"
      | "previewUrl"
      | "title"
    >
  >;
}) {
  return createCanvasNodeDataUpdate({
    ...input,
    changedKeys: [
      "fileId",
      "imageEditAspectRatio",
      "imageEditError",
      "imageEditModel",
      "imageEditQuality",
      "imageEditPrompt",
      "imageEditStatus",
      "originalUrl",
      "previewUrl",
      "title",
    ],
    allowedKinds: new Set(["imageEdit", "image"]),
  });
}

function createCanvasNodeDataUpdate(input: {
  allowedKinds: Set<CanvasNodeData["kind"]>;
  changedKeys: Array<keyof CanvasNodeData>;
  nodeId: string;
  nodes: CanvasNode[];
  updates: Partial<CanvasNodeData>;
}): NodeUpdateResult | null {
  const sourceNode = input.nodes.find(
    (node) =>
      node.id === input.nodeId && input.allowedKinds.has(node.data.kind),
  );

  if (!sourceNode) {
    return null;
  }

  const nextData = {
    ...sourceNode.data,
    ...input.updates,
  };
  const didChange = input.changedKeys.some(
    (key) => nextData[key] !== sourceNode.data[key],
  );

  if (!didChange) {
    return null;
  }

  return {
    beforeNodeSnapshots: new Map([
      [input.nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
    ]),
    nextNodes: input.nodes.map((node) =>
      node.id === input.nodeId && input.allowedKinds.has(node.data.kind)
        ? {
            ...node,
            data: nextData,
          }
        : node,
    ),
  };
}
