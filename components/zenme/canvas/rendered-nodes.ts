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
} from "./task-relationships";
import { hasCanvasNodeContextText } from "./text-generation-context";

type RenderedCanvasNodeInput = {
  activeContentNodeIds?: ReadonlySet<string> | null;
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
  musicLyricsOverlayPlayerNodeId?: string;
  onEnsureMusicPlayback?: NonNullable<CanvasNodeData["onEnsureMusicPlayback"]>;
  onEnsureMusicWaveform?: NonNullable<CanvasNodeData["onEnsureMusicWaveform"]>;
  onCreateMusicChildNode?: NonNullable<CanvasNodeData["onCreateMusicChildNode"]>;
  onCreateMusicPlayerNode?: NonNullable<CanvasNodeData["onCreateMusicPlayerNode"]>;
  onLocateMusicPlayerNode?: NonNullable<CanvasNodeData["onLocateMusicPlayerNode"]>;
  onSeekMusicPlayer?: NonNullable<CanvasNodeData["onSeekMusicPlayer"]>;
  onSelectAdjacentMusicSource?: NonNullable<
    CanvasNodeData["onSelectAdjacentMusicSource"]
  >;
  onSelectMusicSource?: NonNullable<CanvasNodeData["onSelectMusicSource"]>;
  onToggleMusicLyricsOverlay?: NonNullable<CanvasNodeData["onToggleMusicLyricsOverlay"]>;
  onToggleMusicFolderExpanded?: NonNullable<CanvasNodeData["onToggleMusicFolderExpanded"]>;
  onToggleMusicPlayback?: NonNullable<CanvasNodeData["onToggleMusicPlayback"]>;
  onUpdateMusicNode?: NonNullable<CanvasNodeData["onUpdateMusicNode"]>;
  onUpdateMusicPlayback?: NonNullable<CanvasNodeData["onUpdateMusicPlayback"]>;
  onResolveImageDimensions?: (
    nodeId: string,
    dimensions: { height: number; width: number },
  ) => void;
  onCreateDerivedImageNode?: NonNullable<
    CanvasNodeData["onCreateDerivedImageNode"]
  >;
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
  onRequestTaskParentOptions?: NonNullable<CanvasNodeData["onRequestTaskParentOptions"]>;
  onLocateTaskNode?: NonNullable<CanvasNodeData["onLocateTaskNode"]>;
  onToggleTaskChildren?: NonNullable<CanvasNodeData["onToggleTaskChildren"]>;
  onToggleAiResponseExpanded?: NonNullable<
    CanvasNodeData["onToggleAiResponseExpanded"]
  >;
  onToggleTextExpanded?: NonNullable<CanvasNodeData["onToggleTextExpanded"]>;
  onToggleImagePromptExpanded?: NonNullable<
    CanvasNodeData["onToggleImagePromptExpanded"]
  >;
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
        | "imagePromptMentions"
        | "imageStatus"
        | "imageReferenceNodeIds"
        | "imageTextReferenceNodeIds"
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
  dependencyKey?: string;
  dependencies?: readonly unknown[];
  node: CanvasNode;
  onCreateTextChildNode?: RenderedCanvasNodeInput["onCreateTextChildNode"];
  onSubmitTextGenerationNode?: RenderedCanvasNodeInput["onSubmitTextGenerationNode"];
  onSubmitImageNode?: RenderedCanvasNodeInput["onSubmitImageNode"];
  onSubmitVideoNode?: RenderedCanvasNodeInput["onSubmitVideoNode"];
  onUpdateVideoNode?: RenderedCanvasNodeInput["onUpdateVideoNode"];
  onUpdateTextGenerationNode?: RenderedCanvasNodeInput["onUpdateTextGenerationNode"];
  onUpdateImageNode?: RenderedCanvasNodeInput["onUpdateImageNode"];
  onCreateDerivedImageNode?: RenderedCanvasNodeInput["onCreateDerivedImageNode"];
  onUpdateTextNode?: RenderedCanvasNodeInput["onUpdateTextNode"];
  onUpdateTaskNode?: RenderedCanvasNodeInput["onUpdateTaskNode"];
  onSetTaskParent?: RenderedCanvasNodeInput["onSetTaskParent"];
  onRequestTaskParentOptions?: RenderedCanvasNodeInput["onRequestTaskParentOptions"];
  onLocateTaskNode?: RenderedCanvasNodeInput["onLocateTaskNode"];
  onToggleTaskChildren?: RenderedCanvasNodeInput["onToggleTaskChildren"];
  onToggleAiResponseExpanded?: RenderedCanvasNodeInput["onToggleAiResponseExpanded"];
  onToggleTextExpanded?: RenderedCanvasNodeInput["onToggleTextExpanded"];
  onToggleImagePromptExpanded?: RenderedCanvasNodeInput["onToggleImagePromptExpanded"];
  onToggleMusicChildExpanded?: RenderedCanvasNodeInput["onToggleMusicChildExpanded"];
  onUpdateProjectTag?: RenderedCanvasNodeInput["onUpdateProjectTag"];
  projectId?: string;
  sourceEdges?: RenderedCanvasNodeInput["edges"];
  sourceNodes?: RenderedCanvasNodeInput["nodes"];
  toggleReaderCollapse?: RenderedCanvasNodeInput["toggleReaderCollapse"];
};

