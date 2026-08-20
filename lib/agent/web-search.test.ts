import { describe, expect, it } from "vitest";

import { AgentWebSearchError, searchProjectWeb } from "@/lib/agent/web-search";

describe("Project Agent web search", () => {
  it("rejects an empty query before provider access", async () => {
    await expect(searchProjectWeb({ query: "" }, "unused"))
      .rejects.toMatchObject<AgentWebSearchError>({ code: "invalid_arguments" });
  });
});
