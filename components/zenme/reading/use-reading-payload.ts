import { useEffect, useState } from "react";

import {
  loadReadingPayload,
  type ReadingLoadProgress,
} from "./api";
import type { ReadingPayload } from "./types";

export function useReadingPayload(input: {
  assetId: string;
  onLoaded: (payload: ReadingPayload) => void;
}) {
  const { assetId, onLoaded } = input;
  const [payload, setPayload] = useState<ReadingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<ReadingLoadProgress>({
    loadedBytes: 0,
    phase: "downloading",
    totalBytes: null,
  });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setPayload(null);
    setError(null);
    setLoadProgress({
      loadedBytes: 0,
      phase: "downloading",
      totalBytes: null,
    });

    loadReadingPayload(assetId, {
      onProgress(progress) {
        if (!cancelled) setLoadProgress(progress);
      },
      signal: controller.signal,
    })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        onLoaded(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "阅读资料加载失败");
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [assetId, onLoaded]);

  return {
    error,
    loadProgress,
    payload,
    setError,
    setPayload,
  };
}
