import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import type { CanvasNodeData } from "@/components/zenme/node-types";
import {
  getImageDisplaySize,
  getImageEditResultNodeSize,
} from "@/components/zenme/image-edit-options";

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
  onResolveImageDimensions?: (
    nodeId: string,
    dimensions: { height: number; width: number },
  ) => void;
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
  onSubmitImageNode: (
    nodeId: string,
    input?: { aspectRatio?: string; model?: string; prompt?: string; quality?: string },
  ) => Promise<void> | void;
  onUpdateImageNode: (
    nodeId: string,
    updates: Partial<
      Pick<
        CanvasNodeData,
        | "fileId"
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
  onSubmitImageNode?: RenderedCanvasNodeInput["onSubmitImageNode"];
  onUpdateTextGenerationNode?: RenderedCanvasNodeInput["onUpdateTextGenerationNode"];
  onUpdateImageNode?: RenderedCanvasNodeInput["onUpdateImageNode"];
  onUpdateTextNode?: RenderedCanvasNodeInput["onUpdateTextNode"];
  projectId?: string;
  toggleReaderCollapse?: RenderedCanvasNodeInput["toggleReaderCollapse"];
};

const renderedNodeCache = new WeakMap<CanvasNode, RenderedNodeCacheEntry>();

export function getRenderedCanvasNodes({
  createNoteNode,
  edges,
  nodes,
  onResolveImageDimensions,
  onCreateTextChildNode,
  onSubmitImageNode,
  onSubmitTextGenerationNode,
  onUpdateImageNode,
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
  const imageReferencesByTargetId = new Map<
    string,
    NonNullable<CanvasNodeData["imageReferences"]>
  >();
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const url = source?.data.originalUrl ?? source?.data.previewUrl;
    if (source?.data.kind !== "image" || !url) continue;
    const references = imageReferencesByTargetId.get(edge.target) ?? [];
    references.push({
      nodeId: source.id,
      title: source.data.title || "图片",
      url: source.data.previewUrl ?? url,
    });
    imageReferencesByTargetId.set(edge.target, references);
  }

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
        ...(
          nodeWithoutGroupDragLimit.data.kind === "imageGeneration" ||
          (nodeWithoutGroupDragLimit.data.kind === "image" &&
            nodeWithoutGroupDragLimit.data.imageGenerated)
            ? (() => {
                const candidates = imageReferencesByTargetId.get(node.id) ?? [];
                const selectedIds = nodeWithoutGroupDragLimit.data.imageReferenceNodeIds;
                return {
                  imageReferenceCandidates: candidates,
                  imageReferences: selectedIds === undefined
                    ? candidates
                    : candidates.filter((reference) => selectedIds.includes(reference.nodeId)),
                };
              })()
            : {}
        ),
        ...(nodeWithoutGroupDragLimit.data.kind === "image"
          ? { onResolveImageDimensions }
          : {}),
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

    if (nodeWithConnectionState.data.kind === "imageGeneration") {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onSubmitImageNode === onSubmitImageNode &&
        cached.onUpdateImageNode === onUpdateImageNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedImageGenerationNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onSubmitImageNode,
          onUpdateImageNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedImageGenerationNode,
        onSubmitImageNode,
        onUpdateImageNode,
      });

      return renderedImageGenerationNode;
    }

    if (
      nodeWithConnectionState.data.kind === "image" &&
      (nodeWithConnectionState.data.imageGenerated ||
        nodeWithConnectionState.data.imagePrompt)
    ) {
      const normalizedSize = nodeWithConnectionState.data.imageAspectRatio
        ? getImageDisplaySize(nodeWithConnectionState.data.imageAspectRatio)
        : getImageEditResultNodeSize(
            nodeWithConnectionState.data.imageOutputAspectRatio,
          );

      const generatedImageNode = {
        ...nodeWithConnectionState,
        height: normalizedSize.height,
        measured: normalizedSize,
        style: normalizedSize,
        width: normalizedSize.width,
      };
      const cached = renderedNodeCache.get(generatedImageNode);

      if (
        cached?.onSubmitImageNode === onSubmitImageNode &&
        cached.onUpdateImageNode === onUpdateImageNode &&
        cached.node.data.hasIncomingEdge === generatedImageNode.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === generatedImageNode.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedGeneratedImageNode = {
        ...generatedImageNode,
        data: {
          ...generatedImageNode.data,
          onSubmitImageNode,
          onUpdateImageNode,
        },
      };

      renderedNodeCache.set(generatedImageNode, {
        node: renderedGeneratedImageNode,
        onSubmitImageNode,
        onUpdateImageNode,
      });

      return renderedGeneratedImageNode;
    }

    if (nodeWithConnectionState.data.kind === "image") {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onUpdateImageNode === onUpdateImageNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge
      ) {
        return cached.node;
      }

      const renderedImageNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onUpdateImageNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedImageNode,
        onUpdateImageNode,
      });

      return renderedImageNode;
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
