export function getSafeAuthRedirectPath(next?: string | null) {
  if (!next) {
    return "/";
  }

  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }

  if (/[\u0000-\u001f\u007f]/.test(next)) {
    return "/";
  }

  return next;
}
