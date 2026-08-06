import type { Edge } from "@xyflow/react";

import type { CanvasNodeData, MusicLoopMode, MusicLyricLine } from "@/components/zenme/node-types";

import type { CanvasNode } from "./types";

export const MUSIC_WAVEFORM_VERSION = 3;

export function normalizeMusicLoopMode(
  mode?: MusicLoopMode,
  legacyLoop = false,
): MusicLoopMode {
  if (mode === "one" || mode === "all") return mode;
  if (mode === "off") return "off";
  return legacyLoop ? "one" : "off";
}

export function getNextMusicLoopMode(mode: MusicLoopMode): MusicLoopMode {
  if (mode === "off") return "one";
  if (mode === "one") return "all";
  return "off";
}

export function getNextMusicSourceId(
  sourceIds: string[],
  currentSourceId?: string,
) {
  if (!sourceIds.length) return undefined;
  const currentIndex = currentSourceId
    ? sourceIds.indexOf(currentSourceId)
    : -1;
  return sourceIds[currentIndex < 0 ? 0 : (currentIndex + 1) % sourceIds.length];
}

export function getPreviousMusicSourceId(
  sourceIds: string[],
  currentSourceId?: string,
) {
  if (!sourceIds.length) return undefined;
  const currentIndex = currentSourceId
    ? sourceIds.indexOf(currentSourceId)
    : -1;
  return sourceIds[
    currentIndex < 0
      ? sourceIds.length - 1
      : (currentIndex - 1 + sourceIds.length) % sourceIds.length
  ];
}

export function normalizeMusicPlaybackTimes(
  durationValue?: number,
  currentValue?: number,
) {
  const duration =
    typeof durationValue === "number" &&
    Number.isFinite(durationValue) &&
    durationValue > 0
      ? durationValue
      : 0;
  const current =
    duration > 0 &&
    typeof currentValue === "number" &&
    Number.isFinite(currentValue)
      ? Math.max(0, Math.min(duration, currentValue))
      : 0;

  return { current, duration };
}

export function musicPlayerNodeId(musicNodeId: string) {
  return `music-player:${musicNodeId}`;
}

export function musicChildNodeId(playerNodeId: string) {
  return `music-child:${playerNodeId}:lyrics`;
}

export function resolveMusicSourceNode(input: {
  edges: Edge[];
  nodes: CanvasNode[];
  playerNodeId: string;
  sourceNodeId?: string;
}) {
  const sources = resolveMusicSourceNodes(input);
  return sources.find((node) => node.id === input.sourceNodeId) ?? sources[0];
}

export function resolveMusicSourceNodes(input: {
  edges: Edge[];
  nodes: CanvasNode[];
  playerNodeId: string;
}) {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  return input.edges.flatMap((edge) => {
    if (edge.target !== input.playerNodeId || seen.has(edge.source)) return [];
    const source = nodeById.get(edge.source);
    if (source?.data.kind === "music") {
      seen.add(source.id);
      return [source];
    }
    if (source?.data.kind !== "musicFolder") return [];
    seen.add(source.id);
    const canvasMembers = input.nodes.filter(
      (node) => node.data.kind === "music" && node.data.musicFolderId === source.id,
    );
    const registeredSources: CanvasNode[] = (source.data.musicFolderSources ?? []).map(
      (item) => ({
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
      }),
    );
    return [...registeredSources, ...canvasMembers].filter((node) => {
      if (seen.has(node.id)) return false;
      seen.add(node.id);
      return true;
    });
  });
}

