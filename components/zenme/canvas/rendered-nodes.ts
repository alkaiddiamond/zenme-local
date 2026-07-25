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
import { IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE } from "./node-factories";
import type { CanvasNode } from "./types";
import {
  deriveTaskRelationships,
  getTaskParentOptions,
} from "./task-relationships";

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
  onEnsureMusicPlayback?: NonNullable<CanvasNodeData["onEnsureMusicPlayback"]>;
  onEnsureMusicWaveform?: NonNullable<CanvasNodeData["onEnsureMusicWaveform"]>;
  onCreateMusicChildNode?: NonNullable<CanvasNodeData["onCreateMusicChildNode"]>;
  onCreateMusicPlayerNode?: NonNullable<CanvasNodeData["onCreateMusicPlayerNode"]>;
  onLocateMusicPlayerNode?: NonNullable<CanvasNodeData["onLocateMusicPlayerNode"]>;
  onSeekMusicPlayer?: NonNullable<CanvasNodeData["onSeekMusicPlayer"]>;
  onToggleMusicPlayback?: NonNullable<CanvasNodeData["onToggleMusicPlayback"]>;
  onUpdateMusicNode?: NonNullable<CanvasNodeData["onUpdateMusicNode"]>;
  onUpdateMusicPlayback?: NonNullable<CanvasNodeData["onUpdateMusicPlayback"]>;
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
        | "name"
        | "plainText"
        | "richTextHtml"
        | "tags"
        | "textMode"
        | "title"
      >
    >,
  ) => void;
  onUpdateTaskNode?: NonNullable<CanvasNodeData["onUpdateTaskNode"]>;
  onSetTaskParent?: NonNullable<CanvasNodeData["onSetTaskParent"]>;
  onLocateTaskNode?: NonNullable<CanvasNodeData["onLocateTaskNode"]>;
  onToggleTaskChildren?: NonNullable<CanvasNodeData["onToggleTaskChildren"]>;
  onToggleAiResponseExpanded?: NonNullable<
    CanvasNodeData["onToggleAiResponseExpanded"]
  >;
  onToggleTextExpanded?: NonNullable<CanvasNodeData["onToggleTextExpanded"]>;
  onToggleMusicChildExpanded?: NonNullable<
    CanvasNodeData["onToggleMusicChildExpanded"]
  >;
  onUpdateProjectTag?: NonNullable<CanvasNodeData["onUpdateProjectTag"]>;
  onSubmitTextGenerationNode: (
    nodeId: string,
    input?: { model?: string; prompt?: string },
  ) => Promise<void> | void;
  onSubmitImageNode: (
    nodeId: string,
    input?: Parameters<NonNullable<CanvasNodeData["onSubmitImageNode"]>>[1],
  ) => Promise<void> | void;
  onSubmitVideoNode?: NonNullable<CanvasNodeData["onSubmitVideoNode"]>;
  onUpdateVideoNode?: NonNullable<CanvasNodeData["onUpdateVideoNode"]>;
  onUpdateImageNode: (
    nodeId: string,
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
  onSubmitVideoNode?: RenderedCanvasNodeInput["onSubmitVideoNode"];
  onUpdateVideoNode?: RenderedCanvasNodeInput["onUpdateVideoNode"];
  onUpdateTextGenerationNode?: RenderedCanvasNodeInput["onUpdateTextGenerationNode"];
  onUpdateImageNode?: RenderedCanvasNodeInput["onUpdateImageNode"];
  onUpdateTextNode?: RenderedCanvasNodeInput["onUpdateTextNode"];
  onUpdateTaskNode?: RenderedCanvasNodeInput["onUpdateTaskNode"];
  onSetTaskParent?: RenderedCanvasNodeInput["onSetTaskParent"];
  onLocateTaskNode?: RenderedCanvasNodeInput["onLocateTaskNode"];
  onToggleTaskChildren?: RenderedCanvasNodeInput["onToggleTaskChildren"];
  onToggleAiResponseExpanded?: RenderedCanvasNodeInput["onToggleAiResponseExpanded"];
  onToggleTextExpanded?: RenderedCanvasNodeInput["onToggleTextExpanded"];
  onToggleMusicChildExpanded?: RenderedCanvasNodeInput["onToggleMusicChildExpanded"];
  onUpdateProjectTag?: RenderedCanvasNodeInput["onUpdateProjectTag"];
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
  onEnsureMusicPlayback,
  onEnsureMusicWaveform,
  onCreateMusicChildNode,
  onCreateMusicPlayerNode,
  onLocateMusicPlayerNode,
  onSeekMusicPlayer,
  onToggleMusicPlayback,
  onUpdateMusicNode,
  onUpdateMusicPlayback,
  onSubmitImageNode,
  onSubmitVideoNode,
  onSubmitTextGenerationNode,
  onUpdateImageNode,
  onUpdateVideoNode,
  onUpdateTextGenerationNode,
  onUpdateTextNode,
  onUpdateTaskNode,
  onSetTaskParent,
  onLocateTaskNode,
  onToggleTaskChildren,
  onToggleAiResponseExpanded,
  onToggleTextExpanded,
  onToggleMusicChildExpanded,
  onUpdateProjectTag,
  projectId,
  toggleReaderCollapse,
}: RenderedCanvasNodeInput) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const projectTags = Array.from(
    new Set(
      nodes.flatMap((node) =>
        node.data.kind === "managedText" || node.data.kind === "task"
          ? (node.data.tags ?? [])
          : [],
      ),
    ),
  ).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const projectTagColors = nodes.reduce<
    NonNullable<CanvasNodeData["projectTagColors"]>
  >((colors, node) => {
    if (node.data.kind !== "managedText" && node.data.kind !== "task") {
      return colors;
    }
    for (const [tag, color] of Object.entries(node.data.tagColors ?? {})) {
      if (color && colors[tag] === undefined) colors[tag] = color;
    }
    return colors;
  }, {});
  const musicPlayerIdByMusicId = new Map<string, string>();
  const taskRelationships = deriveTaskRelationships(nodes, edges);
  const musicSourceByPlayerId = new Map<string, CanvasNode>();
  const playerByChildId = new Map<string, CanvasNode>();
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (source?.data.kind === "music" && target?.data.kind === "musicPlayer") {
      musicPlayerIdByMusicId.set(source.id, target.id);
      musicSourceByPlayerId.set(target.id, source);
    }
    if (source?.data.kind === "musicPlayer" && target?.data.kind === "lyrics") {
      playerByChildId.set(target.id, source);
    }
  }
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
  const hasMultipleSelectedNodes =
    nodes.filter((node) => node.selected).length > 1;
  const runningGenerationSourceIds = new Set<string>();
  for (const edge of edges) {
    const target = nodeById.get(edge.target);
    if (
      target?.data.aiStatus === "generating" ||
      (target?.data.imageGenerationResult && target.data.imageStatus === "editing") ||
      (target?.data.videoGenerationResult && target.data.videoStatus === "generating")
    ) {
      runningGenerationSourceIds.add(edge.source);
    }
  }
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
        isMultiSelection:
          hasMultipleSelectedNodes && Boolean(node.selected),
        hasRunningGenerationChild: runningGenerationSourceIds.has(node.id),
        ...(
          nodeWithoutGroupDragLimit.data.kind === "imageGeneration" ||
          nodeWithoutGroupDragLimit.data.kind === "videoGeneration" ||
          (nodeWithoutGroupDragLimit.data.kind === "image" &&
            nodeWithoutGroupDragLimit.data.imageGenerated)
            ? (() => {
                const candidates = imageReferencesByTargetId.get(node.id) ?? [];
                const selectedIds = nodeWithoutGroupDragLimit.data.imageReferenceNodeIds;
                return {
                  imageReferenceCandidates: candidates,
                  imageReferences: selectedIds === undefined
                    ? candidates
                    : selectedIds
                        .map((selectedId) =>
                          candidates.find(
                            (reference) => reference.nodeId === selectedId,
                          ),
                        )
                        .filter(
                          (
                            reference,
                          ): reference is NonNullable<
                            CanvasNodeData["imageReferences"]
                          >[number] => Boolean(reference),
                        ),
                };
              })()
            : {}
        ),
        ...(nodeWithoutGroupDragLimit.data.kind === "image"
          ? { onResolveImageDimensions }
          : {}),
      },
    };

    if (nodeWithConnectionState.data.kind === "music") {
      return {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          musicPlayerNodeId: musicPlayerIdByMusicId.get(nodeWithConnectionState.id),
          onCreateMusicPlayerNode,
          onLocateMusicPlayerNode,
          onUpdateMusicNode,
        },
      };
    }

    if (nodeWithConnectionState.data.kind === "musicPlayer") {
      const source = musicSourceByPlayerId.get(nodeWithConnectionState.id);
      return {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          coverUrl: source?.data.coverUrl,
          fileId: source?.data.fileId,
          fileName: source?.data.fileName,
          fileSize: source?.data.fileSize,
          mimeType: source?.data.mimeType,
          originalUrl: source?.data.originalUrl,
          previewUrl: source?.data.previewUrl,
          onCreateMusicChildNode,
          onEnsureMusicPlayback,
          onEnsureMusicWaveform,
          onSeekMusicPlayer,
          onToggleMusicPlayback,
          onUpdateMusicNode,
          onUpdateMusicPlayback,
        },
      };
    }

    if (nodeWithConnectionState.data.kind === "lyrics") {
      const player = playerByChildId.get(nodeWithConnectionState.id);
      return {
        ...nodeWithConnectionState,
        style: {
          height: 176,
          width: 560,
          ...(nodeWithConnectionState.style ?? {}),
        },
        data: {
          ...nodeWithConnectionState.data,
          musicCurrentTime: player?.data.musicCurrentTime,
          musicParentPlayerNodeId: player?.id ?? nodeWithConnectionState.data.musicParentPlayerNodeId,
          musicLyrics: nodeWithConnectionState.data.musicLyrics ?? [],
          onSeekMusicPlayer,
          onToggleMusicChildExpanded,
          onUpdateMusicNode,
        },
      };
    }

    if (
      nodeWithConnectionState.data.kind === "task"
    ) {
      const taskChildren =
        taskRelationships.childrenByParentId.get(nodeWithConnectionState.id) ?? [];
      const completedChildren = taskChildren.filter(
        (child) => child.status === "completed",
      ).length;
      const taskProgress = taskChildren.length
        ? completedChildren / taskChildren.length
        : nodeWithConnectionState.data.taskStatus === "completed"
          ? 1
          : 0;

      return {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onLocateTaskNode,
          onSetTaskParent,
          onUpdateProjectTag,
          onUpdateTaskNode,
          onToggleTaskChildren,
          projectTagColors,
          projectTags,
          taskChildren,
          taskParentId:
            taskRelationships.parentIdByChildId.get(nodeWithConnectionState.id),
          taskParentOptions: getTaskParentOptions({
            edges,
            nodeId: nodeWithConnectionState.id,
            nodes,
          }),
          taskProgress,
        },
      };
    }

    if (
      nodeWithConnectionState.data.kind === "text" ||
      nodeWithConnectionState.data.kind === "managedText" ||
      nodeWithConnectionState.data.kind === "markdown" ||
      nodeWithConnectionState.data.kind === "code"
    ) {
      const cached = renderedNodeCache.get(nodeWithConnectionState);

      if (
        cached?.onCreateTextChildNode === onCreateTextChildNode &&
        cached.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onToggleTextExpanded === onToggleTextExpanded &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.onUpdateTextNode === onUpdateTextNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === nodeWithConnectionState.data.hasRunningGenerationChild
      ) {
        return cached.node;
      }

      const renderedTextNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          ...(nodeWithConnectionState.data.kind === "managedText"
            ? { onUpdateProjectTag, projectTagColors, projectTags }
            : {}),
          onCreateTextChildNode,
          onSubmitTextGenerationNode,
          onToggleTextExpanded,
          onUpdateTextGenerationNode,
          onUpdateTextNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedTextNode,
        onCreateTextChildNode,
        onSubmitTextGenerationNode,
        onToggleTextExpanded,
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
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === nodeWithConnectionState.data.hasRunningGenerationChild
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
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === nodeWithConnectionState.data.hasRunningGenerationChild
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
      nodeWithConnectionState.data.kind === "videoGeneration" ||
      nodeWithConnectionState.data.kind === "video"
    ) {
      const currentVideoStyle = nodeWithConnectionState.style as
        | { height?: number; width?: number }
        | undefined;
      const usesLegacyPlaceholderSize =
        nodeWithConnectionState.data.kind === "videoGeneration" &&
        currentVideoStyle?.height === 315 &&
        currentVideoStyle.width === 560;
      const normalizedVideoNode = usesLegacyPlaceholderSize
        ? {
            ...nodeWithConnectionState,
            style: {
              ...nodeWithConnectionState.style,
              ...IMAGE_GENERATION_REQUEST_NODE_DEFAULT_SIZE,
            },
          }
        : nodeWithConnectionState;
      const cached = renderedNodeCache.get(normalizedVideoNode);
      if (
        cached &&
        cached.onSubmitVideoNode === onSubmitVideoNode &&
        cached.onUpdateVideoNode === onUpdateVideoNode &&
        cached.node.data.hasIncomingEdge === normalizedVideoNode.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === normalizedVideoNode.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === normalizedVideoNode.data.hasRunningGenerationChild
      ) return cached.node;

      const renderedVideoNode = {
        ...normalizedVideoNode,
        data: {
          ...normalizedVideoNode.data,
          onSubmitVideoNode,
          onUpdateVideoNode,
        },
      };
      renderedNodeCache.set(normalizedVideoNode, {
        node: renderedVideoNode,
        onSubmitVideoNode,
        onUpdateVideoNode,
      });
      return renderedVideoNode;
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
        cached.node.data.hasOutgoingEdge === generatedImageNode.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === generatedImageNode.data.hasRunningGenerationChild
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
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === nodeWithConnectionState.data.hasRunningGenerationChild
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
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === nodeWithConnectionState.data.hasRunningGenerationChild
      ) {
        return cached.node;
      }

      const renderedNoteNode = {
        ...nodeWithConnectionState,
        dragHandle: ".zenme-node-title-bar",
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
        cached.onToggleAiResponseExpanded === onToggleAiResponseExpanded &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.node.data.hasIncomingEdge === nodeWithConnectionState.data.hasIncomingEdge &&
        cached.node.data.hasOutgoingEdge === nodeWithConnectionState.data.hasOutgoingEdge &&
        cached.node.data.hasRunningGenerationChild === nodeWithConnectionState.data.hasRunningGenerationChild
      ) {
        return cached.node;
      }

      const renderedAgentNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onToggleAiResponseExpanded,
          onSubmitTextGenerationNode,
          onUpdateTextGenerationNode,
        },
      };

      renderedNodeCache.set(nodeWithConnectionState, {
        node: renderedAgentNode,
        onToggleAiResponseExpanded,
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
