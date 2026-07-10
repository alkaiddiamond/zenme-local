import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { ReadingProgress } from "@/lib/reading/types";

import {
  cacheReadingProgress,
  saveReadingProgress,
} from "./api";
import { getNormalizedContentScale } from "./layout";
import {
  getScrollRatioFromElement,
  normalizeLoadedReadingProgress,
} from "./progress-state";

type PendingProgress = {
  contentScale: number;
  sectionIndex: number;
  scrollRatio: number;
};

export function useReadingProgress(input: {
  assetId: string;
  initialProgress: ReadingProgress | null;
  readerScrollRef: RefObject<HTMLElement | null>;
}) {
  const { assetId, initialProgress, readerScrollRef } = input;
  const [activeSection, setActiveSectionState] = useState(
    () => initialProgress?.sectionIndex ?? 0,
  );
  const [contentScale, setContentScaleState] = useState(() =>
    getNormalizedContentScale(initialProgress?.contentScale ?? 1),
  );
  const activeSectionRef = useRef(initialProgress?.sectionIndex ?? 0);
  const contentScaleRef = useRef(
    getNormalizedContentScale(initialProgress?.contentScale ?? 1),
  );
  const lastSavedSection = useRef(initialProgress?.sectionIndex ?? 0);
  const lastSavedScrollRatio = useRef(initialProgress?.scrollRatio ?? 0);
  const pendingProgress = useRef<PendingProgress | null>(null);
  const progressSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setActiveSection = useCallback((index: number) => {
    activeSectionRef.current = index;
    setActiveSectionState(index);
  }, []);

  const getCurrentScrollRatio = useCallback(() => {
    const container = readerScrollRef.current;
    if (!container) {
      return lastSavedScrollRatio.current;
    }

    return getScrollRatioFromElement(container);
  }, [readerScrollRef]);

  const applyLoadedProgress = useCallback(
    (progress: ReadingProgress | null | undefined) => {
      const normalized = normalizeLoadedReadingProgress(progress);

      activeSectionRef.current = normalized.sectionIndex;
      contentScaleRef.current = normalized.contentScale;
      lastSavedSection.current = normalized.sectionIndex;
      lastSavedScrollRatio.current = normalized.scrollRatio;
      setActiveSectionState(normalized.sectionIndex);
      setContentScaleState(normalized.contentScale);
      cacheReadingProgress({
        assetId,
        contentScale: normalized.contentScale,
        sectionIndex: normalized.sectionIndex,
        scrollRatio: normalized.scrollRatio,
        updatedAt: progress?.updatedAt ?? new Date().toISOString(),
      });

      return {
        scrollRatio: normalized.scrollRatio,
        sectionIndex: normalized.sectionIndex,
      };
    },
    [assetId],
  );

  const flushProgress = useCallback(
    (options?: { keepalive?: boolean }) => {
      const pending = pendingProgress.current;
      const sectionIndex = activeSectionRef.current;
      const scrollRatio = getCurrentScrollRatio();

      if (progressSaveTimer.current !== null) {
        clearTimeout(progressSaveTimer.current);
        progressSaveTimer.current = null;
      }

      pendingProgress.current = null;
      lastSavedSection.current = pending?.sectionIndex ?? sectionIndex;
      lastSavedScrollRatio.current = pending?.scrollRatio ?? scrollRatio;

      void saveReadingProgress(
        assetId,
        pending?.sectionIndex ?? sectionIndex,
        pending?.contentScale ?? contentScaleRef.current,
        pending?.scrollRatio ?? scrollRatio,
        options,
      );
    },
    [assetId, getCurrentScrollRatio],
  );

  const saveProgress = useCallback(
    (
      index: number,
      scale = contentScaleRef.current,
      scrollRatio = getCurrentScrollRatio(),
      options?: { immediate?: boolean; keepalive?: boolean },
    ) => {
      activeSectionRef.current = index;
      contentScaleRef.current = scale;
      lastSavedSection.current = index;
      lastSavedScrollRatio.current = scrollRatio;
      cacheReadingProgress({
        assetId,
        contentScale: scale,
        sectionIndex: index,
        scrollRatio,
        updatedAt: new Date().toISOString(),
      });
      pendingProgress.current = {
        contentScale: scale,
        sectionIndex: index,
        scrollRatio,
      };
      if (progressSaveTimer.current !== null) {
        clearTimeout(progressSaveTimer.current);
        progressSaveTimer.current = null;
      }
      if (options?.immediate) {
        const pending = pendingProgress.current;
        pendingProgress.current = null;
        if (pending) {
          void saveReadingProgress(
            assetId,
            pending.sectionIndex,
            pending.contentScale,
            pending.scrollRatio,
            { keepalive: options.keepalive },
          );
        }
        return;
      }
      progressSaveTimer.current = setTimeout(() => {
        const pending = pendingProgress.current;
        progressSaveTimer.current = null;
        pendingProgress.current = null;
        if (pending) {
          void saveReadingProgress(
            assetId,
            pending.sectionIndex,
            pending.contentScale,
            pending.scrollRatio,
          );
        }
      }, 600);
    },
    [assetId, getCurrentScrollRatio],
  );

  const updateContentScale = useCallback(
    (nextScale: number) => {
      const normalizedScale = getNormalizedContentScale(nextScale);
      contentScaleRef.current = normalizedScale;
      setContentScaleState(normalizedScale);
      saveProgress(
        activeSectionRef.current,
        normalizedScale,
        getCurrentScrollRatio(),
        { immediate: true },
      );
    },
    [getCurrentScrollRatio, saveProgress],
  );

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushProgress({ keepalive: true });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      flushProgress({ keepalive: true });
    };
  }, [flushProgress]);

  return {
    activeSection,
    activeSectionRef,
    applyLoadedProgress,
    contentScale,
    getCurrentScrollRatio,
    lastSavedScrollRatio,
    lastSavedSection,
    saveProgress,
    setActiveSection,
    updateContentScale,
  };
}
