const CONTENT_SCALE_MIN = 0.75;
const CONTENT_SCALE_MAX = 1.8;

export function normalizeReadingContentScale(value: number) {
  return Math.round(clamp(value, CONTENT_SCALE_MIN, CONTENT_SCALE_MAX) * 10) / 10;
}

export function normalizeReadingScrollRatio(value: number) {
  return clamp(value, 0, 1);
}

export function normalizeReadingSectionIndex(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