const renderedNodeCache = new WeakMap<CanvasNode, RenderedNodeCacheEntry>();

function hasSameSharedDerivedState(left: CanvasNode, right: CanvasNode) {
  return left.data.canvasContentActive === right.data.canvasContentActive &&
    left.data.hasIncomingEdge === right.data.hasIncomingEdge &&
    left.data.hasOutgoingEdge === right.data.hasOutgoingEdge &&
    left.data.hasRunningGenerationChild === right.data.hasRunningGenerationChild &&
    left.data.isMultiSelection === right.data.isMultiSelection;
}

function getSharedDerivedStateKey(node: CanvasNode) {
  return [
    node.data.canvasContentActive === false ? 0 : 1,
    node.data.hasIncomingEdge ? 1 : 0,
    node.data.hasOutgoingEdge ? 1 : 0,
    node.data.hasRunningGenerationChild ? 1 : 0,
    node.data.isMultiSelection ? 1 : 0,
  ].join("");
}

function getDependencyCachedNode(
  sourceNode: CanvasNode,
  dependencyKey: string,
  dependencies: readonly unknown[],
) {
  const cached = renderedNodeCache.get(sourceNode);
  if (
    cached?.dependencyKey !== dependencyKey ||
    cached.dependencies?.length !== dependencies.length ||
    !dependencies.every((dependency, index) =>
      Object.is(dependency, cached.dependencies?.[index]))
  ) {
    return undefined;
  }
  return cached.node;
}

function setDependencyCachedNode(
  sourceNode: CanvasNode,
  renderedNode: CanvasNode,
  dependencyKey: string,
  dependencies: readonly unknown[],
) {
  renderedNodeCache.set(sourceNode, {
    dependencies,
    dependencyKey,
    node: renderedNode,
  });
  return renderedNode;
}

