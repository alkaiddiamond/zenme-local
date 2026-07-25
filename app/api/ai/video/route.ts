import { resolveProviderModelSelection } from "@/lib/ai/provider-model-resolution";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import { getLocalSettings, type ModelProviderConfig } from "@/lib/local/settings";

const VIDEO_TASK_TIMEOUT_MS = 15 * 60 * 1000;
const VIDEO_POLL_INTERVAL_MS = 5_000;

type VideoRequestBody = {
  duration?: number;
  generateAudio?: boolean;
  imageDataUrls?: string[];
  imageRoles?: Array<"first_frame" | "last_frame" | "reference_image">;
  model?: string;
  prompt?: string;
  ratio?: string;
  resolution?: string;
};

type VideoTask = {
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
  id?: string;
  status?: "queued" | "running" | "cancelled" | "succeeded" | "failed";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VideoRequestBody;
    const prompt = body.prompt?.trim();
    const model = body.model?.trim();
    if (!prompt) return Response.json({ error: "缺少视频生成指令" }, { status: 400 });
    if (!model) return Response.json({ error: "缺少视频模型" }, { status: 400 });

    const settings = await getLocalSettings();
    const selection = resolveProviderModelSelection(model, settings.modelProviders, "video");
    if (!selection) return Response.json({ error: "未启用该视频模型" }, { status: 400 });
    const provider = selection.provider;
    const apiKey = provider.apiKey?.trim();
    if (!apiKey) {
      return Response.json(
        { error: "缺少火山方舟 API Key，请到设置 > 模型配置中填写" },
        { status: 400 },
      );
    }

    const apiBaseUrl = normalizeVolcengineVideoBaseUrl(provider);
    const imageDataUrls = (body.imageDataUrls ?? [])
      .map((value) => value.trim())
      .filter((value) => value.startsWith("data:image/"))
      .slice(0, 5);
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    imageDataUrls.forEach((url, index) => {
      content.push({
        type: "image_url",
        image_url: { url },
        role: body.imageRoles?.[index] ?? "reference_image",
      });
    });

    const createResponse = await fetch(`${apiBaseUrl}/contents/generations/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: selection.modelId,
        content,
        duration: clampInteger(body.duration, 4, 15, 5),
        generate_audio: body.generateAudio !== false,
        ratio: normalizeRatio(body.ratio),
        resolution: normalizeResolution(body.resolution),
        watermark: false,
      }),
      signal: AbortSignal.timeout(60_000),
      ...getProxyFetchOptions(apiBaseUrl, provider.networkProxy),
    });
    const created = (await createResponse.json().catch(() => null)) as VideoTask | null;
    if (!createResponse.ok || !created?.id) {
      return Response.json(
        { error: formatVideoError("视频任务创建失败", createResponse.status, created) },
        { status: createResponse.ok ? 502 : createResponse.status },
      );
    }

    const task = await waitForVideoTask({
      apiBaseUrl,
      apiKey,
      provider,
      taskId: created.id,
    });
    const videoUrl = task.content?.video_url;
    if (!videoUrl) throw new Error("视频任务成功但未返回下载地址");
    const videoResponse = await fetch(videoUrl, {
      signal: AbortSignal.timeout(2 * 60 * 1000),
      ...getProxyFetchOptions(videoUrl, provider.networkProxy),
    });
    if (!videoResponse.ok) throw new Error("生成视频下载失败");

    return new Response(await videoResponse.arrayBuffer(), {
      headers: {
        "cache-control": "no-store",
        "content-type": videoResponse.headers.get("content-type") || "video/mp4",
        "x-zenme-model": selection.modelId,
        "x-zenme-task-id": created.id,
      },
    });
  } catch {
    return Response.json({ error: "视频生成失败，请稍后重试" }, { status: 500 });
  }
}

async function waitForVideoTask(input: {
  apiBaseUrl: string;
  apiKey: string;
  provider: ModelProviderConfig;
  taskId: string;
}) {
  const deadline = Date.now() + VIDEO_TASK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${input.apiBaseUrl}/contents/generations/tasks/${encodeURIComponent(input.taskId)}`,
      {
        headers: { Authorization: `Bearer ${input.apiKey}` },
        signal: AbortSignal.timeout(60_000),
        ...getProxyFetchOptions(input.apiBaseUrl, input.provider.networkProxy),
      },
    );
    const task = (await response.json().catch(() => null)) as VideoTask | null;
    if (!response.ok || !task) {
      throw new Error(formatVideoError("视频任务查询失败", response.status, task));
    }
    if (task.status === "succeeded") return task;
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(task.error?.message || "视频任务未完成");
    }
    await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
  }
  throw new Error("视频任务执行超过 15 分钟，请稍后重试");
}

function normalizeVolcengineVideoBaseUrl(provider: ModelProviderConfig) {
  const url = new URL(provider.baseUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "ark.cn-beijing.volces.com" ||
    !/^\/api\/v3\/?$/i.test(url.pathname)
  ) {
    throw new Error("视频模型必须使用火山方舟在线推理地址 https://ark.cn-beijing.volces.com/api/v3");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeRatio(value?: string) {
  return ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"].includes(value ?? "")
    ? value
    : "adaptive";
}

function normalizeResolution(value?: string) {
  return ["480p", "720p", "1080p"].includes(value ?? "") ? value : "720p";
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

function formatVideoError(prefix: string, status: number, task: VideoTask | null) {
  const detail = task?.error?.message || task?.error?.code;
  return detail ? `${prefix}（${status}）：${detail}` : `${prefix}（${status}）`;
}
