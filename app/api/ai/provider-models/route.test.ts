import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider model discovery", () => {
  it("returns the documented Agent Plan model preset without calling an unsupported models endpoint", async () => {
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(
      new Request("http://localhost/api/ai/provider-models", {
        method: "POST",
        body: JSON.stringify({
          provider: {
            id: "agent-plan",
            name: "火山方舟 Agent Plan",
            baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
            apiFormat: "volcengine_agent_plan",
            authType: "bearer",
            apiKey: "test-key",
            enabled: true,
            isDefault: false,
            modelMapping: { main: "" },
            models: [],
            contextWindows: {},
            modelModalities: {},
          },
        }),
      }),
    );

    expect(upstreamFetch).not.toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.data.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([
        "doubao-seed-2.0-pro",
        "glm-5.2",
        "deepseek-v4-pro",
        "doubao-seedream-5.0-lite",
      ]),
    );
  });
});