export function getRenderedCanvasNodes({
  activeContentNodeIds,
  createNoteNode,
  edges,
  nodes,
  musicLyricsOverlayPlayerNodeId,
  onResolveImageDimensions,
  onCreateDerivedImageNode,
  onCreateTextChildNode,
  onEnsureMusicPlayback,
  onEnsureMusicWaveform,
  onCreateMusicChildNode,
  onCreateMusicPlayerNode,
  onLocateMusicPlayerNode,
  onSeekMusicPlayer,
  onSelectAdjacentMusicSource,
  onSelectMusicSource,
  onToggleMusicLyricsOverlay,
  onToggleMusicFolderExpanded,
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
  onRequestTaskParentOptions,
  onLocateTaskNode,
  onToggleTaskChildren,
  onToggleAiResponseExpanded,
  onToggleTextExpanded,
  onToggleImagePromptExpanded,
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
  const musicSourcesByPlayerId = new Map<string, CanvasNode[]>();
  const musicNodesByFolderId = new Map<string, CanvasNode[]>();
  const playerByChildId = new Map<string, CanvasNode>();
  for (const candidate of nodes) {
    if (candidate.data.kind !== "music" || !candidate.data.musicFolderId) continue;
    const folderMembers = musicNodesByFolderId.get(candidate.data.musicFolderId) ?? [];
    folderMembers.push(candidate);
    musicNodesByFolderId.set(candidate.data.musicFolderId, folderMembers);
  }
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (
      (source?.data.kind === "music" || source?.data.kind === "musicFolder") &&
      target?.data.kind === "musicPlayer"
    ) {
      musicPlayerIdByMusicId.set(source.id, target.id);
      const musicSources = musicSourcesByPlayerId.get(target.id) ?? [];
      const expandedSources = source.data.kind === "music"
        ? [source]
        : [
            ...(source.data.musicFolderSources ?? []).map((item): CanvasNode => ({
              id: item.id,
              type: "music",
              position: source.position,
              data: {
                kind: "music",
                title: item.title,
                fileId: item.fileId,
                fileName: item.fileName,
                fileSize: item.fileSize,
                mimeType: item.mimeType,
                originalUrl: item.originalUrl,
                musicFolderId: source.id,
              },
            })),
            ...(musicNodesByFolderId.get(source.id) ?? []),
          ];
      for (const item of expandedSources) {
        if (!musicSources.some((candidate) => candidate.id === item.id)) {
          musicSources.push(item);
        }
      }
      musicSourcesByPlayerId.set(target.id, musicSources);
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
  const imageTextReferencesByTargetId = new Map<
    string,
    NonNullable<CanvasNodeData["imageTextReferences"]>
  >();
  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const url = source?.data.originalUrl ?? source?.data.previewUrl;
    if (source?.data.kind === "image" && url) {
      const references = imageReferencesByTargetId.get(edge.target) ?? [];
      references.push({
        nodeId: source.id,
        title: source.data.title || "图片",
        url: source.data.previewUrl ?? url,
      });
      imageReferencesByTargetId.set(edge.target, references);
    }

    if (source && hasCanvasNodeContextText(source)) {
      const references = imageTextReferencesByTargetId.get(edge.target) ?? [];
      if (!references.some((reference) => reference.nodeId === source.id)) {
        references.push({
          nodeId: source.id,
          title: source.data.title || "文本",
        });
        imageTextReferencesByTargetId.set(edge.target, references);
      }
    }
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
        canvasContentActive:
          activeContentNodeIds === null || activeContentNodeIds === undefined
            ? true
            : activeContentNodeIds.has(node.id) ||
              node.data.aiStatus === "generating" ||
              node.data.imageStatus === "editing" ||
              Boolean(node.data.musicIsPlaying) ||
              node.data.videoStatus === "generating",
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
                const textCandidates =
                  imageTextReferencesByTargetId.get(node.id) ?? [];
                const selectedTextIds =
                  nodeWithoutGroupDragLimit.data.imageTextReferenceNodeIds;
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
                  imageTextReferenceCandidates: textCandidates,
                  imageTextReferences: selectedTextIds === undefined
                    ? textCandidates
                    : selectedTextIds
                        .map((selectedId) =>
                          textCandidates.find(
                            (reference) => reference.nodeId === selectedId,
                          ),
                        )
                        .filter(
                          (
                            reference,
                          ): reference is NonNullable<
                            CanvasNodeData["imageTextReferences"]
                          >[number] => Boolean(reference),
                        ),
                };
              })()
            : {}
        ),
        ...(nodeWithoutGroupDragLimit.data.kind === "image"
          ? { onCreateDerivedImageNode, onResolveImageDimensions }
          : {}),
      },
    };

    if (nodeWithConnectionState.data.kind === "music") {
      const musicPlayerNodeId = musicPlayerIdByMusicId.get(nodeWithConnectionState.id);
      const dependencyKey = `${getSharedDerivedStateKey(nodeWithConnectionState)}:${musicPlayerNodeId ?? ""}`;
      const dependencies = [
        onCreateMusicPlayerNode,
        onLocateMusicPlayerNode,
        onUpdateMusicNode,
      ];
      const cached = getDependencyCachedNode(node, dependencyKey, dependencies);
      if (cached) return cached;
      const renderedMusicNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          musicPlayerNodeId,
          onCreateMusicPlayerNode,
          onLocateMusicPlayerNode,
          onUpdateMusicNode,
        },
      };
      return setDependencyCachedNode(
        node,
        renderedMusicNode,
        dependencyKey,
        dependencies,
      );
    }

    if (nodeWithConnectionState.data.kind === "musicFolder") {
      const musicFolderMembers = (musicNodesByFolderId.get(nodeWithConnectionState.id) ?? [])
        .map((candidate) => ({
              id: candidate.id,
              fileId: candidate.data.fileId,
              fileName: candidate.data.fileName,
              fileSize: candidate.data.fileSize,
              mimeType: candidate.data.mimeType,
              originalUrl: candidate.data.originalUrl,
              title: candidate.data.title || candidate.data.fileName || "未命名音乐",
            }));
      const musicPlayerNodeId = musicPlayerIdByMusicId.get(nodeWithConnectionState.id);
      const dependencyKey = JSON.stringify({
        members: musicFolderMembers,
        musicPlayerNodeId,
        shared: getSharedDerivedStateKey(nodeWithConnectionState),
      });
      const dependencies = [
        onCreateMusicPlayerNode,
        onLocateMusicPlayerNode,
        onToggleMusicFolderExpanded,
        onUpdateMusicNode,
      ];
      const cached = getDependencyCachedNode(node, dependencyKey, dependencies);
      if (cached) return cached;
      const renderedMusicFolderNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          musicFolderMembers,
          musicPlayerNodeId,
          onCreateMusicPlayerNode,
          onLocateMusicPlayerNode,
          onToggleMusicFolderExpanded,
          onUpdateMusicNode,
        },
      };
      return setDependencyCachedNode(
        node,
        renderedMusicFolderNode,
        dependencyKey,
        dependencies,
      );
    }

    if (nodeWithConnectionState.data.kind === "musicPlayer") {
      const sources = musicSourcesByPlayerId.get(nodeWithConnectionState.id) ?? [];
      const source = sources.find(
        (item) => item.id === nodeWithConnectionState.data.musicSourceNodeId,
      ) ?? sources[0];
      const musicSources = sources.map((item) => ({
        id: item.id,
        title: item.data.title || item.data.fileName || "未命名音乐",
      }));
      const dependencyKey = JSON.stringify({
        coverUrl: source?.data.coverUrl,
        fileId: source?.data.fileId,
        fileName: source?.data.fileName,
        fileSize: source?.data.fileSize,
        mimeType: source?.data.mimeType,
        musicLyricsOverlayOpen:
          musicLyricsOverlayPlayerNodeId === nodeWithConnectionState.id,
        musicSourceNodeId: source?.id,
        musicSources,
        originalUrl: source?.data.originalUrl,
        previewUrl: source?.data.previewUrl,
        projectId,
        shared: getSharedDerivedStateKey(nodeWithConnectionState),
      });
      const dependencies = [
        onCreateMusicChildNode,
        onEnsureMusicPlayback,
        onEnsureMusicWaveform,
        onSeekMusicPlayer,
        onSelectAdjacentMusicSource,
        onSelectMusicSource,
        onToggleMusicLyricsOverlay,
        onToggleMusicPlayback,
        onUpdateMusicNode,
        onUpdateMusicPlayback,
      ];
      const cached = getDependencyCachedNode(node, dependencyKey, dependencies);
      if (cached) return cached;
      const renderedMusicPlayerNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          projectId,
          title: "音乐播放器",
          coverUrl: source?.data.coverUrl,
          fileId: source?.data.fileId,
          fileName: source?.data.fileName,
          fileSize: source?.data.fileSize,
          mimeType: source?.data.mimeType,
          originalUrl: source?.data.originalUrl,
          previewUrl: source?.data.previewUrl,
          musicSourceNodeId: source?.id,
          musicLyricsOverlayOpen:
            musicLyricsOverlayPlayerNodeId === nodeWithConnectionState.id,
          musicSources,
          onCreateMusicChildNode,
          onEnsureMusicPlayback,
          onEnsureMusicWaveform,
          onSeekMusicPlayer,
          onSelectAdjacentMusicSource,
          onSelectMusicSource,
          onToggleMusicLyricsOverlay,
          onToggleMusicPlayback,
          onUpdateMusicNode,
          onUpdateMusicPlayback,
        },
      };
      return setDependencyCachedNode(
        node,
        renderedMusicPlayerNode,
        dependencyKey,
        dependencies,
      );
    }

    if (nodeWithConnectionState.data.kind === "lyrics") {
      const player = playerByChildId.get(nodeWithConnectionState.id);
      const dependencyKey = JSON.stringify({
        musicCurrentTime: player?.data.musicCurrentTime,
        musicParentPlayerNodeId:
          player?.id ?? nodeWithConnectionState.data.musicParentPlayerNodeId,
        projectId,
        shared: getSharedDerivedStateKey(nodeWithConnectionState),
      });
      const dependencies = [
        onSeekMusicPlayer,
        onToggleMusicChildExpanded,
        onUpdateMusicNode,
      ];
      const cached = getDependencyCachedNode(node, dependencyKey, dependencies);
      if (cached) return cached;
      const renderedLyricsNode = {
        ...nodeWithConnectionState,
        style: {
          height: 176,
          width: 560,
          ...(nodeWithConnectionState.style ?? {}),
        },
        data: {
          ...nodeWithConnectionState.data,
          projectId,
          title: "歌词",
          musicCurrentTime: player?.data.musicCurrentTime,
          musicParentPlayerNodeId: player?.id ?? nodeWithConnectionState.data.musicParentPlayerNodeId,
          musicLyrics: nodeWithConnectionState.data.musicLyrics ?? [],
          onSeekMusicPlayer,
          onToggleMusicChildExpanded,
          onUpdateMusicNode,
        },
      };
      return setDependencyCachedNode(
        node,
        renderedLyricsNode,
        dependencyKey,
        dependencies,
      );
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
      const taskParentId =
        taskRelationships.parentIdByChildId.get(nodeWithConnectionState.id);
      const taskParent = taskParentId ? nodeById.get(taskParentId) : undefined;
      const taskParentName = taskParent?.data.name?.trim() || undefined;
      const dependencyKey = JSON.stringify({
        projectTagColors,
        projectTags,
        shared: getSharedDerivedStateKey(nodeWithConnectionState),
        taskChildren,
        taskParentId,
        taskParentName,
        taskProgress,
      });
      const dependencies = [
        onLocateTaskNode,
        onRequestTaskParentOptions,
        onSetTaskParent,
        onToggleTaskChildren,
        onUpdateProjectTag,
        onUpdateTaskNode,
      ];
      const cached = getDependencyCachedNode(node, dependencyKey, dependencies);
      if (cached) return cached;

      const renderedTaskNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onLocateTaskNode,
          onRequestTaskParentOptions,
          onSetTaskParent,
          onUpdateProjectTag,
          onUpdateTaskNode,
          onToggleTaskChildren,
          projectTagColors,
          projectTags,
          taskChildren,
          taskParentId,
          taskParentName,
          taskProgress,
        },
      };
      return setDependencyCachedNode(
        node,
        renderedTaskNode,
        dependencyKey,
        dependencies,
      );
    }

    if (nodeWithConnectionState.data.kind === "managedText") {
      const dependencyKey = JSON.stringify({
        projectTagColors,
        projectTags,
        shared: getSharedDerivedStateKey(nodeWithConnectionState),
      });
      const dependencies = [
        onCreateTextChildNode,
        onSubmitTextGenerationNode,
        onToggleTextExpanded,
        onUpdateProjectTag,
        onUpdateTextGenerationNode,
        onUpdateTextNode,
      ];
      const cached = getDependencyCachedNode(node, dependencyKey, dependencies);
      if (cached) return cached;

      const renderedManagedTextNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onCreateTextChildNode,
          onSubmitTextGenerationNode,
          onToggleTextExpanded,
          onUpdateProjectTag,
          onUpdateTextGenerationNode,
          onUpdateTextNode,
          projectTagColors,
          projectTags,
        },
      };
      return setDependencyCachedNode(
        node,
        renderedManagedTextNode,
        dependencyKey,
        dependencies,
      );
    }

    if (
      nodeWithConnectionState.data.kind === "text" ||
      nodeWithConnectionState.data.kind === "markdown" ||
      nodeWithConnectionState.data.kind === "code"
    ) {
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onCreateTextChildNode === onCreateTextChildNode &&
        cached.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onToggleTextExpanded === onToggleTextExpanded &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        cached.onUpdateTextNode === onUpdateTextNode &&
        hasSameSharedDerivedState(cached.node, nodeWithConnectionState)
      ) {
        return cached.node;
      }

      const renderedTextNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onCreateTextChildNode,
          onSubmitTextGenerationNode,
          onToggleTextExpanded,
          onUpdateTextGenerationNode,
          onUpdateTextNode,
        },
      };

      renderedNodeCache.set(node, {
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
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        hasSameSharedDerivedState(cached.node, nodeWithConnectionState)
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

      renderedNodeCache.set(node, {
        node: renderedTextGenerationNode,
        onSubmitTextGenerationNode,
        onUpdateTextGenerationNode,
      });

      return renderedTextGenerationNode;
    }

    if (nodeWithConnectionState.data.kind === "imageGeneration") {
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onSubmitImageNode === onSubmitImageNode &&
        cached.onToggleImagePromptExpanded === onToggleImagePromptExpanded &&
        cached.onUpdateImageNode === onUpdateImageNode &&
        cached.sourceEdges === edges &&
        cached.sourceNodes === nodes &&
        hasSameSharedDerivedState(cached.node, nodeWithConnectionState)
      ) {
        return cached.node;
      }

      const renderedImageGenerationNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onSubmitImageNode,
          onToggleImagePromptExpanded,
          onUpdateImageNode,
        },
      };

      renderedNodeCache.set(node, {
        node: renderedImageGenerationNode,
        onSubmitImageNode,
        onToggleImagePromptExpanded,
        onUpdateImageNode,
        sourceEdges: edges,
        sourceNodes: nodes,
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
      const cached = renderedNodeCache.get(node);
      if (
        cached &&
        cached.onSubmitVideoNode === onSubmitVideoNode &&
        cached.onUpdateVideoNode === onUpdateVideoNode &&
        hasSameSharedDerivedState(cached.node, normalizedVideoNode)
      ) return cached.node;

      const renderedVideoNode = {
        ...normalizedVideoNode,
        data: {
          ...normalizedVideoNode.data,
          onSubmitVideoNode,
          onUpdateVideoNode,
        },
      };
      renderedNodeCache.set(node, {
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
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onSubmitImageNode === onSubmitImageNode &&
        cached.onCreateDerivedImageNode === onCreateDerivedImageNode &&
        cached.onUpdateImageNode === onUpdateImageNode &&
        cached.sourceEdges === edges &&
        cached.sourceNodes === nodes &&
        hasSameSharedDerivedState(cached.node, generatedImageNode)
      ) {
        return cached.node;
      }

      const renderedGeneratedImageNode = {
        ...generatedImageNode,
        data: {
          ...generatedImageNode.data,
          onCreateDerivedImageNode,
          onSubmitImageNode,
          onUpdateImageNode,
        },
      };

      renderedNodeCache.set(node, {
        node: renderedGeneratedImageNode,
        onCreateDerivedImageNode,
        onSubmitImageNode,
        onUpdateImageNode,
        sourceEdges: edges,
        sourceNodes: nodes,
      });

      return renderedGeneratedImageNode;
    }

    if (nodeWithConnectionState.data.kind === "image") {
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onUpdateImageNode === onUpdateImageNode &&
        cached.onCreateDerivedImageNode === onCreateDerivedImageNode &&
        hasSameSharedDerivedState(cached.node, nodeWithConnectionState)
      ) {
        return cached.node;
      }

      const renderedImageNode = {
        ...nodeWithConnectionState,
        data: {
          ...nodeWithConnectionState.data,
          onCreateDerivedImageNode,
          onUpdateImageNode,
        },
      };

      renderedNodeCache.set(node, {
        node: renderedImageNode,
        onCreateDerivedImageNode,
        onUpdateImageNode,
      });

      return renderedImageNode;
    }

    if (nodeWithConnectionState.data.kind === "note") {
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        hasSameSharedDerivedState(cached.node, nodeWithConnectionState)
      ) {
        return cached.node;
      }

      const renderedNoteNode = {
        ...nodeWithConnectionState,
        dragHandle: ".zenme-node-title-bar, .zenme-node-drag-border",
        data: {
          ...nodeWithConnectionState.data,
          onSubmitTextGenerationNode,
          onUpdateTextGenerationNode,
        },
      };

      renderedNodeCache.set(node, {
        node: renderedNoteNode,
        onSubmitTextGenerationNode,
        onUpdateTextGenerationNode,
      });

      return renderedNoteNode;
    }

    if (nodeWithConnectionState.data.kind === "agent") {
      const cached = renderedNodeCache.get(node);

      if (
        cached?.onSubmitTextGenerationNode === onSubmitTextGenerationNode &&
        cached.onToggleAiResponseExpanded === onToggleAiResponseExpanded &&
        cached.onUpdateTextGenerationNode === onUpdateTextGenerationNode &&
        hasSameSharedDerivedState(cached.node, nodeWithConnectionState)
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

      renderedNodeCache.set(node, {
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
    const cached = renderedNodeCache.get(node);

    if (
      cached?.createNoteNode === createNoteNode &&
      cached.projectId === projectId &&
      cached.toggleReaderCollapse === toggleReaderCollapse &&
      hasSameSharedDerivedState(cached.node, readerNode)
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

    renderedNodeCache.set(node, {
      createNoteNode,
      node: renderedReaderNode,
      projectId,
      toggleReaderCollapse,
    });

    return renderedReaderNode;
  });
}
