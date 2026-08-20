type DesktopOpenPreviewApi = {
  openExternal?: (url: string) => Promise<boolean>;
};

export async function openPreviewUrl(url: string) {
  const target = validatePreviewUrl(url);
  if (typeof window === "undefined") return false;
  const desktopApi = (window as Window & { zenmeDesktop?: DesktopOpenPreviewApi }).zenmeDesktop;
  if (desktopApi?.openExternal) return desktopApi.openExternal(target);
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  return Boolean(opened);
}

export function validatePreviewUrl(value: string) {
  const target = new URL(value);
  if ((target.protocol !== "http:" && target.protocol !== "https:") || target.username || target.password) {
    throw new Error("仅支持不含凭据的 HTTP(S) 预览地址");
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "::" || hostname === "::1") target.hostname = "localhost";
  return target.toString();
}
