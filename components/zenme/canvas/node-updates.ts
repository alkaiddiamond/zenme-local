import type {
  CanvasNodeData,
  ProjectTagAction,
} from "@/components/zenme/node-types";

import {
  createCanvasHistoryNodeSnapshot,
  readNodeSize,
} from "./geometry";
import type { CanvasNode } from "./types";

type NodeUpdateResult = {
  beforeNodeSnapshots: Map<string, CanvasNode>;
  nextNodes: CanvasNode[];
};

export const AI_RESPONSE_READING_PANEL_SIZE = {
  height: 1123,
  width: 794,
};
export const AI_RESPONSE_DEFAULT_SIZE = {
  height: 260,
  width: 620,
};
export const TEXT_NODE_DEFAULT_SIZE = {
  height: 176,
  width: 560,
};
export const TASK_NODE_DEFAULT_SIZE = {
  height: 176,
  width: 560,
};
export const MUSIC_CHILD_DEFAULT_SIZE = {
  height: 176,
  width: 560,
};

export function createProjectTagUpdate(input: {
  action: ProjectTagAction;
  nodes: CanvasNode[];
}): NodeUpdateResult | null {
  const affectedNodes = input.nodes.filter(
    (node) =>
      (node.data.kind === "managedText" || node.data.kind === "task") &&
      (node.data.tags?.includes(input.action.tag) ||
        Object.hasOwn(node.data.tagColors ?? {}, input.action.tag)),
  );
  if (!affectedNodes.length) return null;

  const beforeNodeSnapshots = new Map(
    affectedNodes.map((node) => [node.id, createCanvasHistoryNodeSnapshot(node)]),
  );
  const affectedIds = new Set(affectedNodes.map((node) => node.id));
  const nextNodes = input.nodes.map((node) => {
    if (!affectedIds.has(node.id)) return node;

    const tagColors = { ...(node.data.tagColors ?? {}) };
    if (input.action.type === "delete") {
      delete tagColors[input.action.tag];
      return {
        ...node,
        data: {
          ...node.data,
          tags: (node.data.tags ?? []).filter((tag) => tag !== input.action.tag),
          tagColors,
        },
      };
    }

    tagColors[input.action.tag] = input.action.color;
    return {
      ...node,
      data: { ...node.data, tagColors },
    };
  });

  return { beforeNodeSnapshots, nextNodes };
}

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
      | "name"
      | "tags"
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
      "name",
      "tags",
    ],
    allowedKinds: new Set(["text", "managedText", "markdown", "code"]),
  });
}