export function createMusicFolderDropUpdate(input: {
  edges: Edge[];
  folderNodeId: string;
  musicNodeId: string;
  nodes: CanvasNode[];
}) {
  const musicNode = input.nodes.find(
    (node) => node.id === input.musicNodeId && node.data.kind === "music",
  );
  const folderNode = input.nodes.find(
    (node) => node.id === input.folderNodeId && node.data.kind === "musicFolder",
  );
  if (!musicNode || !folderNode) return null;

  const existingSources = folderNode.data.musicFolderSources ?? [];
  const alreadyStored = existingSources.some(
    (source) =>
      source.id === musicNode.id ||
      Boolean(source.fileId && source.fileId === musicNode.data.fileId),
  );
  const source = {
    id: musicNode.id,
    fileId: musicNode.data.fileId,
    fileName: musicNode.data.fileName,
    fileSize: musicNode.data.fileSize,
    mimeType: musicNode.data.mimeType,
    originalUrl: musicNode.data.originalUrl,
    title: musicNode.data.title || musicNode.data.fileName || "未命名音乐",
  };
  const updatedFolder: CanvasNode = {
    ...folderNode,
    data: {
      ...folderNode.data,
      musicFolderSources: alreadyStored
        ? existingSources
        : [...existingSources, source],
    },
  };
  const deletedEdges = input.edges.filter(
    (edge) => edge.source === musicNode.id || edge.target === musicNode.id,
  );

  return {
    deletedEdges,
    deletedNode: musicNode,
    nextEdges: input.edges.filter(
      (edge) => edge.source !== musicNode.id && edge.target !== musicNode.id,
    ),
    nextNodes: input.nodes.flatMap((node) => {
      if (node.id === musicNode.id) return [];
      return [node.id === folderNode.id ? updatedFolder : node];
    }),
    updatedFolder,
    previousFolder: folderNode,
  };
}
export function downsampleWaveform(values: number[], targetPoints = 160) {
  const safeValues = values.map((value) => Number.isFinite(value) ? Math.abs(value) : 0);
  if (!safeValues.length) return [];
  const pointCount = Math.max(1, Math.min(targetPoints, safeValues.length));
  const output: number[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    const start = Math.floor((index * safeValues.length) / pointCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * safeValues.length) / pointCount));
    let squareSum = 0;
    for (let sample = start; sample < end; sample += 1) {
      squareSum += safeValues[sample] ** 2;
    }
    output.push(Math.sqrt(squareSum / (end - start)));
  }
  const ordered = [...output].sort((left, right) => left - right);
  const scale = ordered[Math.floor((ordered.length - 1) * 0.98)] || 1;
  return output.map((value) => Math.min(1, value / scale));
}

