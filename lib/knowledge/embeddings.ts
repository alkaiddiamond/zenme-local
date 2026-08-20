import crypto from "node:crypto";

import { normalizeProviderApiBaseUrl } from "@/lib/api/provider-url";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import {
  getProviderModelSelections,
  resolveProviderModelSelection,
  type ProviderModelSelection,
} from "@/lib/ai/provider-model-resolution";
import type { EmbeddingProviderDescriptor } from "@/lib/knowledge/types";
import { knowledgeTextFeatures } from "@/lib/knowledge/text-features";
import { getLocalSettings } from "@/lib/local/settings";

export type EmbeddingProvider = {
  descriptor: EmbeddingProviderDescriptor;
  embed(texts: string[]): Promise<number[][]>;
};

const DIMENSION = 256;
const MAX_BATCH_SIZE = 64;
const MAX_VECTOR_DIMENSION = 16_384;

export type EmbeddingProviderOption = {
  id: string;
  kind: "local" | "cloud";
  label: string;
  disclosure: string;
};

export class EmbeddingProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}

export const localHashEmbeddingProvider: EmbeddingProvider = {
  descriptor: { id: "zenme-local-subword-hash-v2", kind: "local", dimension: DIMENSION },
  async embed(texts) { return texts.map(embedLocally); },
};

export async function listEmbeddingProviderOptions(dataDir?: string): Promise<EmbeddingProviderOption[]> {
  const settings = await getLocalSettings(dataDir);
  return [
    {
      id: localHashEmbeddingProvider.descriptor.id,
      kind: "local",
      label: "内置本地子词向量",
      disclosure: "完全在本机计算；适合关键词、中文子词和代码标识符召回。",
    },
    ...getProviderModelSelections(settings.modelProviders, "embedding")
      .filter((selection) => embeddingSelectionReady(selection))
      .map((selection) => ({
        id: selection.id,
        kind: embeddingProviderKind(selection),
        label: selection.label,
        disclosure: embeddingDisclosure(selection),
      })),
  ];
}

export async function resolveConfiguredEmbeddingProvider(
  reference: string,
  dataDir?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EmbeddingProvider | null> {
  if (reference === localHashEmbeddingProvider.descriptor.id) return localHashEmbeddingProvider;
  const settings = await getLocalSettings(dataDir);
  const selection = resolveProviderModelSelection(reference, settings.modelProviders, "embedding");
  return selection && embeddingSelectionReady(selection)
    ? createProviderEmbeddingProvider(selection, fetchImpl)
    : null;
}

export function createProviderEmbeddingProvider(
  selection: ProviderModelSelection,
  fetchImpl: typeof fetch = fetch,
): EmbeddingProvider {
  if (!supportsEmbeddingEndpoint(selection)) {
    throw new EmbeddingProviderError("该服务商协议不支持 Embedding 接口");
  }
  const descriptor: EmbeddingProviderDescriptor = {
    id: selection.id,
    kind: embeddingProviderKind(selection),
    dimension: 0,
    disclosure: embeddingDisclosure(selection),
  };
  return {
    descriptor,
    async embed(texts) {
      if (!Array.isArray(texts) || texts.some((text) => typeof text !== "string")) {
        throw new EmbeddingProviderError("Embedding 输入无效");
      }
      const vectors: number[][] = [];
      for (let start = 0; start < texts.length; start += MAX_BATCH_SIZE) {
        const batch = texts.slice(start, start + MAX_BATCH_SIZE);
        const response = await fetchImpl(
          `${normalizeProviderApiBaseUrl(selection.provider.baseUrl, selection.provider.apiFormat)}/embeddings`,
          {
            method: "POST",
            headers: createEmbeddingHeaders(selection),
            body: JSON.stringify({ input: batch, model: selection.modelId, encoding_format: "float" }),
            signal: AbortSignal.timeout(60_000),
            ...getProxyFetchOptions(selection.provider.baseUrl, selection.provider.networkProxy),
          },
        );
        if (!response.ok) {
          throw new EmbeddingProviderError(`Embedding 服务调用失败（HTTP ${response.status}）`);
        }
        const payload = await response.json() as { data?: Array<{ embedding?: unknown; index?: unknown }> };
        const ordered = normalizeEmbeddingResponse(payload.data, batch.length);
        const expectedDimension = descriptor.dimension || ordered[0]?.length || 0;
        if (!expectedDimension || ordered.some((vector) => vector.length !== expectedDimension)) {
          throw new EmbeddingProviderError("Embedding 服务返回的向量维度不一致");
        }
        descriptor.dimension = expectedDimension;
        vectors.push(...ordered);
      }
      return vectors;
    },
  };
}

export function assertEmbeddingProviderAuthorized(provider: EmbeddingProvider, cloudAuthorized: boolean) {
  if (provider.descriptor.kind === "cloud" && !cloudAuthorized) {
    throw new Error("云端 Embedding 必须先展示发送内容并取得用户授权");
  }
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function embedLocally(text: string) {
  const vector = Array.from({ length: DIMENSION }, () => 0);
  for (const feature of knowledgeTextFeatures(text)) {
    const digest = crypto.createHash("sha256").update(feature).digest();
    const bucket = digest.readUInt16BE(0) % DIMENSION;
    vector[bucket] += digest[2] % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm ? vector.map((value) => value / norm) : vector;
}

function supportsEmbeddingEndpoint(selection: ProviderModelSelection) {
  return selection.provider.apiFormat !== "anthropic" && selection.provider.apiFormat !== "openai_oauth";
}

function embeddingSelectionReady(selection: ProviderModelSelection) {
  if (!supportsEmbeddingEndpoint(selection)) return false;
  if (selection.provider.authType !== "none" && !selection.provider.apiKey?.trim()) return false;
  try {
    normalizeProviderApiBaseUrl(selection.provider.baseUrl, selection.provider.apiFormat);
    return true;
  } catch {
    return false;
  }
}

function embeddingProviderKind(selection: ProviderModelSelection): "local" | "cloud" {
  try {
    const hostname = new URL(selection.provider.baseUrl).hostname.toLocaleLowerCase().replace(/^\[|\]$/g, "");
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ? "local" : "cloud";
  } catch {
    return "cloud";
  }
}

function embeddingDisclosure(selection: ProviderModelSelection) {
  return embeddingProviderKind(selection) === "local"
    ? `文本分块与查询将发送到本机服务 ${selection.provider.name}（${selection.modelId}）。`
    : `文本分块与查询将发送到云端服务 ${selection.provider.name}（${selection.modelId}）；敏感文件仍会在发送前排除。`;
}

function createEmbeddingHeaders(selection: ProviderModelSelection) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = selection.provider.apiKey?.trim();
  if (selection.provider.authType === "bearer" && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (selection.provider.authType === "api-key" && apiKey) headers["X-API-Key"] = apiKey;
  return headers;
}

function normalizeEmbeddingResponse(
  data: Array<{ embedding?: unknown; index?: unknown }> | undefined,
  expectedCount: number,
) {
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new EmbeddingProviderError("Embedding 服务返回数量不匹配");
  }
  const ordered = [...data].sort((left, right) => Number(left.index ?? 0) - Number(right.index ?? 0));
  return ordered.map((item) => {
    if (!Array.isArray(item.embedding) || item.embedding.length < 1 || item.embedding.length > MAX_VECTOR_DIMENSION ||
      item.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new EmbeddingProviderError("Embedding 服务返回了无效向量");
    }
    return item.embedding as number[];
  });
}