export function createTaskNodeDataUpdate(input: {
  nodeId: string;
  nodes: CanvasNode[];
  now?: string;
  updates: Partial<
    Pick<
      CanvasNodeData,
      | "name"
      | "tags"
      | "taskStatus"
      | "taskPriority"
      | "taskComplexity"
      | "taskUrgency"
    >
  >;
}): NodeUpdateResult | null {
  const sourceNode = input.nodes.find(
    (node) => node.id === input.nodeId && node.data.kind === "task",
  );
  if (!sourceNode) return null;

  const changedKeys = [
    "name",
    "tags",
    "taskStatus",
    "taskPriority",
    "taskComplexity",
    "taskUrgency",
  ] as const;
  const didChange = changedKeys.some(
    (key) =>
      Object.hasOwn(input.updates, key) &&
      input.updates[key] !== sourceNode.data[key],
  );
  if (!didChange) return null;

  const now = input.now ?? new Date().toISOString();
  const nextStatus = input.updates.taskStatus ?? sourceNode.data.taskStatus;
  const nextData: CanvasNodeData = {
    ...sourceNode.data,
    ...input.updates,
    completedAt:
      nextStatus === "completed"
        ? sourceNode.data.completedAt ?? now
        : undefined,
    updatedAt: now,
  };

  return {
    beforeNodeSnapshots: new Map([
      [input.nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
    ]),
    nextNodes: input.nodes.map((node) =>
      node.id === input.nodeId && node.data.kind === "task"
        ? { ...node, data: nextData }
        : node,
    ),
  };
}

export function createTaskChildrenVisibilityUpdate(input: {
  expanded: boolean;
  expandedContentHeight: number;
  nodeId: string;
  nodes: CanvasNode[];
}): NodeUpdateResult | null {
  const sourceNode = input.nodes.find(
    (node) => node.id === input.nodeId && node.data.kind === "task",
  );
  if (!sourceNode) return null;

  const currentSize = readNodeSize(sourceNode, { height: 460, width: 560 });
  const contentHeight = Math.max(
    Math.ceil(input.expandedContentHeight),
    TASK_NODE_DEFAULT_SIZE.height,
  );
  const expandedHeight = input.expanded
    ? contentHeight
    : Math.max(currentSize.height, contentHeight);
  const nextSize = {
    height: input.expanded
      ? expandedHeight
      : TASK_NODE_DEFAULT_SIZE.height,
    width: input.expanded
      ? currentSize.width
      : TASK_NODE_DEFAULT_SIZE.width,
  };
  if (
    Boolean(sourceNode.data.taskChildrenExpanded) === input.expanded &&
    currentSize.height === nextSize.height &&
    currentSize.width === nextSize.width &&
    sourceNode.data.taskExpandedHeight === expandedHeight
  ) {
    return null;
  }

  return {
    beforeNodeSnapshots: new Map([
      [input.nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
    ]),
    nextNodes: input.nodes.map((node) =>
      node.id === input.nodeId && node.data.kind === "task"
        ? {
            ...node,
            height: nextSize.height,
            measured: { ...nextSize },
            style: {
              ...(node.style ?? {}),
              ...nextSize,
            },
            width: nextSize.width,
            data: {
              ...node.data,
              taskChildrenExpanded: input.expanded,
              taskExpandedHeight: expandedHeight,
            },
          }
        : node,
    ),
  };
}

export function createAiResponseExpansionUpdate(input: {
  expanded: boolean;
  nodeId: string;
  nodes: CanvasNode[];
}): NodeUpdateResult | null {
  const sourceNode = input.nodes.find(
    (node) =>
      node.id === input.nodeId &&
      node.data.kind === "agent" &&
      Boolean(node.data.aiPrompt || node.data.aiResponse || node.data.aiStatus),
  );
  if (!sourceNode || Boolean(sourceNode.data.aiResponseExpanded) === input.expanded) {
    return null;
  }

  const nextSize = input.expanded
    ? AI_RESPONSE_READING_PANEL_SIZE
    : AI_RESPONSE_DEFAULT_SIZE;

  return {
    beforeNodeSnapshots: new Map([
      [input.nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
    ]),
    nextNodes: input.nodes.map((node) =>
      node.id === input.nodeId
        ? {
            ...node,
            height: nextSize.height,
            measured: { ...nextSize },
            style: {
              ...(node.style ?? {}),
              ...nextSize,
            },
            width: nextSize.width,
            data: {
              ...node.data,
              aiResponseExpanded: input.expanded,
            },
          }
        : node,
    ),
  };
}

export function createTextNodeExpansionUpdate(input: {
  expanded: boolean;
  nodeId: string;
  nodes: CanvasNode[];
}): NodeUpdateResult | null {
  const sourceNode = input.nodes.find(
    (node) => node.id === input.nodeId && node.data.kind === "text",
  );
  if (!sourceNode || Boolean(sourceNode.data.textExpanded) === input.expanded) {
    return null;
  }

  const nextSize = input.expanded
    ? AI_RESPONSE_READING_PANEL_SIZE
    : TEXT_NODE_DEFAULT_SIZE;

  return {
    beforeNodeSnapshots: new Map([
      [input.nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
    ]),
    nextNodes: input.nodes.map((node) =>
      node.id === input.nodeId
        ? {
            ...node,
            height: nextSize.height,
            measured: { ...nextSize },
            style: {
              ...(node.style ?? {}),
              ...nextSize,
            },
            width: nextSize.width,
            data: {
              ...node.data,
              textExpanded: input.expanded,
            },
          }
        : node,
    ),
  };
}

export function createMusicChildExpansionUpdate(input: {
  expanded: boolean;
  nodeId: string;
  nodes: CanvasNode[];
}): NodeUpdateResult | null {
  const sourceNode = input.nodes.find(
    (node) =>
      node.id === input.nodeId &&
      node.data.kind === "lyrics",
  );
  if (
    !sourceNode ||
    Boolean(sourceNode.data.musicChildExpanded) === input.expanded
  ) {
    return null;
  }

  const nextSize = input.expanded
    ? AI_RESPONSE_READING_PANEL_SIZE
    : MUSIC_CHILD_DEFAULT_SIZE;

  return {
    beforeNodeSnapshots: new Map([
      [input.nodeId, createCanvasHistoryNodeSnapshot(sourceNode)],
    ]),
    nextNodes: input.nodes.map((node) =>
      node.id === input.nodeId
        ? {
            ...node,
            height: nextSize.height,
            measured: { ...nextSize },
            style: {
              ...(node.style ?? {}),
              ...nextSize,
            },
            width: nextSize.width,
            data: {
              ...node.data,
              musicChildExpanded: input.expanded,
            },
          }
        : node,
    ),
  };
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
      "managedText",
      "textGeneration",
    ]),
  });
}

export function createImageGenerationNodeDataUpdate(input: {
  nodeId: string;
  nodes: CanvasNode[];
  updates: Partial<
    Pick<
      CanvasNodeData,
      | "fileId"
      | "imageCameraControl"
      | "imageOutputAspectRatio"
      | "imageError"
      | "imageModel"
      | "imageQuality"
      | "imagePrompt"
      | "imageStatus"
      | "imageReferenceNodeIds"
      | "imageTaskDurationMs"
      | "imageTaskStartedAt"
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
      "imageCameraControl",
      "imageOutputAspectRatio",
      "imageError",
      "imageModel",
      "imageQuality",
      "imagePrompt",
      "imageStatus",
      "imageReferenceNodeIds",
      "imageTaskDurationMs",
      "imageTaskStartedAt",
      "originalUrl",
      "previewUrl",
      "title",
    ],
    allowedKinds: new Set(["imageGeneration", "image"]),
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
