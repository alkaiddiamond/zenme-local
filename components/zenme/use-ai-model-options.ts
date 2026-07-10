"use client";

import { useEffect, useState } from "react";

import { modelOptions as fallbackModelOptions } from "@/lib/zenme";

export type AiModelOption = {
  id: string;
  label: string;
};

export function createModelOption(id: string, label = id): AiModelOption {
  return { id, label };
}

export async function rememberAiModelPreference(
  modality: "image" | "text",
  modelId: string,
) {
  await fetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      modality === "image"
        ? { lastImageModelId: modelId }
        : { lastTextModelId: modelId },
    ),
  }).catch(() => undefined);
}

export function useAiModelOptions(modality: "image" | "text" = "text") {
  const [models, setModels] = useState<AiModelOption[]>(
    modality === "text"
      ? fallbackModelOptions.map((id) => createModelOption(id))
      : [],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      try {
        const response = await fetch(`/api/ai/models?modality=${modality}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          data?: Array<{ id?: string; label?: string }>;
        };
        const nextModels = Array.from(
          new Set(
            (payload.data ?? [])
              .map((item) => item.id?.trim())
              .filter((id): id is string => Boolean(id)),
          ),
        ).map((id) => {
          const item = payload.data?.find((model) => model.id?.trim() === id);
          return createModelOption(id, item?.label?.trim() || id);
        });

        if (!cancelled && nextModels.length > 0) {
          setModels(nextModels);
        }
      } catch {
        // Keep the static fallback available when settings cannot be loaded.
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
    };
  }, [modality]);

  return models;
}
