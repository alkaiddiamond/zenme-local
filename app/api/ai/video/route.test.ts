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
vi.mock("@/lib/local/project-repository", () => ({
  getLocalProject: vi.fn(async () => ({ id: "project-1" })),
}));
vi.mock("@/lib/local/project-files-repository", () => ({
  importLocalProjectFile: vi.fn(async () => ({ id: "file-1" })),
}));

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

  it("任务成功后安全下载并直接保存为本地项目资产", async () => {
    const upstreamFetch = vi.fn()
      .mockResolvedValueOnce(Response.json({
        content: { video_url: "https://example.volces.com/result.mp4" },
        id: "cgt-123",
        status: "succeeded",
      }))
      .mockResolvedValueOnce(new Response("video-data", {
        headers: { "content-type": "video/mp4" },
      }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(new Request(
      "http://localhost/api/ai/video?download=1&model=provider%2Fmodel&projectId=project-1&taskId=cgt-123",
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      fileId: "file-1",
      model: "doubao-seedance-test",
      originalUrl: "/api/projects/project-1/files/file-1",
      taskId: "cgt-123",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(2);
  });

  it("拒绝供应商返回的不受信任下载地址", async () => {
    const upstreamFetch = vi.fn(async () => Response.json({
      content: { video_url: "http://127.0.0.1/private.mp4" },
      id: "cgt-123",
      status: "succeeded",
    }));
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(new Request(
      "http://localhost/api/ai/video?download=1&model=provider%2Fmodel&projectId=project-1&taskId=cgt-123",
    ));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "视频任务返回了不受信任的下载地址",
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });
});
