export type BrowserPreviewOperation = "navigate" | "snapshot" | "click" | "type" | "press" | "screenshot" | "close";

export type BrowserPreviewElement = {
  ref: string;
  tag: string;
  role?: string;
  name?: string;
  value?: string;
  placeholder?: string;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
};

export type BrowserPreviewResult = {
  closed?: boolean;
  url?: string;
  title?: string;
  text?: string;
  elements?: BrowserPreviewElement[];
  truncated?: boolean;
  viewport?: { width: number; height: number; scrollX: number; scrollY: number };
  screenshot?: { dataUrl?: string; mimeType: "image/png"; width: number; height: number };
};

export async function controlBrowserPreview(input: {
  sessionId: string;
  operation: BrowserPreviewOperation;
  url?: string;
  ref?: string;
  text?: string;
  key?: string;
  includeScreenshot?: boolean;
}, signal?: AbortSignal): Promise<BrowserPreviewResult> {
  const endpoint = process.env.ZENME_BROWSER_CONTROL_URL;
  const token = process.env.ZENME_DESKTOP_TOKEN;
  if (!endpoint || !token) throw new Error("浏览器验证仅在 Zenme 桌面应用中可用");
  const timeout = AbortSignal.timeout(35_000);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: combinedSignal,
    });
  } catch (error) {
    throw new Error(error instanceof Error && error.name === "TimeoutError" ? "浏览器操作超时" : "无法连接桌面浏览器控制器");
  }
  const payload = await response.json().catch(() => ({})) as BrowserPreviewResult & { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "浏览器操作失败");
  return payload;
}

export function browserScreenshotDataUrl(value: unknown) {
  if (!value || typeof value !== "object" || !("screenshot" in value)) return undefined;
  const screenshot = value.screenshot;
  if (!screenshot || typeof screenshot !== "object" || !("dataUrl" in screenshot)) return undefined;
  const dataUrl = screenshot.dataUrl;
  return typeof dataUrl === "string" && dataUrl.startsWith("data:image/png;base64,") && dataUrl.length <= 16_000_000
    ? dataUrl
    : undefined;
}
