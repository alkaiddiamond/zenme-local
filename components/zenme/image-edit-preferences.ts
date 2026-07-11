import {
  DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
  DEFAULT_IMAGE_EDIT_QUALITY,
  getImageEditAspectRatioOption,
  getImageEditQualityOption,
} from "@/components/zenme/image-edit-options";

const IMAGE_EDIT_PREFERENCES_KEY = "zenme.imageEditPreferences.v1";

export type ImageEditPreferences = {
  aspectRatio: string;
  modelId?: string;
  quality: string;
};

export function getImageEditPreferences(): ImageEditPreferences {
  const fallback = {
    aspectRatio: DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
    quality: DEFAULT_IMAGE_EDIT_QUALITY,
  };
  if (typeof window === "undefined") return fallback;

  try {
    const raw = window.localStorage.getItem(IMAGE_EDIT_PREFERENCES_KEY);
    if (!raw) return fallback;
    const value = JSON.parse(raw) as Partial<ImageEditPreferences>;
    return {
      aspectRatio: getImageEditAspectRatioOption(value.aspectRatio).value,
      modelId:
        typeof value.modelId === "string" && value.modelId.trim()
          ? value.modelId.trim()
          : undefined,
      quality: getImageEditQualityOption(value.quality).value,
    };
  } catch {
    return fallback;
  }
}

export async function rememberImageEditPreferences(
  updates: Partial<ImageEditPreferences>,
) {
  const current = getImageEditPreferences();
  const next: ImageEditPreferences = {
    aspectRatio: getImageEditAspectRatioOption(
      updates.aspectRatio ?? current.aspectRatio,
    ).value,
    modelId: updates.modelId ?? current.modelId,
    quality: getImageEditQualityOption(updates.quality ?? current.quality).value,
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(IMAGE_EDIT_PREFERENCES_KEY, JSON.stringify(next));
  }

  await fetch("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      lastImageAspectRatio: next.aspectRatio,
      lastImageModelId: next.modelId,
      lastImageQuality: next.quality,
    }),
  }).catch(() => undefined);

  return next;
}

export async function hydrateImageEditPreferences() {
  if (typeof window === "undefined") return getImageEditPreferences();
  if (window.localStorage.getItem(IMAGE_EDIT_PREFERENCES_KEY)) {
    return getImageEditPreferences();
  }

  try {
    const response = await fetch("/api/settings", { cache: "no-store" });
    if (!response.ok) return getImageEditPreferences();
    const payload = (await response.json()) as {
      settings?: {
        lastImageAspectRatio?: string;
        lastImageModelId?: string;
        lastImageQuality?: string;
      };
    };
    const preferences: ImageEditPreferences = {
      aspectRatio: getImageEditAspectRatioOption(
        payload.settings?.lastImageAspectRatio,
      ).value,
      modelId: payload.settings?.lastImageModelId,
      quality: getImageEditQualityOption(
        payload.settings?.lastImageQuality,
      ).value,
    };
    window.localStorage.setItem(
      IMAGE_EDIT_PREFERENCES_KEY,
      JSON.stringify(preferences),
    );
    return preferences;
  } catch {
    return getImageEditPreferences();
  }
}
