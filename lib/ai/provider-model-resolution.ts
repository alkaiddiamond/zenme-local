import {
  createProviderModelReference,
  parseProviderModelReference,
} from "@/lib/ai/model-reference";
import {
  getEnabledProviderModels,
  type ModelProviderConfig,
} from "@/lib/local/settings";

export type ProviderModelSelection = {
  id: string;
  label: string;
  modelId: string;
  provider: ModelProviderConfig;
};

export function getProviderModelSelections(
  providers: ModelProviderConfig[],
  modality: "image" | "text" | "video",
) {
  const enabledProviders = providers.filter((provider) => provider.enabled);
  const modelIdCounts = new Map<string, number>();

  for (const provider of enabledProviders) {
    for (const model of getEnabledProviderModels(provider, modality)) {
      modelIdCounts.set(model.id, (modelIdCounts.get(model.id) ?? 0) + 1);
    }
  }

  return enabledProviders.flatMap((provider) =>
    getEnabledProviderModels(provider, modality).map((model) => {
      const baseLabel = model.alias?.trim() || model.id;
      const normalizedBaseLabel = baseLabel.toLocaleLowerCase();
      const providerLabelAlreadyPresent =
        normalizedBaseLabel.includes(provider.name.toLocaleLowerCase()) ||
        (provider.apiFormat === "volcengine_agent_plan" &&
          normalizedBaseLabel.includes("agent plan"));
      const label =
        (modelIdCounts.get(model.id) ?? 0) > 1 &&
        !providerLabelAlreadyPresent
          ? `${baseLabel}（${provider.name}）`
          : baseLabel;

      return {
        id: createProviderModelReference(provider.id, model.id),
        label,
        modelId: model.id,
        provider,
      } satisfies ProviderModelSelection;
    }),
  );
}

export function getAllowedProviderModelValues(
  providers: ModelProviderConfig[],
  modality: "image" | "text" | "video",
) {
  const selections = getProviderModelSelections(providers, modality);
  return Array.from(
    new Set([
      ...selections.map((selection) => selection.id),
      ...selections.map((selection) => selection.modelId),
    ]),
  );
}

export function resolveProviderModelSelection(
  value: string,
  providers: ModelProviderConfig[],
  modality: "image" | "text" | "video",
): ProviderModelSelection | null {
  const reference = parseProviderModelReference(value);
  const selections = getProviderModelSelections(providers, modality);

  if (reference) {
    return (
      selections.find(
        (selection) =>
          selection.provider.id === reference.providerId &&
          selection.modelId === reference.modelId,
      ) ?? null
    );
  }

  // 旧版列表以 modelId 去重并保留最后一个服务商的显示名称。
  // 对未带服务商信息的历史节点采用相同顺序，确保实际路由与旧界面显示一致。
  for (let index = selections.length - 1; index >= 0; index -= 1) {
    if (selections[index].modelId === value) {
      return selections[index];
    }
  }

  return null;
}
