import { NextResponse } from "next/server";

import { checkRateLimit, getClientIp } from "@/lib/api/rate-limit";
import { recognizeLocalModelOcr } from "@/lib/local-model-ocr";
import { resolveOcrProvider, type OcrProvider } from "@/lib/reading/ocr-policy";
import {
  recognizeTencentCloudOcr,
  type TencentOcrAction,
} from "@/lib/tencent-cloud-ocr";

type OcrRequestBody = {
  action?: TencentOcrAction;
  imageBase64?: string;
  provider?: OcrProvider;
};

const MAX_BASE64_LENGTH = 12 * 1024 * 1024;
const OCR_PROVIDER_ERROR_MESSAGE = "OCR 识别失败，请稍后重试";

export async function POST(request: Request) {
  try {
    const user = { id: "local" };
    const userLimitResponse = checkRateLimit({
      key: `reading-ocr:user:${user.id}`,
      limit: 20,
      windowMs: 60_000,
    });
    if (userLimitResponse) {
      return userLimitResponse;
    }

    const ipLimitResponse = checkRateLimit({
      key: `reading-ocr:ip:${getClientIp(request)}`,
      limit: 50,
      windowMs: 60_000,
    });
    if (ipLimitResponse) {
      return ipLimitResponse;
    }

    const body = (await request.json()) as OcrRequestBody;
    const imageBase64 = normalizeImageBase64(body.imageBase64);

    if (!imageBase64) {
      return NextResponse.json({ error: "缺少 OCR 图片" }, { status: 400 });
    }

    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: "OCR 图片过大，请缩小框选区域后重试" },
        { status: 400 },
      );
    }

    const { error: providerError, provider } = resolveOcrProvider({
      requestedProvider: body.provider,
    });
    if (providerError || !provider) {
      return NextResponse.json(
        { error: providerError ?? "不支持的 OCR 服务" },
        { status: 400 },
      );
    }

    const result =
      provider === "local-model"
        ? await recognizeLocalModelOcr(imageBase64)
        : await recognizeTencentCloudOcr({
            action: body.action,
            imageBase64,
          });

    return NextResponse.json({
      provider,
      text: cleanOcrText(result.text),
      textDetections: result.textDetections,
    });
  } catch {
    return NextResponse.json(
      { error: OCR_PROVIDER_ERROR_MESSAGE },
      { status: 500 },
    );
  }
}

function normalizeImageBase64(value: string | undefined) {
  if (!value) return "";
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function cleanOcrText(text: string) {
  if (!text) return "";
  const cjk = "一-鿿㐀-䶿　-〿＀-￯";
  const cjkSpacePattern = new RegExp(`([${cjk}])\\s+(?=[${cjk}])`, "g");
  return text
    .replace(cjkSpacePattern, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .trim();
}
