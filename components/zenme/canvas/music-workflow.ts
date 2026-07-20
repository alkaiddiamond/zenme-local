import type { Edge } from "@xyflow/react";

import type {
  CanvasNodeData,
  MusicChildNodeKind,
  MusicLyricLine,
} from "@/components/zenme/node-types";

import type { CanvasNode } from "./types";

const CHILD_OFFSETS: Record<MusicChildNodeKind, { x: number; y: number }> = {
  lyrics: { x: 600, y: -360 },
  musicAnalysis: { x: 600, y: 120 },
  sunoPrompt: { x: 600, y: 760 },
};

const PRODUCT_PROFILES = {
  lyrics: "lyrics-structure",
  musicAnalysis: "comprehensive-analysis",
  sunoPrompt: "suno-prompt",
} as const satisfies Record<MusicChildNodeKind, string>;

const LEGACY_CAPABILITIES: Record<MusicChildNodeKind, string[]> = {
  lyrics: ["metadata", "waveform", "structure", "rhythm", "downbeats", "meter", "lyrics"],
  musicAnalysis: [
    "metadata", "waveform", "stems", "structure", "key", "chords", "rhythm",
    "genre", "mood", "instruments", "notes", "downbeats", "meter", "stem_rhythm",
    "arrangement", "mix", "vocal_features",
  ],
  sunoPrompt: [
    "metadata", "structure", "key", "chords", "rhythm", "genre", "mood",
    "instruments", "arrangement", "mix", "vocal_features", "lyrics", "suno_prompt",
  ],
};

export type MusicServiceCapabilities = {
  profiles?: Array<{ id?: unknown }>;
};

export const MUSIC_WAVEFORM_VERSION = 2;

export function musicPlayerNodeId(musicNodeId: string) {
  return `music-player:${musicNodeId}`;
}

export function musicChildNodeId(playerNodeId: string, kind: MusicChildNodeKind) {
  return `music-child:${playerNodeId}:${kind}`;
}

