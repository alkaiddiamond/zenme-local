const PROVIDER_MODEL_REFERENCE_PREFIX = "provider-model:";

export type ProviderModelReference = {
  modelId: string;
  providerId: string;
};

export function createProviderModelReference(
  providerId: string,
  modelId: string,
) {
  return `${PROVIDER_MODEL_REFERENCE_PREFIX}${encodeURIComponent(providerId)}:${encodeURIComponent(modelId)}`;
}

export function parseProviderModelReference(
  value?: string,
): ProviderModelReference | null {
  if (!value?.startsWith(PROVIDER_MODEL_REFERENCE_PREFIX)) {
    return null;
  }

  const encoded = value.slice(PROVIDER_MODEL_REFERENCE_PREFIX.length);
  const separatorIndex = encoded.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === encoded.length - 1) {
    return null;
  }

  try {
    const providerId = decodeURIComponent(encoded.slice(0, separatorIndex));
    const modelId = decodeURIComponent(encoded.slice(separatorIndex + 1));
    return providerId && modelId ? { modelId, providerId } : null;
  } catch {
    return null;
  }
}

export function getModelIdFromReference(value?: string) {
  if (!value) return "";
  return parseProviderModelReference(value)?.modelId ?? value;
}
