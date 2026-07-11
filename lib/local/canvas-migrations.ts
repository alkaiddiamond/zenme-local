import type { CanvasSnapshotPayload } from "@/lib/zenme";

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
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.edges) ||
    !isObject(value.viewport) ||
    typeof value.updatedAt !== "string"
  ) {
    return null;
  }

  if (value.version === 2) {
    return { migrated: false, snapshot: value as CanvasSnapshotPayload };
  }

  const incomingSources = new Map<string, string[]>();
  for (const edge of value.edges) {
    if (!isObject(edge) || typeof edge.source !== "string" || typeof edge.target !== "string") {
      continue;
    }
    incomingSources.set(edge.target, [
      ...(incomingSources.get(edge.target) ?? []),
      edge.source,
    ]);
  }

  const nodes = value.nodes.map((rawNode) => {
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
    migrated: true,
    snapshot: {
      version: 2,
      nodes,
      edges: value.edges,
      viewport: value.viewport as CanvasSnapshotPayload["viewport"],
      updatedAt: value.updatedAt,
    },
  };
}
