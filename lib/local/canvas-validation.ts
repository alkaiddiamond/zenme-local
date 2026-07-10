import type { CanvasSnapshotPayload } from "@/lib/zenme";

export const MAX_CANVAS_SNAPSHOT_BYTES = 20 * 1024 * 1024;
export const MAX_CANVAS_NODES = 5_000;
export const MAX_CANVAS_EDGES = 10_000;
export const MAX_CANVAS_THUMBNAIL_BYTES = 5 * 1024 * 1024;

export function isValidCanvasSnapshot(value: unknown): value is CanvasSnapshotPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<CanvasSnapshotPayload>;
  if (
    snapshot.version !== 1 ||
    !Array.isArray(snapshot.nodes) ||
    snapshot.nodes.length > MAX_CANVAS_NODES ||
    !Array.isArray(snapshot.edges) ||
    snapshot.edges.length > MAX_CANVAS_EDGES ||
    !snapshot.viewport ||
    typeof snapshot.updatedAt !== "string" ||
    Number.isNaN(Date.parse(snapshot.updatedAt))
  ) {
    return false;
  }
  const { x, y, zoom } = snapshot.viewport;
  return [x, y, zoom].every(
    (number) => typeof number === "number" && Number.isFinite(number),
  ) && zoom > 0 && zoom <= 8;
}
