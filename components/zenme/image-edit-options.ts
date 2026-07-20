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

function getAspectRatioPromptLines(value: string, operation: "edit" | "generate") {
  const option = getImageEditAspectRatioOption(value);

  if (option.value === "auto") {
    return operation === "edit"
      ? [
          `- 节点选择的比例为“${option.label}”：${option.prompt}`,
          "- 最终输出画布必须保持参考图片的真实宽高比，不得改用模型默认比例。",
        ]
      : [
          `- 节点选择的比例为“${option.label}”：根据用户描述选择自然、合理的宽高比。`,
        ];
  }

  return [
    `- 节点选择的比例为“${option.label}”：${option.prompt}`,
    `- 最终输出画布必须严格符合 ${option.value} 宽高比，不得返回参考图比例或模型默认比例。`,
  ];
}

export function buildImageEditPrompt(input: {
  aspectRatio?: string;
  prompt: string;
  quality?: string;
  referenceCount?: number;
}) {
  return [
    buildImageEditSystemPrompt(input),
    "",
    "用户编辑指令：",
    input.prompt.trim(),
  ].join("\n");
}

export function buildImageGenerationSystemPrompt(input: {
  aspectRatio?: string;
  quality?: string;
}) {
  const aspectRatio = getImageEditAspectRatioOption(input.aspectRatio);
  const quality = getImageEditQualityOption(input.quality);

  return [
    "你是专业图片生成助手。你必须调用创建图片功能，将用户的描述生成成一张完整图片，而不是只回复文字或解释方案。",
    "",
    "图片生成要求：",
    "- 准确落实用户描述中的主体、环境、风格、构图、光照、色彩和文字要求。",
    "- 如果提供了参考图片，应将其作为主体、外观、风格、构图或细节参考，并以用户指令说明的修改目标为准。",
    "- 画面应完整、清晰、结构合理；不要无故省略用户明确要求的主体或关键细节。",
    "- 除非用户明确要求，不要在图片中添加水印、边框、说明文字或品牌标识。",
    "",
    "输出尺寸与分辨率要求：",
    ...getAspectRatioPromptLines(aspectRatio.value, "generate"),
    `- ${quality.prompt}`,
    "- 必须按照所选宽高比直接构图，不得通过黑边、白边、透明边或空白留边伪造目标比例。",
  ].join("\n");
}

export function buildImageEditSystemPrompt(input: {
  aspectRatio?: string;
  quality?: string;
  referenceCount?: number;
}) {
  const aspectRatio = getImageEditAspectRatioOption(input.aspectRatio);
  const quality = getImageEditQualityOption(input.quality);

  return [
    "你是专业参考图生成助手。你必须调用图片编辑功能处理所提供的参考图片并输出一张完整图片，而不是只回复文字。",
    "",
    "参考图处理原则：",
    "- 根据用户指令判断任务意图：用户要求局部修改时执行精确编辑；用户要求重新构图、改变风格或生成新画面时，以参考图为基础重新生成。",
    "- 精确编辑时只修改用户明确要求的内容，保持未指定区域、主体身份、数量、姿态、结构和关键细节。",
    "- 基于参考重新生成时，应提取用户所指的主体、外观、风格、构图或细节特征，并按用户的新要求组织画面。",
    "- 多张参考图可能承担不同作用，应结合用户指令判断每张图用于主体、造型、风格、场景或构图参考。",
    "- 除非用户明确要求，不要无故丢失参考图中的核心主体和可识别特征。",
    ...(input.referenceCount && input.referenceCount > 1
      ? [
          "",
          "多参考图编号与角色约束：",
          `- 当前请求包含 ${input.referenceCount} 张参考图片；图片编号严格按照接口输入顺序，从“第一张图片”开始依次编号，不得交换、重排或混淆。`,
          "- 用户提到“第一张、第二张、图一、图二”等编号时，必须严格对应上述输入顺序。",
          "- 当用户要求把第一张图片中的服装、配饰或其他局部元素替换为第二张图片的对应元素时：第一张图片是主体底图，必须保留第一张人物的身份、面部、发型、年龄、体型、姿态、构图和背景；第二张图片只提供被指定替换的局部元素，不得把第二张人物的身份、面部、发型、年龄、姿态或整体构图复制到结果中。",
          "- 不得融合、平均或互换不同参考图中的人物身份。若用户未明确要求更换人物，最终人物身份必须来自主体底图。",
        ]
      : []),
    "",
    "输出尺寸与分辨率要求：",
    ...getAspectRatioPromptLines(aspectRatio.value, "edit"),
    `- ${quality.prompt}`,
    "- 必须按照所选宽高比直接构图，不得通过黑边、白边、透明边或空白留边伪造目标比例。",
    "- 如果尺寸要求需要扩展画布，优先自然延展背景，不要压缩或扭曲主体。",
    "- 如果尺寸要求需要裁切，必须优先保留主体完整和关键视觉信息。",
  ].join("\n");
}

export function getImageEditResultNodeSize(aspectRatio?: string) {
  const value = getImageEditAspectRatioOption(aspectRatio).value;
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

  return getImageDisplaySize(ratio);
}

export function getImageDisplaySize(aspectRatio?: number) {
  const referenceDiagonal = Math.hypot(280, 280);
  const safeRatio = typeof aspectRatio === "number" && Number.isFinite(aspectRatio) && aspectRatio > 0
    ? aspectRatio
    : 3 / 4;
  // 所有图片框内接于同一个参考圆，因此对角线恒定并完整保留真实宽高比。
  const scale = referenceDiagonal / Math.sqrt(safeRatio ** 2 + 1);
  const height = Math.round(scale);
  const width = Math.round(scale * safeRatio);

  return {
    height,
    width,
  };
}
