"use client";

import { useEffect, useState } from "react";

import {
  getModelIdFromReference,
  parseProviderModelReference,
} from "@/lib/ai/model-reference";

export type AiModelOption = {
  id: string;
  label: string;
};

type AiModelModality = "image" | "text";

const MODEL_PREFERENCE_EVENT = "zenme:ai-model-preference";
const preferredModelCache: Partial<Record<AiModelModality, string>> = {};

export function createModelOption(id: string, label = id): AiModelOption {
  return { id, label };
}

export function resolveAiModelOptionId(
  models: AiModelOption[],
  currentModelId: string,
) {
  if (!parseProviderModelReference(currentModelId)) {
    const scopedMatch = models.find(
      (model) =>
        Boolean(parseProviderModelReference(model.id)) &&
        getModelIdFromReference(model.id) === currentModelId,
    );
    if (scopedMatch) return scopedMatch.id;
  }

  return currentModelId;
}

export async function rememberAiModelPreference(
  modality: AiModelModality,
  modelId: string,
) {
  preferredModelCache[modality] = modelId;
  window.dispatchEvent(
    new CustomEvent(MODEL_PREFERENCE_EVENT, {
      detail: { modality, modelId },
    }),
  );

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

export function orderModelOptionsByPreference(
  models: AiModelOption[],
  preferredModelId?: string | null,
) {
  if (!preferredModelId) {
    return models;
  }

  const preferredModel = models.find((model) => model.id === preferredModelId);
  return preferredModel
    ? [preferredModel, ...models.filter((model) => model.id !== preferredModelId)]
    : models;
}

export function useAiModelOptions(modality: AiModelModality = "text") {
  const [models, setModels] = useState<AiModelOption[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;

    function handlePreferenceChange(event: Event) {
      const detail = (event as CustomEvent<{
        modality?: AiModelModality;
        modelId?: string;
      }>).detail;
      if (detail?.modality !== modality || !detail.modelId) {
        return;
      }

      preferredModelCache[modality] = detail.modelId;
      setModels((current) =>
        orderModelOptionsByPreference(current, detail.modelId),
      );
    }

    window.addEventListener(MODEL_PREFERENCE_EVENT, handlePreferenceChange);

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
          preferredModelId?: string | null;
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

        if (!cancelled) {
          const preferredModelId =
            payload.preferredModelId ?? preferredModelCache[modality];
          if (preferredModelId) {
            preferredModelCache[modality] = preferredModelId;
          }
          setModels(
            orderModelOptionsByPreference(nextModels, preferredModelId),
          );
        }
      } catch {
        // Keep the selector empty when settings cannot be loaded.
      }
    }

    void loadModels();

    return () => {
      cancelled = true;
      window.removeEventListener(
        MODEL_PREFERENCE_EVENT,
        handlePreferenceChange,
      );
    };
  }, [modality]);

  return models;
}