export function getMusicApiErrorMessage(
  body: unknown,
  fallback = "未找到同步歌词",
) {
  if (!body || typeof body !== "object") return fallback;
  const response = body as { detail?: unknown; error?: unknown; message?: unknown };
  const detailMessage = response.detail && typeof response.detail === "object"
    ? (response.detail as { message?: unknown }).message
    : undefined;
  for (const candidate of [
    typeof response.detail === "string" ? response.detail : undefined,
    detailMessage,
    response.message,
    response.error,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return fallback;
}

export function createMusicPlayerUpdate(input: {
  edges: Edge[];
  /** @deprecated Use sourceNode. */
  musicNode?: CanvasNode;
  sourceNode?: CanvasNode;
  nodes: CanvasNode[];
  projectId: string;
}) {
  const sourceNode = input.sourceNode ?? input.musicNode;
  if (!sourceNode) {
    throw new Error("创建播放器需要音乐或音乐文件夹来源");
  }
  const id = musicPlayerNodeId(sourceNode.id);
  const existing = input.nodes.find(
    (node) => node.id === id || (
      node.data.kind === "musicPlayer" && node.data.musicPlayerNodeId === id
    ),
  );
  if (existing) return { createdEdges: [], createdNodes: [], focusNodeId: existing.id };

  const node: CanvasNode = {
    id,
    type: "musicPlayer",
    position: { x: sourceNode.position.x + 460, y: sourceNode.position.y },
    data: {
      kind: "musicPlayer",
      title: "音乐播放器",
      projectId: input.projectId,
      musicPlayerNodeId: id,
      musicSourceListExpanded: true,
      musicSourceNodeId:
        sourceNode.data.kind === "music" ? sourceNode.id : undefined,
      musicLoop: false,
      musicLoopMode: "off",
      musicMuted: false,
      musicPlaybackRate: 1,
      musicVolume: 1,
    },
  };
  const edge: Edge = {
    id: `music-source-edge:${sourceNode.id}:${id}`,
    source: sourceNode.id,
    target: id,
  };
  return { createdEdges: [edge], createdNodes: [node], focusNodeId: id };
}

export function createLyricsNodeUpdate(input: {
  playerNode: CanvasNode;
  position?: { x: number; y: number };
  projectId: string;
}) {
  const id = `${musicChildNodeId(input.playerNode.id)}:${crypto.randomUUID()}`;
  const data: CanvasNodeData = {
    kind: "lyrics",
    title: "歌词",
    projectId: input.projectId,
    lyricsFetchStatus: "fetching",
    musicParentPlayerNodeId: input.playerNode.id,
  };
  const node: CanvasNode = {
    id,
    type: "lyrics",
    position: {
      x: input.position?.x ?? input.playerNode.position.x + 600,
      y: input.position?.y ?? input.playerNode.position.y - 360,
    },
    style: { height: 176, width: 560 },
    data,
  };
  const edge: Edge = {
    id: `music-child-edge:${input.playerNode.id}:lyrics:${id}`,
    source: input.playerNode.id,
    target: id,
  };
  return { createdEdges: [edge], createdNodes: [node], focusNodeId: id };
}

export function extractMusicLyrics(result: Record<string, unknown> | undefined): MusicLyricLine[] {
  if (!result || !Array.isArray(result.lyrics)) return [];
  return result.lyrics.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const line = value as Record<string, unknown>;
    if (typeof line.start !== "number" || typeof line.text !== "string") return [];
    return [{
      end: typeof line.end === "number" ? line.end : undefined,
      id: typeof line.id === "string" ? line.id : `lyric-${index}-${line.start}`,
      start: line.start,
      text: line.text,
    }];
  });
}
export function findLyricsNodesNeedingRecovery(nodes: CanvasNode[]) {
  return nodes.flatMap((node) =>
    node.data.kind === "lyrics" &&
    node.data.lyricsFetchStatus === "succeeded" &&
    !node.data.musicLyrics?.length &&
    node.data.musicParentPlayerNodeId
      ? [{ childNodeId: node.id, playerNodeId: node.data.musicParentPlayerNodeId }]
      : [],
  );
}

export function findLyricsNodesNeedingRefresh(input: {
  edges: Edge[];
  nodes: CanvasNode[];
}) {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  return input.nodes.flatMap((node) => {
    if (node.data.kind !== "lyrics") return [];
    const playerNodeId = input.edges.find((edge) => {
      if (edge.target !== node.id) return false;
      return nodeById.get(edge.source)?.data.kind === "musicPlayer";
    })?.source ?? node.data.musicParentPlayerNodeId;
    if (!playerNodeId) return [];
    const playerNode = nodeById.get(playerNodeId);
    if (playerNode?.data.kind !== "musicPlayer") return [];
    const sourceNode = resolveMusicSourceNode({
      edges: input.edges,
      nodes: input.nodes,
      playerNodeId,
      sourceNodeId: playerNode.data.musicSourceNodeId,
    });
    const needsMissingLyricsRecovery =
      node.data.musicLyricsSourceNodeId === undefined &&
      node.data.lyricsFetchStatus === "succeeded" &&
      !node.data.musicLyrics?.length;
    if (
      !sourceNode ||
      (node.data.musicLyricsSourceNodeId === sourceNode.id &&
        !needsMissingLyricsRecovery)
    ) return [];
    return [{ childNodeId: node.id, playerNodeId, sourceNodeId: sourceNode.id }];
  });
}