export function resolveMusicSourceNode(input: {
  edges: Edge[];
  nodes: CanvasNode[];
  playerNodeId: string;
}) {
  const sourceIds = new Set(
    input.edges
      .filter((edge) => edge.target === input.playerNodeId)
      .map((edge) => edge.source),
  );
  return input.nodes.find(
    (node) => sourceIds.has(node.id) && node.data.kind === "music",
  );
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

export function musicCapabilitiesFor(kind: MusicChildNodeKind) {
  if (kind === "lyrics") {
    return ["lyrics", "structure"];
  }
  if (kind === "sunoPrompt") {
    return ["suno_prompt"];
  }
  return [
    "structure", "key", "chords", "rhythm",
    "genre", "mood", "instruments", "notes", "downbeats", "meter", "stem_rhythm",
    "arrangement", "mix", "vocal_features",
  ];
}

export function musicJobRequestFor(
  kind: MusicChildNodeKind,
  serviceCapabilities?: MusicServiceCapabilities | null,
) {
  const profile = PRODUCT_PROFILES[kind];
  if (serviceSupportsProfile(serviceCapabilities, profile)) {
    return { capabilities: musicCapabilitiesFor(kind), profile };
  }
  return { capabilities: [...LEGACY_CAPABILITIES[kind]], profile: "complete" };
}

export function musicPlayerPreviewRequest(
  serviceCapabilities?: MusicServiceCapabilities | null,
) {
  if (serviceSupportsProfile(serviceCapabilities, "player-preview")) {
    return { capabilities: ["metadata", "waveform"], profile: "player-preview" };
  }
  return { capabilities: ["metadata", "waveform"], profile: "complete" };
}

function serviceSupportsProfile(
  serviceCapabilities: MusicServiceCapabilities | null | undefined,
  profile: string,
) {
  return serviceCapabilities?.profiles?.some((item) => item.id === profile) === true;
}

export function createMusicPlayerUpdate(input: {
  edges: Edge[];
  musicNode: CanvasNode;
  nodes: CanvasNode[];
  projectId: string;
}) {
  const id = musicPlayerNodeId(input.musicNode.id);
  const existing = input.nodes.find(
    (node) => node.id === id || (
      node.data.kind === "musicPlayer" &&
      node.data.musicPlayerNodeId === id
    ),
  );
  if (existing) {
    return { createdEdges: [], createdNodes: [], focusNodeId: existing.id };
  }

  const node: CanvasNode = {
    id,
    type: "musicPlayer",
    position: {
      x: input.musicNode.position.x + 460,
      y: input.musicNode.position.y,
    },
    data: {
      kind: "musicPlayer",
      title: `${input.musicNode.data.title} · 播放器`,
      projectId: input.projectId,
      musicPlayerNodeId: id,
      musicLoop: false,
      musicMuted: false,
      musicPlaybackRate: 1,
      musicVolume: 1,
    },
  };
  const edge: Edge = {
    id: `music-source-edge:${input.musicNode.id}:${id}`,
    source: input.musicNode.id,
    target: id,
  };
  return { createdEdges: [edge], createdNodes: [node], focusNodeId: id };
}

export function createMusicChildUpdate(input: {
  edges: Edge[];
  kind: MusicChildNodeKind;
  nodes: CanvasNode[];
  playerNode: CanvasNode;
  position?: { x: number; y: number };
  projectId: string;
}) {
  const id = `${musicChildNodeId(input.playerNode.id, input.kind)}:${crypto.randomUUID()}`;

  const offset = CHILD_OFFSETS[input.kind];
  const result = input.playerNode.data.musicAnalysisResult;
  const prompt = result?.sunoPrompt as {
    en?: string;
    promptEn?: string;
    promptZh?: string;
    zh?: string;
  } | undefined;
  const titleSuffix = {
    lyrics: "歌词与结构",
    musicAnalysis: "综合分析",
    sunoPrompt: "Suno 提示词",
  }[input.kind];
  const data: CanvasNodeData = {
    kind: input.kind,
    title: `${stripPlayerSuffix(input.playerNode.data.title)} · ${titleSuffix}`,
    projectId: input.projectId,
    musicJobStatus: "queued",
    musicProgress: 0,
    musicStage: "creating",
    musicStageLabel: "正在创建分析任务",
    musicJobCreatedAt: new Date().toISOString(),
    musicJobStartedAt: new Date().toISOString(),
    musicJobElapsedMs: 0,
    musicParentPlayerNodeId: input.playerNode.id,
    ...(input.kind === "lyrics"
      ? { musicLyrics: extractMusicLyrics(result) }
      : {}),
    ...(input.kind === "musicAnalysis"
      ? { musicAnalysisResult: result }
      : {}),
    ...(input.kind === "sunoPrompt"
      ? {
          sunoPromptEn: prompt?.promptEn ?? prompt?.en,
          sunoPromptZh: prompt?.promptZh ?? prompt?.zh,
        }
      : {}),
  };
  const node: CanvasNode = {
    id,
    type: input.kind,
    position: {
      x: input.position?.x ?? input.playerNode.position.x + offset.x,
      y: input.position?.y ?? input.playerNode.position.y + offset.y,
    },
    style: { height: 176, width: 560 },
    data,
  };
  const edge: Edge = {
    id: `music-child-edge:${input.playerNode.id}:${input.kind}`,
    source: input.playerNode.id,
    target: id,
  };
  return { createdEdges: [edge], createdNodes: [node], focusNodeId: id };
}

export function extractMusicLyrics(
  result: Record<string, unknown> | undefined,
): MusicLyricLine[] {
  if (!result || !Array.isArray(result.lyrics)) return [];
  const segments = Array.isArray(result.segments) ? result.segments : [];
  return result.lyrics.flatMap((value, index) => {
    if (!value || typeof value !== "object") return [];
    const line = value as Record<string, unknown>;
    if (typeof line.start !== "number" || typeof line.text !== "string") return [];
    const start = line.start;
    const section = segments.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const segment = candidate as Record<string, unknown>;
      return typeof segment.start === "number" &&
        typeof segment.end === "number" &&
        start >= segment.start &&
        start < segment.end;
    }) as Record<string, unknown> | undefined;
    return [{
      end: typeof line.end === "number" ? line.end : undefined,
      id: typeof line.id === "string" ? line.id : `lyric-${index}-${start}`,
      section: typeof section?.label === "string" ? section.label : undefined,
      start,
      text: line.text,
    }];
  });
}

function stripPlayerSuffix(title: string) {
  return title.replace(/\s*·\s*播放器$/, "");
}
