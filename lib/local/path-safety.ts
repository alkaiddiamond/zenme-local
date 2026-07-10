import path from "node:path";

export function assertSafePathSegment(segment: string, label = "path segment") {
  if (!segment || segment === "." || segment === "..") {
    throw new Error(`Invalid ${label}`);
  }

  if (
    path.isAbsolute(segment) ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes(":") ||
    segment.includes("\0")
  ) {
    throw new Error(`Invalid ${label}`);
  }
}

export function createSafeFileName(fileName: string) {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const trimmed = baseName.trim().replace(/\s+/g, " ");
  return trimmed || "file";
}

export function resolveInside(root: string, ...segments: string[]) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return target;
  }

  throw new Error("Resolved path escapes data directory");
}

