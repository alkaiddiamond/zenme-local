export type OcrProvider = "local-model" | "tencent";

export function getDefaultOcrProvider(env: NodeJS.ProcessEnv = process.env): OcrProvider {
  if (env.READING_OCR_PROVIDER === "tencent") {
    return "tencent";
  }
  if (env.READING_OCR_PROVIDER === "local-model") {
    return "local-model";
  }
  return env.TENCENT_CLOUD_SECRET_ID && env.TENCENT_CLOUD_SECRET_KEY
    ? "tencent"
    : "local-model";
}

export function getAllowedOcrProviders(
  env: NodeJS.ProcessEnv = process.env,
): OcrProvider[] {
  const configured = env.READING_OCR_ALLOWED_PROVIDERS?.split(",")
    .map((provider) => provider.trim())
    .filter((provider): provider is OcrProvider =>
      provider === "local-model" || provider === "tencent",
    );

  return configured?.length ? configured : [getDefaultOcrProvider(env)];
}

export function resolveOcrProvider(input: {
  requestedProvider?: OcrProvider;
  env?: NodeJS.ProcessEnv;
}) {
  const provider = input.requestedProvider ?? getDefaultOcrProvider(input.env);
  if (!getAllowedOcrProviders(input.env).includes(provider)) {
    return { error: "不支持的 OCR 服务", provider: null };
  }

  return { error: null, provider };
}
