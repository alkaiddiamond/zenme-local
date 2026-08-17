import { describe, expect, it } from "vitest";

import { cosineSimilarity, localHashEmbeddingProvider } from "@/lib/knowledge/embeddings";
import { knowledgeTextFeatures } from "@/lib/knowledge/text-features";

describe("knowledge text features", () => {
  it("produces overlapping Chinese subwords instead of one whole sentence token", () => {
    expect(knowledgeTextFeatures("用户身份认证流程")).toEqual(expect.arrayContaining(["身份", "认证", "身份认"]));
  });

  it("splits common code identifiers for project symbol recall", () => {
    expect(knowledgeTextFeatures("getProjectAgentSession workspace_root")).toEqual(expect.arrayContaining([
      "getprojectagentsession", "get", "project", "agent", "session", "workspace", "root",
    ]));
  });

  it("gives related Chinese project text a stronger local vector score", async () => {
    const [query, related, unrelated] = await localHashEmbeddingProvider.embed([
      "用户身份认证",
      "实现认证流程与权限检查",
      "渲染音频波形和节拍器",
    ]);
    expect(cosineSimilarity(query, related)).toBeGreaterThan(cosineSimilarity(query, unrelated));
  });
});
