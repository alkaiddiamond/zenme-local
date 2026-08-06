import type { ModelConfig } from "@/lib/local/settings";

export function mergeSyncedOpenAiModels(
  syncedModels: ModelConfig[],
  existingModels: ModelConfig[],
) {
  const existingById = new Map(
    existingModels.map((model) => [model.id, model]),
  );

  return syncedModels.map((syncedModel) => {
    const existingModel = existingById.get(syncedModel.id);
    if (!existingModel) {
      return syncedModel;
    }

    return {
      ...syncedModel,
      alias: existingModel.alias,
      contextWindow:
        syncedModel.contextWindow ?? existingModel.contextWindow,
      enabled: existingModel.enabled,
      modalities: Array.from(
        new Set([
          ...existingModel.modalities,
          ...syncedModel.modalities,
        ]),
      ),
    };
  });
}
