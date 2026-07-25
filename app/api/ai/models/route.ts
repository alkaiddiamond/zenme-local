import { NextResponse } from "next/server";

import { getProviderModelSelections } from "@/lib/ai/provider-model-resolution";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { getLocalSettings } from "@/lib/local/settings";

export async function GET(request: Request) {
  try {
    const user = { id: "local" };
    const userLimitResponse = checkRateLimit({
      key: `ai-models:user:${user.id}`,
      limit: 60,
      windowMs: 60_000,
    });
    if (userLimitResponse) {
      return userLimitResponse;
    }

    const ipLimitResponse = checkRateLimit({
      key: `ai-models:ip:${getClientIp(request)}`,
      limit: 120,
      windowMs: 60_000,
    });
    if (ipLimitResponse) {
      return ipLimitResponse;
    }

    const url = new URL(request.url);
    const requestedModality = url.searchParams.get("modality");
    const modality = requestedModality === "image" || requestedModality === "video"
      ? requestedModality
      : "text";
    const settings = await getLocalSettings().catch(() => null);
    const configuredModels = settings
      ? getProviderModelSelections(settings.modelProviders, modality)
      : [];
    const models = configuredModels;
    const preferredModelId = modality === "image"
      ? settings?.lastImageModelId
      : modality === "video"
        ? settings?.lastVideoModelId
        : settings?.lastTextModelId;
    const preferredModel = preferredModelId
      ? models.find((model) => model.id === preferredModelId) ??
        [...models].reverse().find(
          (model) =>
            "modelId" in model && model.modelId === preferredModelId,
        )
      : undefined;
    const orderedModels = preferredModel
      ? [
          preferredModel,
          ...models.filter((model) => model.id !== preferredModel.id),
        ]
      : models;

    return NextResponse.json({
      data: orderedModels.map((model) => ({
        id: model.id,
        label: model.label,
        modelId: model.modelId,
        object: "model",
        providerName: model.provider.name,
      })),
      preferredModelId: orderedModels[0]?.id ?? null,
    });
  } catch {
    return NextResponse.json(
      { error: "模型列表加载失败" },
      { status: 500 },
    );
  }
}
