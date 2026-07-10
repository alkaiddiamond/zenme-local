export const DEFAULT_IMAGE_EDIT_ASPECT_RATIO = "16:9";
export const DEFAULT_IMAGE_EDIT_QUALITY = "1K";

export const IMAGE_EDIT_ASPECT_RATIO_OPTIONS = [
  {
    label: "自适应",
    prompt: "保持与参考图片一致的自然宽高比。",
    value: "auto",
  },
  {
    label: "1:1",
    prompt: "输出为 1:1 正方形构图。",
    value: "1:1",
  },
  {
    label: "9:16",
    prompt: "输出为 9:16 竖向构图。",
    value: "9:16",
  },
  {
    label: "16:9",
    prompt: "输出为 16:9 横向构图。",
    value: "16:9",
  },
  {
    label: "3:4",
    prompt: "输出为 3:4 竖向构图。",
    value: "3:4",
  },
  {
    label: "4:3",
    prompt: "输出为 4:3 横向构图。",
    value: "4:3",
  },
] as const;

export const IMAGE_EDIT_QUALITY_OPTIONS = [
  {
    label: "512P",
    prompt: "输出为较小尺寸，适合快速预览，约 512P 清晰度。",
    value: "512P",
  },
  {
    label: "1K",
    prompt: "输出为中等尺寸，适合常规使用，约 1K 清晰度。",
    value: "1K",
  },
  {
    label: "2K",
    prompt: "输出为高分辨率，适合细节检查，约 2K 清晰度。",
    value: "2K",
  },
  {
    label: "4K",
    prompt: "输出为超高分辨率，保留丰富细节，约 4K 清晰度。",
    value: "4K",
  },
] as const;

export type ImageEditAspectRatio =
  (typeof IMAGE_EDIT_ASPECT_RATIO_OPTIONS)[number]["value"];
export type ImageEditQuality =
  (typeof IMAGE_EDIT_QUALITY_OPTIONS)[number]["value"];

export function getImageEditAspectRatioOption(value?: string) {
  return (
    IMAGE_EDIT_ASPECT_RATIO_OPTIONS.find((option) => option.value === value) ??
    IMAGE_EDIT_ASPECT_RATIO_OPTIONS.find(
      (option) => option.value === DEFAULT_IMAGE_EDIT_ASPECT_RATIO,
    ) ??
    IMAGE_EDIT_ASPECT_RATIO_OPTIONS[0]
  );
}

export function getImageEditQualityOption(value?: string) {
  return (
    IMAGE_EDIT_QUALITY_OPTIONS.find((option) => option.value === value) ??
    IMAGE_EDIT_QUALITY_OPTIONS.find(
      (option) => option.value === DEFAULT_IMAGE_EDIT_QUALITY,
    ) ??
    IMAGE_EDIT_QUALITY_OPTIONS[0]
  );
}

export function buildImageEditPrompt(input: {
  aspectRatio?: string;
  prompt: string;
  quality?: string;
}) {
  const aspectRatio = getImageEditAspectRatioOption(input.aspectRatio);
  const quality = getImageEditQualityOption(input.quality);

  return [
    "系统提示：",
    "你是 Zenme 的专业图片编辑模型。你的任务是基于参考图片执行编辑，而不是重新创作一张与参考图无关的新图片。",
    "",
    "图片编辑原则：",
    "- 严格遵循用户的编辑指令，只修改用户明确要求修改的内容。",
    "- 尽可能保持参考图片的主体完整性，包括主体身份、数量、姿态、结构、服装/材质、关键细节和空间关系。",
    "- 尽可能保持原图的构图逻辑、透视、光照方向、镜头感、景深、色彩关系和背景环境，除非用户明确要求改变。",
    "- 不要无故裁切、遮挡、替换、增删或重绘主体；不要改变主体的核心外观和可识别特征。",
    "- 如果用户要求改变风格或尺寸，应在满足该要求的同时最大限度保留原图主体和关键内容。",
    "",
    "输出尺寸与分辨率要求：",
    `- ${aspectRatio.prompt}`,
    `- ${quality.prompt}`,
    "- 如果尺寸要求需要扩展画布，优先自然延展背景，不要压缩或扭曲主体。",
    "- 如果尺寸要求需要裁切，必须优先保留主体完整和关键视觉信息。",
    "",
    "用户编辑指令：",
    input.prompt.trim(),
  ].join("\n");
}

export function getImageEditResultNodeSize(aspectRatio?: string) {
  const value = getImageEditAspectRatioOption(aspectRatio).value;
  const targetArea = 280 * 280;
  const ratio =
    value === "1:1"
      ? 1
      : value === "9:16"
        ? 9 / 16
        : value === "16:9"
          ? 16 / 9
          : value === "3:4"
            ? 3 / 4
            : value === "4:3"
              ? 4 / 3
              : 3 / 4;
  const width = Math.round(Math.sqrt(targetArea * ratio));
  const height = Math.round(width / ratio);

  return {
    height: Math.max(190, Math.min(height, 380)),
    width: Math.max(220, Math.min(width, 420)),
  };
}
