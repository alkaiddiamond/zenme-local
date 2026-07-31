import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/local/settings", () => ({
  getLocalSettings: vi.fn(async () => ({ modelProviders: [] })),
}));
vi.mock("@/lib/ai/provider-model-resolution", () => ({
  resolveProviderModelSelection: vi.fn(() => ({
    modelId: "doubao-seedream-5.0-lite",
    provider: {
      apiFormat: "volcengine_agent_plan",
      apiKey: "test-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/plan",
      id: "volcengine-agent-plan",
      name: "火山方舟 Agent Plan",
      networkProxy: { mode: "environment" },
    },
  })),
}));
vi.mock("@/lib/api/proxy-fetch", () => ({
  getProxyFetchOptions: vi.fn(() => ({})),
}));
vi.mock("@/lib/local/token-usage", () => ({
  recordTokenUsage: vi.fn(async () => undefined),
}));

import { POST, createVolcengineAgentPlanImageRequestBody } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Volcengine Agent Plan image request", () => {
  it("keeps text-to-image requests free of reference images", () => {
    expect(createVolcengineAgentPlanImageRequestBody({
      imageDataUrls: [],
      model: "doubao-seedream-5.0-lite",
      operation: "generate",
      prompt: "生成一座山间庭院",
      quality: "2K",
    })).toMatchObject({
      model: "doubao-seedream-5.0-lite",
      response_format: "b64_json",
      sequential_image_generation: "disabled",
      size: "2848x1600",
      n: 1,
    });

    expect(createVolcengineAgentPlanImageRequestBody({
      imageDataUrls: [],
      model: "doubao-seedream-5.0-lite",
      operation: "generate",
      prompt: "生成一座山间庭院",
    })).not.toHaveProperty("image");
  });

  it("sends ordered reference images for Seedream editing", () => {
    const firstImage = "data:image/png;base64,first";
    const secondImage = "data:image/jpeg;base64,second";
    const body = createVolcengineAgentPlanImageRequestBody({
      aspectRatio: "3:4",
      imageDataUrls: [firstImage, secondImage],
      model: "doubao-seedream-5.0-lite",
      operation: "edit",
      prompt: "让第一张图的人物穿上第二张图的服装",
      quality: "4K",
    });

    expect(body.image).toEqual([firstImage, secondImage]);
    expect(body.prompt).toContain("让第一张图的人物穿上第二张图的服装");
    expect(body.prompt).toContain("当前请求包含 2 张参考图片");
    expect(body.size).toBe("2592x3456");
  });

  it("forwards reference images through the Agent Plan generations endpoint", async () => {
    const upstreamFetch = vi.fn(async () => Response.json({
      data: [{ b64_json: "edited-image", media_type: "image/png" }],
    }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(new Request("http://localhost/api/ai/image-edit", {
      body: JSON.stringify({
        imageDataUrls: ["data:image/png;base64,reference"],
        model: "volcengine-agent-plan:doubao-seedream-5.0-lite",
        operation: "edit",
        prompt: "保留庭院布局，把季节改成秋天",
      }),
      method: "POST",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      b64Json: "edited-image",
      mediaType: "image/png",
      model: "doubao-seedream-5.0-lite",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch.mock.calls[0]?.[0]).toBe(
      "https://ark.cn-beijing.volces.com/api/plan/v3/images/generations",
    );
    const request = upstreamFetch.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      image: ["data:image/png;base64,reference"],
      model: "doubao-seedream-5.0-lite",
      response_format: "b64_json",
    });
  });
});
