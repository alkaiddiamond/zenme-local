"use client";

import { useEffect, useState } from "react";

import {
  getModelIdFromReference,
  parseProviderModelReference,
} from "@/lib/ai/model-reference";

export type AiModelOption = {
  id: string;
  label: string;
  tooltip: string;
};

type AiModelModality = "image" | "text" | "video";

const MODEL_PREFERENCE_EVENT = "zenme:ai-model-preference";
const MODEL_OPTIONS_EVENT = "zenme:ai-model-options";
const preferredModelCache: Partial<Record<AiModelModality, string>> = {};
const modelOptionsCache: Partial<Record<AiModelModality, AiModelOption[]>> = {};

export function createModelOption(
  id: string,
  label = id,
  tooltip = label,
): AiModelOption {
  return { id, label, tooltip };
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
    body: JSON.stringify(modality === "image"
      ? { lastImageModelId: modelId }
      : modality === "video"
        ? { lastVideoModelId: modelId }
        : { lastTextModelId: modelId }),
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
    () => modelOptionsCache[modality] ?? [],
  );

  useEffect(() => {
    function handlePreferenceChange(event: Event) {
      const detail = (event as CustomEvent<{
        modality?: AiModelModality;
        modelId?: string;
      }>).detail;
      if (detail?.modality !== modality || !detail.modelId) {
        return;
      }

      preferredModelCache[modality] = detail.modelId;
      setModels((current) => {
        const nextModels = orderModelOptionsByPreference(
          current,
          detail.modelId,
        );
        modelOptionsCache[modality] = nextModels;
        return nextModels;
      });
    }

    function handleModelOptionsChange(event: Event) {
      const detail = (event as CustomEvent<{
        modality?: AiModelModality;
        models?: AiModelOption[];
      }>).detail;
      if (detail?.modality !== modality || !detail.models) return;
      setModels(detail.models);
    }

    window.addEventListener(MODEL_PREFERENCE_EVENT, handlePreferenceChange);
    window.addEventListener(MODEL_OPTIONS_EVENT, handleModelOptionsChange);

    async function loadModels() {
      try {
        const response = await fetch(`/api/ai/models?modality=${modality}`, {
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as {
          data?: Array<{
            id?: string;
            label?: string;
            modelId?: string;
            providerName?: string;
          }>;
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
          const label = item?.label?.trim() || id;
          const providerName = item?.providerName?.trim();
          const modelId = item?.modelId?.trim();
          return createModelOption(
            id,
            label,
            providerName && modelId ? `${providerName} · ${modelId}` : label,
          );
        });

        const preferredModelId =
          payload.preferredModelId ?? preferredModelCache[modality];
        if (preferredModelId) {
          preferredModelCache[modality] = preferredModelId;
        }
        const orderedModels = orderModelOptionsByPreference(
          nextModels,
          preferredModelId,
        );
        modelOptionsCache[modality] = orderedModels;
        window.dispatchEvent(
          new CustomEvent(MODEL_OPTIONS_EVENT, {
            detail: { modality, models: orderedModels },
          }),
        );
      } catch {
        // Keep the selector empty when settings cannot be loaded.
      }
    }

    void loadModels();

    return () => {
      window.removeEventListener(
        MODEL_PREFERENCE_EVENT,
        handlePreferenceChange,
      );
      window.removeEventListener(
        MODEL_OPTIONS_EVENT,
        handleModelOptionsChange,
      );
    };
  }, [modality]);

  return models;
}
