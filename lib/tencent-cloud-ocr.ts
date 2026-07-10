import crypto from "node:crypto";

export type TencentOcrAction = "GeneralAccurateOCR" | "GeneralBasicOCR";

export type TencentOcrResult = {
  raw: unknown;
  text: string;
  textDetections: Array<{
    confidence?: number;
    detectedText: string;
  }>;
};

type TencentOcrResponse = {
  Response?: {
    Error?: {
      Code?: string;
      Message?: string;
    };
    TextDetections?: Array<{
      Confidence?: number;
      DetectedText?: string;
    }>;
  };
};

const OCR_ENDPOINT = "ocr.tencentcloudapi.com";
const OCR_SERVICE = "ocr";
const OCR_VERSION = "2018-11-19";

export async function recognizeTencentCloudOcr(input: {
  action?: TencentOcrAction;
  imageBase64: string;
  region?: string;
}) {
  const secretId = process.env.TENCENT_CLOUD_SECRET_ID;
  const secretKey = process.env.TENCENT_CLOUD_SECRET_KEY;
  const region =
    input.region || process.env.TENCENT_CLOUD_REGION || "ap-guangzhou";

  if (!secretId || !secretKey) {
    throw new Error("缺少腾讯云 OCR 环境变量");
  }

  const action = input.action ?? "GeneralAccurateOCR";
  const payload = JSON.stringify({
    ImageBase64: input.imageBase64,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const authorization = createTencentCloudAuthorization({
    action,
    payload,
    secretId,
    secretKey,
    timestamp,
  });

  const response = await fetch(`https://${OCR_ENDPOINT}`, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: OCR_ENDPOINT,
      "X-TC-Action": action,
      "X-TC-Region": region,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": OCR_VERSION,
    },
    body: payload,
  });

  const data = (await response.json().catch(() => null)) as
    | TencentOcrResponse
    | null;
  const upstreamError = data?.Response?.Error;

  if (!response.ok || upstreamError) {
    throw new Error(
      upstreamError?.Message ||
        upstreamError?.Code ||
        `腾讯云 OCR 调用失败：${response.status}`,
    );
  }

  const textDetections =
    data?.Response?.TextDetections?.map((item) => ({
      confidence: item.Confidence,
      detectedText: item.DetectedText ?? "",
    })).filter((item) => item.detectedText.trim()) ?? [];

  return {
    raw: data,
    text: textDetections.map((item) => item.detectedText).join("\n"),
    textDetections,
  } satisfies TencentOcrResult;
}

function createTencentCloudAuthorization(input: {
  action: TencentOcrAction;
  payload: string;
  secretId: string;
  secretKey: string;
  timestamp: number;
}) {
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${OCR_ENDPOINT}\n`;
  const signedHeaders = "content-type;host";
  const hashedRequestPayload = sha256(input.payload);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload,
  ].join("\n");
  const credentialScope = `${date}/${OCR_SERVICE}/tc3_request`;
  const hashedCanonicalRequest = sha256(canonicalRequest);
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(input.timestamp),
    credentialScope,
    hashedCanonicalRequest,
  ].join("\n");
  const secretDate = hmac(`TC3${input.secretKey}`, date);
  const secretService = hmac(secretDate, OCR_SERVICE);
  const secretSigning = hmac(secretService, "tc3_request");
  const signature = crypto
    .createHmac("sha256", secretSigning)
    .update(stringToSign)
    .digest("hex");

  return [
    "TC3-HMAC-SHA256",
    `Credential=${input.secretId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: string | Buffer, value: string) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}
