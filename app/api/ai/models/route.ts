import { NextResponse } from "next/server";

import { getAllowedAiModels } from "@/lib/ai/request-policy";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { getEnabledProviderModels, getLocalSettings } from "@/lib/local/settings";

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
    const modality = url.searchParams.get("modality") === "image" ? "image" : "text";
    const settings = await getLocalSettings().catch(() => null);
    const configuredModels = settings
      ? getConfiguredModels(settings.modelProviders, modality)
      : [];
    const models = configuredModels.length > 0
      ? configuredModels
      : getAllowedAiModels().map((id) => ({ id, label: id }));
    const preferredModelId = modality === "image"
      ? settings?.lastImageModelId
      : settings?.lastTextModelId;
    const orderedModels = preferredModelId && models.some((model) => model.id === preferredModelId)
      ? [
          models.find((model) => model.id === preferredModelId)!,
          ...models.filter((model) => model.id !== preferredModelId),
        ]
      : models;

    return NextResponse.json({
      data: orderedModels.map((model) => ({
        id: model.id,
        label: model.label,
        object: "model",
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

function getConfiguredModels(
  providers: Awaited<ReturnType<typeof getLocalSettings>>["modelProviders"],
  modality: "image" | "text",
) {
  const models = new Map<string, { id: string; label: string }>();

  for (const provider of providers) {
    if (!provider.enabled) {
      continue;
    }

    for (const model of getEnabledProviderModels(provider, modality)) {
      models.set(model.id, {
        id: model.id,
        label: model.alias?.trim() || model.id,
      });
    }
  }

  return Array.from(models.values());
}
