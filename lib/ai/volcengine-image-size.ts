import { getImageEditAspectRatioOption } from "@/components/zenme/image-edit-options";

const SEEDREAM_2K_SIZES = {
  "1:1": "2048x2048",
  "9:16": "1600x2848",
  "16:9": "2848x1600",
  "3:4": "1728x2304",
  "4:3": "2304x1728",
} as const;

const SEEDREAM_3K_SIZES = {
  "1:1": "3072x3072",
  "9:16": "2304x4096",
  "16:9": "4096x2304",
  "3:4": "2592x3456",
  "4:3": "3456x2592",
} as const;

export function getVolcengineSeedreamSize(input: {
  aspectRatio?: string;
  quality?: string;
}) {
  const aspectRatio = getImageEditAspectRatioOption(input.aspectRatio).value;
  const resolution = input.quality === "4K" ? "3K" : "2K";

  if (aspectRatio === "auto") {
    return resolution;
  }

  return resolution === "3K"
    ? SEEDREAM_3K_SIZES[aspectRatio]
    : SEEDREAM_2K_SIZES[aspectRatio];
}
