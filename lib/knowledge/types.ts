export const PROJECT_KNOWLEDGE_VERSION = 1 as const;

export type KnowledgeEntityKind =
  | "file" | "symbol" | "canvasNode" | "task" | "execution" | "changeSet" | "decision" | "memory";

export type KnowledgeEntity = {
  id: string;
  kind: KnowledgeEntityKind;
  title: string;
  text: string;
  contentHash: string;
  sourceId: string;
  /** Stable Workspace root identity for file-backed entities. */
  rootId?: string;
  relativePath?: string;
  stale: boolean;
  metadata: Record<string, string | number | boolean | null>;
};

export type KnowledgeEdge = {
  id: string;
  from: string;
  to: string;
  kind: "contains" | "references" | "canvasRelation" | "triggered" | "produced" | "changes" | "derivedFrom" | "supersedes";
  reason: string;
};

export type KnowledgeChunk = {
  id: string;
  entityId: string;
  text: string;
  contentHash: string;
  startOffset: number;
  endOffset: number;
  vector: number[];
};

export type EmbeddingProviderDescriptor = {
  id: string;
  kind: "local" | "cloud";
  dimension: number;
  disclosure?: string;
  authorizedAt?: string;
};

export type ProjectKnowledgeIndex = {
  version: typeof PROJECT_KNOWLEDGE_VERSION;
  projectId: string;
  status: "ready" | "paused" | "error";
  workspaceIdentityHash: string;
  embeddingProvider: EmbeddingProviderDescriptor;
  entities: KnowledgeEntity[];
  edges: KnowledgeEdge[];
  chunks: KnowledgeChunk[];
  ignoredSensitiveFiles: number;
  reusedChunks: number;
  indexedAt: string;
  updatedAt: string;
  error?: string;
};

export type KnowledgeSearchResult = {
  entity: KnowledgeEntity;
  score: number;
  scores: { keyword: number; path: number; vector: number; graph: number };
  evidence: string[];
  matchedChunk?: { id: string; text: string; contentHash: string };
};

export type KnowledgeSearchResponse = {
  query: string;
  indexUpdatedAt: string;
  embeddingProvider: EmbeddingProviderDescriptor;
  results: KnowledgeSearchResult[];
  consumedCharacters: number;
  budgetCharacters: number;
};
