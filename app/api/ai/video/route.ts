import { resolveProviderModelSelection } from "@/lib/ai/provider-model-resolution";
import { getProxyFetchOptions } from "@/lib/api/proxy-fetch";
import { getLocalSettings, type ModelProviderConfig } from "@/lib/local/settings";
import { importLocalProjectFile } from "@/lib/local/project-files-repository";
import { getLocalProject } from "@/lib/local/project-repository";

const MAX_VIDEO_DOWNLOAD_BYTES = 512 * 1024 * 1024;

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

    return Response.json({
      model: selection.modelId,
      status: created.status ?? "queued",
      taskId: created.id,
    });
  } catch {
    return Response.json({ error: "视频任务创建失败，请稍后重试" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const model = requestUrl.searchParams.get("model")?.trim();
    const taskId = requestUrl.searchParams.get("taskId")?.trim();
    const shouldDownload = requestUrl.searchParams.get("download") === "1";
    const projectId = requestUrl.searchParams.get("projectId")?.trim();
    if (!model) return Response.json({ error: "缺少视频模型" }, { status: 400 });
    if (!taskId || taskId.length > 256) {
      return Response.json({ error: "缺少有效的视频任务 ID" }, { status: 400 });
    }
    if (shouldDownload && (!projectId || !(await getLocalProject(projectId)))) {
      return Response.json({ error: "缺少有效的本地项目" }, { status: 400 });
    }

    const settings = await getLocalSettings();
    const selection = resolveProviderModelSelection(model, settings.modelProviders, "video");
    if (!selection) return Response.json({ error: "未启用该视频模型" }, { status: 400 });
    const provider = selection.provider;
    const apiKey = provider.apiKey?.trim();
    if (!apiKey) return Response.json({ error: "缺少视频服务商 API Key" }, { status: 400 });
    const apiBaseUrl = normalizeVolcengineVideoBaseUrl(provider);
    const response = await fetch(
      `${apiBaseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(60_000),
        ...getProxyFetchOptions(apiBaseUrl, provider.networkProxy),
      },
    );
    const task = (await response.json().catch(() => null)) as VideoTask | null;
    if (!response.ok || !task) {
      return Response.json(
        { error: formatVideoError("视频任务查询失败", response.status, task) },
        { status: response.ok ? 502 : response.status },
      );
    }

    if (!shouldDownload) {
      return Response.json({
        error: task.error?.message,
        status: task.status ?? "running",
        taskId,
      });
    }
    if (task.status !== "succeeded") {
      return Response.json({ error: "视频任务尚未完成", status: task.status }, { status: 409 });
    }
    const videoUrl = task.content?.video_url;
    if (!videoUrl) return Response.json({ error: "视频任务未返回下载地址" }, { status: 502 });
    if (!isTrustedVideoDownloadUrl(videoUrl)) {
      return Response.json({ error: "视频任务返回了不受信任的下载地址" }, { status: 502 });
    }
    const videoResponse = await fetch(videoUrl, {
      signal: AbortSignal.timeout(2 * 60 * 1000),
      ...getProxyFetchOptions(videoUrl, provider.networkProxy),
    });
    if (!videoResponse.ok) {
      return Response.json({ error: "生成视频下载失败" }, { status: 502 });
    }
    const responseMimeType = videoResponse.headers.get("content-type") || "video/mp4";
    if (!responseMimeType.toLowerCase().startsWith("video/")) {
      return Response.json({ error: "生成结果不是有效的视频文件" }, { status: 502 });
    }
    const contentLength = Number(videoResponse.headers.get("content-length") ?? 0);
    if (contentLength > MAX_VIDEO_DOWNLOAD_BYTES) {
      return Response.json({ error: "生成视频超过 512 MB，无法保存" }, { status: 413 });
    }
    const bytes = Buffer.from(await videoResponse.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_VIDEO_DOWNLOAD_BYTES) {
      return Response.json({ error: "生成视频为空或超过 512 MB" }, { status: 413 });
    }
    const mimeType = responseMimeType;
    const record = await importLocalProjectFile({
      bytes,
      fileName: `zenme-video-${Date.now()}.mp4`,
      mimeType,
      projectId: projectId!,
    });
    return Response.json({
      fileId: record.id,
      model: selection.modelId,
      originalUrl: `/api/projects/${projectId}/files/${record.id}`,
      taskId,
    });
  } catch {
    return Response.json({ error: "视频任务查询失败，请稍后重试" }, { status: 500 });
  }
}

function isTrustedVideoDownloadUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && [
      "volces.com",
      "volccdn.com",
      "byteimg.com",
    ].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
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
