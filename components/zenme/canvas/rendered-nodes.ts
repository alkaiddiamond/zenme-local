import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import type { CanvasNodeData } from "@/components/zenme/node-types";
import { getImageEditResultNodeSize } from "@/components/zenme/image-edit-options";

import {
  numericSize,
  READER_COLLAPSED_SIZE,
  READER_DEFAULT_SIZE,
} from "./geometry";
import type { CanvasNode } from "./types";

type RenderedCanvasNodeInput = {
  createNoteNode: (
    note: ReadingNote,
    asset: ReadingAsset,
    readerNodeId?: string,
  ) => void;
  edges: Array<{ source: string; target: string }>;
  onCreateTextChildNode: (
    nodeId: string,
    selectedText: string,
    title?: string,
    options?: {
      aiModel?: string;
      kind?: "agent" | "text";
      prompt?: string;
    },
  ) => void;
  nodes: CanvasNode[];
  onUpdateTextNode: (
    nodeId: string,
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
    >,
  ) => void;
  onSubmitTextGenerationNode: (
    nodeId: string,
    input?: { model?: string; prompt?: string },
  ) => Promise<void> | void;
  onSubmitImageEditNode: (
    nodeId: string,
    input?: { aspectRatio?: string; prompt?: string; quality?: string },
  ) => Promise<void> | void;
  onUpdateImageEditNode: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "fileId"
        | "imageEditAspectRatio"
        | "imageEditError"
        | "imageEditQuality"
        | "imageEditPrompt"
        | "imageEditStatus"
        | "originalUrl"
        | "previewUrl"
        | "title"
      >
    >,
  ) => void;
  onUpdateTextGenerationNode: (
    nodeId: string,
    updates: Partial<
      Pick<CanvasNodeData, "textGenerationModel" | "textGenerationPrompt">
    >,
  ) => void;
  projectId: string;
  toggleReaderCollapse: (readerNodeId: string) => void;
};

type RenderedNodeCacheEntry = {
  createNoteNode?: RenderedCanvasNodeInput["createNoteNode"];
  node: CanvasNode;
  onCreateTextChildNode?: RenderedCanvasNodeInput["onCreateTextChildNode"];
  onSubmitTextGenerationNode?: RenderedCanvasNodeInput["onSubmitTextGenerationNode"];
  onSubmitImageEditNode?: RenderedCanvasNodeInput["onSubmitImageEditNode"];
  onUpdateTextGenerationNode?: RenderedCanvasNodeInput["onUpdateTextGenerationNode"];
  onUpdateImageEditNode?: RenderedCanvasNodeInput["onUpdateImageEditNode"];
  onUpdateTextNode?: RenderedCanvasNodeInput["onUpdateTextNode"];
  projectId?: string;
  toggleReaderCollapse?: RenderedCanvasNodeInput["toggleReaderCollapse"];
};

const renderedNodeCache = new WeakMap<CanvasNode, RenderedNodeCacheEntry>();

