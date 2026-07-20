import type { CanvasSnapshotPayload } from "@/lib/zenme";
import {
  normalizeTaskComplexity,
  normalizeTaskPriority,
  normalizeTaskStatus,
  normalizeTaskUrgency,
} from "@/components/zenme/node-types";

type JsonObject = Record<string, unknown>;

export type CanvasMigrationResult = {
  migrated: boolean;
  snapshot: CanvasSnapshotPayload;
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function migrateCanvasSnapshot(value: unknown): CanvasMigrationResult | null {
  if (!isObject(value)) return null;
  if (
    (value.version !== 1 && value.version !== 2 && value.version !== 3) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !isObject(value.viewport) ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  if (value.version === 3) {
    return splitPlayerAnalysisJobs(value);
  }

  const legacy = value.version === 1 ? migrateVersionOne(value) : value;
  const migrated = splitPlayerAnalysisJobs(migrateMusicWorkflow(legacy) as unknown as JsonObject);
  return { migrated: true, snapshot: migrated.snapshot };
}

function splitPlayerAnalysisJobs(value: JsonObject): CanvasMigrationResult {
  const nodes = (value.nodes as unknown[]).map((node) => isObject(node) && isObject(node.data)
    ? { ...node, data: { ...node.data } }
    : node);
  const edges = (value.edges as unknown[]).map((edge) => isObject(edge) ? { ...edge } : edge);
  let migrated = false;
  const taskIds = new Set(
    nodes.flatMap((node) =>
      isObject(node) &&
      typeof node.id === "string" &&
      isObject(node.data) &&
      node.data.kind === "task"
        ? [node.id]
        : [],
    ),
  );
  const legacyTaskParentByChildId = new Map<string, string>();
  for (const edge of edges) {
    if (
      isObject(edge) &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      edge.source !== edge.target &&
      taskIds.has(edge.source) &&
      taskIds.has(edge.target) &&
      !(
        edge.sourceHandle === "node-context" &&
        edge.targetHandle === "node-context-target"
      ) &&
      !legacyTaskParentByChildId.has(edge.target)
    ) {
      legacyTaskParentByChildId.set(edge.target, edge.source);
    }
    if (
      isObject(edge) &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      edge.source !== edge.target &&
      taskIds.has(edge.source) &&
      taskIds.has(edge.target) &&
      edge.sourceHandle === "node-context" &&
      edge.targetHandle === "node-context-target" &&
      !legacyTaskParentByChildId.has(edge.source)
    ) {
      legacyTaskParentByChildId.set(edge.source, edge.target);
    }
  }

  for (const rawPlayer of [...nodes]) {
    if (!isObject(rawPlayer) || !isObject(rawPlayer.data) || rawPlayer.data.kind !== "musicPlayer" || typeof rawPlayer.id !== "string") continue;
    const jobId = rawPlayer.data.musicJobId;
    if (typeof jobId !== "string") continue;
    const existingOwner = nodes.some((node) =>
      isObject(node) &&
      isObject(node.data) &&
      node.data.musicParentPlayerNodeId === rawPlayer.id &&
      node.data.musicJobId === jobId,
    );
    if (!existingOwner) {
      const position = isObject(rawPlayer.position) ? rawPlayer.position : {};
      const analysisId = `legacy-analysis:${rawPlayer.id}:${jobId}`;
      nodes.push({
        id: analysisId,
        type: "musicAnalysis",
        position: {
          x: typeof position.x === "number" ? position.x + 600 : 600,
          y: typeof position.y === "number" ? position.y + 120 : 120,
        },
        data: {
          kind: "musicAnalysis",
          title: `${stripLegacyPlayerSuffix(rawPlayer.data.title)} · 综合分析`,
          musicParentPlayerNodeId: rawPlayer.id,
          projectId: rawPlayer.data.projectId,
          ...takeAnalysisJobData(rawPlayer.data),
        },
      });
      ensureEdge(edges, `legacy-analysis-edge:${rawPlayer.id}:${jobId}`, rawPlayer.id, analysisId);
    }
    for (const key of Object.keys(takeAnalysisJobData(rawPlayer.data))) delete rawPlayer.data[key];
    migrated = true;
  }

  for (const rawNode of nodes) {
    if (!isObject(rawNode) || !isObject(rawNode.data)) {
      continue;
    }
    if (
      rawNode.data.kind === "imageGeneration" &&
      !rawNode.data.imageGenerationResult &&
      isObject(rawNode.style) &&
      rawNode.style.height === 176 &&
      rawNode.style.width === 560
    ) {
      rawNode.style = {
        ...rawNode.style,
        height: 260,
        width: 520,
      };
      if (rawNode.height === 176) rawNode.height = 260;
      if (rawNode.width === 560) rawNode.width = 520;
      delete rawNode.measured;
      migrated = true;
    }
    if (rawNode.data.kind !== "task") {
      continue;
    }
    if (
      typeof rawNode.id === "string" &&
      typeof rawNode.data.taskParentId !== "string"
    ) {
      const legacyParentId = legacyTaskParentByChildId.get(rawNode.id);
      if (legacyParentId) {
        rawNode.data.taskParentId = legacyParentId;
        migrated = true;
      }
    }
    const nextTaskMetadata = {
      taskStatus: normalizeTaskStatus(rawNode.data.taskStatus),
      taskPriority: normalizeTaskPriority(rawNode.data.taskPriority),
      taskComplexity: normalizeTaskComplexity(rawNode.data.taskComplexity),
      taskUrgency: normalizeTaskUrgency(rawNode.data.taskUrgency),
    };
    if (
      rawNode.data.taskStatus !== nextTaskMetadata.taskStatus ||
      rawNode.data.taskPriority !== nextTaskMetadata.taskPriority ||
      rawNode.data.taskComplexity !== nextTaskMetadata.taskComplexity ||
      rawNode.data.taskUrgency !== nextTaskMetadata.taskUrgency
    ) {
      Object.assign(rawNode.data, nextTaskMetadata);
      migrated = true;
    }
  }

  return {
    migrated,
    snapshot: {
      version: 3,
      nodes: nodes as CanvasSnapshotPayload["nodes"],
      edges: edges as CanvasSnapshotPayload["edges"],
      viewport: value.viewport as CanvasSnapshotPayload["viewport"],
      updatedAt: value.updatedAt as string,
    },
  };
}

function migrateVersionOne(value: JsonObject) {
  const rawEdges = value.edges as unknown[];
  const rawNodes = value.nodes as unknown[];
  const incomingSources = new Map<string, string[]>();
  for (const edge of rawEdges) {
    if (!isObject(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") {
      continue;
    }
    incomingSources.set(edge.target, [
      ...(incomingSources.get(edge.target) ?? []),
      edge.source,
    ]);
  }

  const nodes = rawNodes.map((rawNode) => {
    if (!isObject(rawNode) || !isObject(rawNode.data)) return rawNode;
    const node = { ...rawNode };
    const data = { ...rawNode.data };
    const legacyFieldMap = {
      imageEditAspectRatio: "imageOutputAspectRatio",
      imageEditError: "imageError",
      imageEditModel: "imageModel",
      imageEditPrompt: "imagePrompt",
      imageEditQuality: "imageQuality",
      imageEditStatus: "imageStatus",
    } as const;
    for (const [legacyKey, currentKey] of Object.entries(legacyFieldMap)) {
      if (data[currentKey] === undefined && data[legacyKey] !== undefined) {
        data[currentKey] = data[legacyKey];
      }
      delete data[legacyKey];
    }
    if (data.kind === "image" && data.imageGenerated && !data.imageOperation) {
      data.imageOperation = data.sourceImageUrl ? "edit" : "generate";
    }
    delete data.sourceImageUrl;
    delete data.sourceImageTitle;
    const isLegacyImageEdit = data.kind === "imageEdit" || node.type === "imageEdit";
    if (!isLegacyImageEdit) {
      node.data = data;
      return node;
    }

    const nodeId = typeof node.id === "string" ? node.id : "";
    const existingReferences = Array.isArray(data.imageReferenceNodeIds)
      ? data.imageReferenceNodeIds.filter((id): id is string => typeof id === "string")
      : [];

    data.kind = "imageGeneration";
    data.imageOperation = "generate";
    data.imageReferenceNodeIds = existingReferences.length > 0
      ? existingReferences
      : incomingSources.get(nodeId) ?? [];
    if (data.title === "图片编辑" || typeof data.title !== "string") {
      data.title = "图片生成";
    }

    node.type = "imageGeneration";
    node.data = data;
    node.height = 260;
    node.width = 520;
    node.style = { ...(isObject(node.style) ? node.style : {}), height: 260, width: 520 };
    delete node.measured;
    return node;
  });

  return {
    version: 2,
    nodes,
    edges: rawEdges,
    viewport: value.viewport,
    updatedAt: value.updatedAt,
  };
}

function migrateMusicWorkflow(value: JsonObject): CanvasSnapshotPayload {
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : [];
  const rawEdges = Array.isArray(value.edges) ? value.edges : [];
  const nodes = rawNodes.map((node) => isObject(node) && isObject(node.data)
    ? { ...node, data: { ...node.data } }
    : node);
  const nodeById = new Map<string, JsonObject>();
  for (const node of nodes) {
    if (isObject(node) && typeof node.id === "string") nodeById.set(node.id, node);
  }
  const edges = rawEdges.map((edge) => isObject(edge) ? { ...edge } : edge);

  for (const musicNode of [...nodeById.values()]) {
    if (!isObject(musicNode.data) || musicNode.data.kind !== "music" || typeof musicNode.id !== "string") continue;
    const playerId = `music-player:${musicNode.id}`;
    let player = nodeById.get(playerId);
    if (!player) {
      const position = isObject(musicNode.position) ? musicNode.position : {};
      player = {
        id: playerId,
        type: "musicPlayer",
        position: {
          x: typeof position.x === "number" ? position.x + 460 : 460,
          y: typeof position.y === "number" ? position.y : 0,
        },
        data: {
          kind: "musicPlayer",
          title: `${typeof musicNode.data.title === "string" ? musicNode.data.title : "音乐"} · 播放器`,
          projectId: musicNode.data.projectId,
          musicPlayerNodeId: playerId,
          ...takeMusicJobData(musicNode.data),
        },
      };
      nodes.push(player);
      nodeById.set(playerId, player);
    }
    ensureEdge(edges, `music-source-edge:${musicNode.id}:${playerId}`, musicNode.id, playerId);

    for (const edge of edges) {
      if (!isObject(edge) || edge.source !== musicNode.id || typeof edge.target !== "string") continue;
      const child = nodeById.get(edge.target);
      if (!child || !isObject(child.data) || !["lyrics", "musicAnalysis", "sunoPrompt"].includes(String(child.data.kind))) continue;
      edge.source = playerId;
      child.data.musicParentPlayerNodeId = playerId;
      if (isObject(player.data) && typeof player.data.musicJobId === "string") child.data.musicJobId = player.data.musicJobId;
    }

    for (const key of Object.keys(takeMusicJobData(musicNode.data))) delete musicNode.data[key];
  }

  return {
    version: 3,
    nodes,
    edges,
    viewport: value.viewport as CanvasSnapshotPayload["viewport"],
    updatedAt: value.updatedAt as string,
  };
}

function takeMusicJobData(data: JsonObject) {
  const keys = [
    "musicJobId", "musicJobStatus", "musicProgress", "musicStage", "musicStageLabel",
    "musicRetryable", "musicError", "musicDuration", "musicWaveform", "musicWaveformVersion",
    "musicWarnings", "musicJobCreatedAt", "musicJobStartedAt", "musicJobCompletedAt",
    "musicJobElapsedMs", "musicJobDurationMs",
  ];
  return Object.fromEntries(keys.flatMap((key) => data[key] === undefined ? [] : [[key, data[key]]]));
}

function takeAnalysisJobData(data: JsonObject) {
  const keys = [
    "musicJobId", "musicJobStatus", "musicProgress", "musicStage", "musicStageLabel",
    "musicRetryable", "musicError",
    "musicWarnings", "musicJobCreatedAt", "musicJobStartedAt", "musicJobCompletedAt",
    "musicJobElapsedMs", "musicJobDurationMs",
  ];
  return Object.fromEntries(keys.flatMap((key) => data[key] === undefined ? [] : [[key, data[key]]]));
}

function stripLegacyPlayerSuffix(value: unknown) {
  return (typeof value === "string" ? value : "音乐").replace(/\s*·\s*播放器$/, "");
}

function ensureEdge(edges: unknown[], id: string, source: string, target: string) {
  if (edges.some((edge) => isObject(edge) && edge.source === source && edge.target === target)) return;
  edges.push({ id, source, target });
}
