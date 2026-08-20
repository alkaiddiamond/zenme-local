import { NextResponse } from "next/server";

import {
  createVolcengineAgentPlanImageRequestBody,
  generateConfiguredImage,
  ImageGenerationServiceError,
  isImageGenerationTimeoutError,
} from "@/lib/ai/image-generation-service";
import type { ImageCameraControl } from "@/components/zenme/image-edit-options";

const DEFAULT_ERROR_MESSAGE = "图片生成或编辑失败，请稍后重试";

type ImageRequestBody = {
  aspectRatio?: string;
  cameraControl?: Partial<ImageCameraControl>;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  model?: string;
  operation?: "edit" | "generate";
  prompt?: string;
  quality?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ImageRequestBody;
    const prompt = body.prompt?.trim();
    const model = body.model?.trim();
    const imageDataUrl = body.imageDataUrl?.trim();
    const imageDataUrls = [
      ...(imageDataUrl ? [imageDataUrl] : []),
      ...(body.imageDataUrls ?? []),
    ].map((value) => value.trim()).filter(Boolean).slice(0, 8);

    if (!prompt) return NextResponse.json({ error: "缺少图片生成或编辑指令" }, { status: 400 });
    if (!model) return NextResponse.json({ error: "缺少图片模型" }, { status: 400 });
    if (imageDataUrls.some((value) => !value.startsWith("data:image/"))) {
      return NextResponse.json({ error: "参考图片格式无效" }, { status: 400 });
    }

    const result = await generateConfiguredImage({
      aspectRatio: body.aspectRatio,
      cameraControl: body.cameraControl,
      imageDataUrls,
      model,
      operation: body.operation,
      prompt,
      quality: body.quality,
    });
    return NextResponse.json({
      b64Json: result.b64Json,
      mediaType: result.mediaType,
      model: result.model,
      revisedPrompt: result.revisedPrompt,
      usage: result.usage,
    });
  } catch (error) {
    console.error("[image-api] Image request failed", error);
    const message = error instanceof ImageGenerationServiceError
      ? error.publicMessage
      : isImageGenerationTimeoutError(error)
        ? "图片任务执行超过 15 分钟，已停止等待。原有图片不会被清除，可以直接重试"
        : DEFAULT_ERROR_MESSAGE;
    const status = error instanceof ImageGenerationServiceError &&
      ["未启用该图片模型", "未配置可用的图片模型"].includes(error.publicMessage)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export { createVolcengineAgentPlanImageRequestBody };