export function getRenderedCanvasNodes({
  createNoteNode,
  edges,
  nodes,
  onCreateTextChildNode,
  onSubmitImageEditNode,
  onSubmitTextGenerationNode,
  onUpdateImageEditNode,
  onUpdateTextGenerationNode,
  onUpdateTextNode,
  projectId,
  toggleReaderCollapse,
}: RenderedCanvasNodeInput) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const connectedNodeIdsByDirection = edges.reduce(
    (result, edge) => {
      result.incoming.add(edge.target);
      result.outgoing.add(edge.source);
      return result;
    },
    {
      incoming: new Set<string>(),
      outgoing: new Set<string>(),
    },
  );

  return nodes.map((node) => {
    const parentNode = node.parentId ? nodeById.get(node.parentId) : undefined;
    const nodeWithoutGroupDragLimit =
      parentNode?.data.kind === "group" && node.extent === "parent"
        ? {
            ...node,
            extent: undefined,
          }
        : node;
    const nodeWithConnectionState = {
      ...nodeWithoutGroupDragLimit,
      data: {
        ...nodeWithoutGroupDragLimit.data,
        hasIncomingEdge: connectedNodeIdsByDirection.incoming.has(node.id),
        hasOutgoingEdge: connectedNodeIdsByDirection.outgoing.has(node.id),
      },
    };

    if (
      nodeWithConnectionState.data.kind === "text" ||
      nodeWithConnectionState.data.kind === "markdown" ||
      nodeWithConnectionState.data.kind === "code"
    ) {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onCreateTextChildNode === onCreateTextChildNode &&
        cached.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.onUpdateTextNode === onUpdateTextNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedTextNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onCreateTextChildNode,
          onSubmitTextGenerationNode,
          onUpdateTextGenerationNode,
          onUpdateTextNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedTextNode,
        onCreateTextChildNode,
        onSubmitTextGenerationNode,
        onUpdateTextGenerationNode,
        onUpdateTextNode,
      });

      return renderedTextNode;
    }

    if (nodeWithConnectionState.data.kind === "textGeneration") {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedTextGenerationNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onSubmitTextGenerationNode,
          onUpdateTextGenerationNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedTextGenerationNode,
        onSubmitTextGenerationNode,
        onUpdateTextGenerationNode,
      });

      return renderedTextGenerationNode;
    }

    if (nodeWithConnectionState.data.kind === "imageEdit") {
      const style = nodeWithConnectionState.style as
        | Record<string, unknown>
        | undefined;
      const isLegacyImageEditSize =
        (numericSize(style?.height) === 520 && numericSize(style?.width) === 420) ||
        (numericSize(style?.height) === 180 && numericSize(style?.width) === 560) ||
        (numericSize(style?.height) === 440 && numericSize(style?.width) === 560);
      const normalizedImageEditNode = isLegacyImageEditSize
        ? {
            ...nodeWithConnectionState,
            height: 260,
            measured: { height: 260, width: 560 },
            style: {
              ...nodeWithConnectionState.style,
              height: 260,
              width: 560,
            },
            width: 560,
          }
        : nodeWithConnectionState;
      const cached = renderedNodeCache.get(normalizedImageEditNode);

      if (
        cached?.onSubmitImageEditNode === onSubmitImageEditNode &&
        cached.onUpdateImageEditNode === onUpdateImageEditNode &&
        cached.node.data.hasIncomingEdge === normalizedImageEditNode.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === normalizedImageEditNode.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedImageEditNode = {
        ...normalizedImageEditNode,
        data: {
          ...normalizedImageEditNode.data,
          onSubmitImageEditNode,
          onUpdateImageEditNode,
        },
      };

      renderedNodeCache.set(normalizedImageEditNode, {
        node: renderedImageEditNode,
        onSubmitImageEditNode,
        onUpdateImageEditNode,
      });

      return renderedImageEditNode;
    }

    if (
      nodeWithConnectionState.data.kind === "image" &&
      (nodeWithConnectionState.data.imageGenerated ||
        nodeWithConnectionState.data.imageEditPrompt)
    ) {
      const style = nodeWithConnectionState.style as
        | Record<string, unknown>
        | undefined;
      const hasExplicitSize =
        Boolean(numericSize(style?.height)) && Boolean(numericSize(style?.width));

      const generatedImageNode =
        hasExplicitSize
          ? nodeWithConnectionState
          : {
              ...nodeWithConnectionState,
              height: getImageEditResultNodeSize(
                nodeWithConnectionState.data.imageEditAspectRatio,
              ).height,
              measured: getImageEditResultNodeSize(
                nodeWithConnectionState.data.imageEditAspectRatio,
              ),
              style: getImageEditResultNodeSize(
                nodeWithConnectionState.data.imageEditAspectRatio,
              ),
              width: getImageEditResultNodeSize(
                nodeWithConnectionState.data.imageEditAspectRatio,
              ).width,
            };
      const cached = renderedNodeCache.get(generatedImageNode);

      if (
        cached?.onSubmitImageEditNode === onSubmitImageEditNode &&
        cached.onUpdateImageEditNode === onUpdateImageEditNode &&
        cached.node.data.hasIncomingEdge === generatedImageNode.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === generatedImageNode.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedGeneratedImageNode = {
        ...generatedImageNode,
        data: {
          ...generatedImageNode.data,
          onSubmitImageEditNode,
          onUpdateImageEditNode,
        },
      };

      renderedNodeCache.set(generatedImageNode, {
        node: renderedGeneratedImageNode,
        onSubmitImageEditNode,
        onUpdateImageEditNode,
      });

      return renderedGeneratedImageNode;
    }

    if (nodeWithConnectionState.data.kind === "note") {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedNoteNode = {
        ...nodeWithConnectionState,
        dragHandle: ".zenme-note-node-drag-handle",
        data: {
          ...nodeWithConnectionState.data,
          onSubmitTextGenerationNode,
          onUpdateTextGenerationNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedNoteNode,
        onSubmitTextGenerationNode,
        onUpdateTextGenerationNode,
      });

      return renderedNoteNode;
    }

    if (nodeWithConnectionState.data.kind === "agent") {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedAgentNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onSubmitTextGenerationNode,
          onUpdateTextGenerationNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedAgentNode,
        onSubmitTextGenerationNode,
        onUpdateTextGenerationNode,
      });

      return renderedAgentNode;
    }

    if (nodeWithConnectionState.data.kind !== "reader") {
      return nodeWithConnectionState;
    }

    const readerNode = nodeWithConnectionState;
    const style = readerNode.style as Record<string, unknown> | undefined;
    const expandedSize = {
      height:
        numericSize(style?.height) ??
        readerNode.data.readerExpandedSize?.height ??
        READER_DEFAULT_SIZE.height,
      width:
        numericSize(style?.width) ??
        readerNode.data.readerExpandedSize?.width ??
        READER_DEFAULT_SIZE.width,
    };
    const renderedSize = readerNode.data.readerCollapsed
      ? READER_COLLAPSED_SIZE
      : expandedSize;
    const currentHeight = numericSize(style?.height);
    const currentWidth = numericSize(style?.width);
    const hasRenderedSize =
      currentHeight === renderedSize.height &&
      currentWidth === renderedSize.width &&
      readerNode.height === renderedSize.height &&
      readerNode.width === renderedSize.width &&
      readerNode.measured?.height === renderedSize.height &&
      readerNode.measured?.width === renderedSize.width;
    const cached = renderedNodeCache.get(readerNode);

    if (
      cached?.createNoteNode === createNoteNode &&
      cached.projectId === projectId &&
      cached.toggleReaderCollapse === toggleReaderCollapse &&
      cached.node.data.hasIncomingEdge === readerNode.data.hasIncomingEdge &&
      cached.node.data.hasOutgoingEdge === readerNode.data.hasOutgoingEdge
    ) {
      return cached.node;
    }

    const renderedReaderNode = {
      ...readerNode,
      ...(hasRenderedSize
        ? {}
        : {
            height: renderedSize.height,
            measured: renderedSize,
            style: {
              ...readerNode.style,
              height: renderedSize.height,
              width: renderedSize.width,
            },
            width: renderedSize.width,
          }),
      data: {
        ...readerNode.data,
        projectId,
        onCreateNoteNode: createNoteNode,
        onToggleReaderCollapse: toggleReaderCollapse,
      },
    };

    renderedNodeCache.set(readerNode, {
      createNoteNode,
      node: renderedReaderNode,
      projectId,
      toggleReaderCollapse,
    });

    return renderedReaderNode;
  });
}
