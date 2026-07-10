import { useEffect, useState } from "react";

import { loadReadingPayload } from "./api";
import type { ReadingPayload } from "./types";

export function useReadingPayload(input: {
  assetId: string;
  onLoaded: (payload: ReadingPayload) => void;
}) {
  const { assetId, onLoaded } = input;
  const [payload, setPayload] = useState<ReadingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setError(null);

    loadReadingPayload(assetId)
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
    };
  }, [assetId, onLoaded]);

  return {
    error,
    payload,
    setError,
    setPayload,
  };
}
