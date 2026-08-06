import type { ReadingProgress } from "@/lib/reading/types";

import { getNormalizedContentScale } from "./layout";

export function getScrollRatioFromElement(
  container: Pick<HTMLElement, "clientHeight" | "scrollHeight" | "scrollTop">,
) {
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (maxScrollTop <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, container.scrollTop / maxScrollTop));
}

export function normalizeLoadedReadingProgress(
  progress: ReadingProgress | null | undefined,
) {
  const savedSection = progress?.sectionIndex ?? 0;
  const sectionIndex = Number.isFinite(savedSection) ? savedSection : 0;

  return {
    contentScale: getNormalizedContentScale(progress?.contentScale ?? 1),
    scrollRatio: Math.min(1, Math.max(0, progress?.scrollRatio ?? 0)),
    sectionIndex,
  };
}

export function canPersistReadingProgress(
  readyAssetId: string | null,
  assetId: string,
) {
  return readyAssetId === assetId;
}
