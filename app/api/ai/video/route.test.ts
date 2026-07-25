import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/local/settings", () => ({
  getLocalSettings: vi.fn(async () => ({ modelProviders: [] })),
}));
vi.mock("@/lib/ai/provider-model-resolution", () => ({
  resolveProviderModelSelection: vi.fn(() => ({
    modelId: "doubao-seedance-test",
    provider: {
      apiKey: "test-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    },
  })),
}));
vi.mock("@/lib/api/proxy-fetch", () => ({ getProxyFetchOptions: vi.fn(() => ({})) }));

import { GET, POST } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("video task API", () => {
  it("创建服务商任务后立即返回任务 ID，不在请求中持续轮询", async () => {
    const upstreamFetch = vi.fn(async () => Response.json({ id: "cgt-123", status: "queued" }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await POST(new Request("http://localhost/api/ai/video", {
      body: JSON.stringify({ model: "provider/model", prompt: "生成一段视频" }),
      method: "POST",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      model: "doubao-seedance-test",
      status: "queued",
      taskId: "cgt-123",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("通过独立请求查询已创建任务的状态", async () => {
    const upstreamFetch = vi.fn(async () => Response.json({ id: "cgt-123", status: "running" }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(new Request(
      "http://localhost/api/ai/video?model=provider%2Fmodel&taskId=cgt-123",
    ));

    await expect(response.json()).resolves.toEqual({ status: "running", taskId: "cgt-123" });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("任务成功后由本地接口代理下载视频", async () => {
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        content: { video_url: "https://example.test/result.mp4" },
        id: "cgt-123",
        status: "succeeded",
      }))
      .mockResolvedValueOnce(new Response("video-data", {
        headers: { "content-type": "video/mp4" },
      }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(new Request(
      "http://localhost/api/ai/video?download=1&model=provider%2Fmodel&taskId=cgt-123",
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-zenme-task-id")).toBe("cgt-123");
    expect(await response.text()).toBe("video-data");
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });
});
