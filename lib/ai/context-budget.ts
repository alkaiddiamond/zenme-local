export const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
export const DEFAULT_OUTPUT_TOKEN_RESERVE = 8_192;
export const INPUT_TOKEN_SAFETY_RESERVE = 2_048;

export function estimateTextTokenCount(text: string) {
  let tokens = 0;
  let asciiRunLength = 0;

  const flushAsciiRun = () => {
    if (asciiRunLength > 0) {
      tokens += Math.ceil(asciiRunLength / 3.5);
      asciiRunLength = 0;
    }
  };

  for (const character of text) {
    if (character.codePointAt(0)! <= 0x7f) {
      asciiRunLength += 1;
      continue;
    }

    flushAsciiRun();
    tokens += 1;
  }

  flushAsciiRun();
  return tokens;
}

export function getModelContextWindowTokens(contextWindow?: number) {
  return typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
    ? Math.floor(contextWindow)
    : DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;
}

export function getCanvasContextTokenBudget(input: {
  contextWindow?: number;
  prompt?: string;
}) {
  return getModelInputTokenBudget({
    contextWindow: input.contextWindow,
    occupiedInputTokens: estimateTextTokenCount(input.prompt ?? ""),
  });
}

export function getModelInputTokenBudget(input: {
  contextWindow?: number;
  occupiedInputTokens?: number;
}) {
  const contextWindow = getModelContextWindowTokens(input.contextWindow);
  const outputReserve = Math.min(
    32_768,
    Math.max(DEFAULT_OUTPUT_TOKEN_RESERVE, Math.floor(contextWindow * 0.08)),
  );

  return Math.max(
    512,
    contextWindow -
      outputReserve -
      INPUT_TOKEN_SAFETY_RESERVE -
      Math.max(0, input.occupiedInputTokens ?? 0),
  );
}

export function truncateTextToTokenBudget(
  text: string,
  tokenBudget: number,
  marker = "",
) {
  const safeBudget = Math.max(0, Math.floor(tokenBudget));
  if (estimateTextTokenCount(text) <= safeBudget) {
    return text;
  }

  const markerTokens = estimateTextTokenCount(marker);
  if (markerTokens >= safeBudget) {
    return truncateWithoutMarker(marker, safeBudget);
  }

  const contentBudget = safeBudget - markerTokens;
  return `${truncateWithoutMarker(text, contentBudget).trimEnd()}${marker}`;
}

function truncateWithoutMarker(text: string, tokenBudget: number) {
  let low = 0;
  let high = text.length;

  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTextTokenCount(text.slice(0, middle)) <= tokenBudget) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  if (low > 0 && /[\uD800-\uDBFF]/.test(text[low - 1])) {
    low -= 1;
  }
  return text.slice(0, low);
}
