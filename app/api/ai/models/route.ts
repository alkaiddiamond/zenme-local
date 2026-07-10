import { NextResponse } from "next/server";

import { getAllowedAiModels } from "@/lib/ai/request-policy";
import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { getEnabledProviderModels, getLocalSettings } from "@/lib/local/settings";
import { authErrorResponse, requireUser } from "@/lib/supabase/auth";
import { isLocalStorageMode } from "@/lib/utils";

export async function GET(request: Request) {
  try {
    const { user } = await requireAiAccess();
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

    return NextResponse.json({
      data: models.map((model) => ({
        id: model.id,
        label: model.label,
        object: "model",
      })),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) {
      return authResponse;
    }

    return NextResponse.json(
      { error: "模型列表加载失败" },
      { status: 500 },
    );
  }
}

async function requireAiAccess() {
  if (isExplicitLocalStorageMode()) {
    return { user: { id: "local" } };
  }

  return requireUser();
}

function isExplicitLocalStorageMode() {
  return process.env.ZENME_STORAGE_DRIVER === "local" && isLocalStorageMode();
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
