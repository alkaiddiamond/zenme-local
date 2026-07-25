import { describe, expect, it, vi } from "vitest";

import { retryOpenAiModelSync } from "./openai-oauth";

describe("OpenAI OAuth model synchronization", () => {
  it("retries a transient model fetch failure after login", async () => {
    const sync = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce([{ id: "gpt-test" }]);
    const delay = vi.fn(async () => undefined);

    await expect(retryOpenAiModelSync({ delay, sync })).resolves.toEqual([
      { id: "gpt-test" },
    ]);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1_200);
  });

  it("reports failure only after all automatic retries are exhausted", async () => {
    const sync = vi.fn(async () => { throw new Error("still unavailable"); });

    await expect(retryOpenAiModelSync({
      attempts: 3,
      delay: async () => undefined,
      sync,
    })).rejects.toThrow("still unavailable");
    expect(sync).toHaveBeenCalledTimes(3);
  });
});
