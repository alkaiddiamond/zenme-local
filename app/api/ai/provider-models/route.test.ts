import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider model discovery", () => {
  it("reports Agent Plan model discovery as unsupported instead of returning a static list as if it were fetched", async () => {
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
    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      code: "model_discovery_unsupported",
    });
    expect(payload.error).toContain("不提供");
  });
});
