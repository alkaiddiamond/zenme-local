import fs from "node:fs/promises";

import sharp from "sharp";

import { getZenmeDataDir } from "@/lib/local/data-dir";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { isSensitiveWorkspacePath } from "@/lib/workspace/workspace-files";
import { canUseWorkspaceRootCapability, resolveWorkspaceRoot } from "@/lib/workspace/types";
import { resolveExistingWorkspacePath } from "@/lib/workspace/workspace-inspection";

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MAX_EDGE = 2_048;
const MAX_MODEL_IMAGES = 4;
const MAX_MODEL_IMAGE_DATA_URL_CHARACTERS = 32_000_000;
const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

export type WorkspaceImageObservation = {
  dataUrl: string;
  height: number;
  mimeType: "image/webp";
  originalBytes: number;
  originalHeight: number;
  originalMimeType: string;
  originalWidth: number;
  relativePath: string;
  rootId: string;
  width: number;
};

export async function readWorkspaceImage(
  projectId: string,
  relativePath: string,
  dataDir = getZenmeDataDir(),
  rootId?: string,
): Promise<WorkspaceImageObservation> {
  const normalizedPath = relativePath.trim().replaceAll("\\", "/");
  if (!normalizedPath || isSensitiveWorkspacePath(normalizedPath)) {
    throw new Error("图片路径无效或属于敏感文件");
  }
  const binding = await getLocalWorkspaceBinding(projectId, dataDir);
  const root = binding ? resolveWorkspaceRoot(binding, rootId) : null;
  if (!root || !canUseWorkspaceRootCapability(root, "read")) {
    throw new Error("Workspace 未绑定或未授权读取");
  }
  const resolved = await resolveExistingWorkspacePath(root.realPath, normalizedPath);
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) throw new Error("Workspace 图片不存在");
  if (stat.size < 1 || stat.size > MAX_SOURCE_BYTES) throw new Error("图片为空或超过 20 MiB 限制");

  const source = sharp(resolved, {
    animated: false,
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  });
  const metadata = await source.metadata();
  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new Error("不支持的图片格式；仅支持 PNG、JPEG、WebP、GIF 和 AVIF");
  }
  const rendered = await source
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  if (rendered.data.length > MAX_OUTPUT_BYTES) throw new Error("处理后的图片仍然过大");

  return {
    dataUrl: `data:image/webp;base64,${rendered.data.toString("base64")}`,
    height: rendered.info.height,
    mimeType: "image/webp",
    originalBytes: stat.size,
    originalHeight: metadata.height,
    originalMimeType: `image/${metadata.format === "jpeg" ? "jpeg" : metadata.format}`,
    originalWidth: metadata.width,
    relativePath: normalizedPath,
    rootId: root.id,
    width: rendered.info.width,
  };
}

export function persistedWorkspaceImageObservation(value: WorkspaceImageObservation) {
  const { dataUrl, ...metadata } = value;
  void dataUrl;
  return metadata;
}

export function mergeModelImageDataUrls(
  initial: readonly string[] = [],
  observed: readonly string[] = [],
) {
  const candidates = [...initial, ...observed];
  const selected: string[] = [];
  const seen = new Set<string>();
  let totalCharacters = 0;
  for (let index = candidates.length - 1; index >= 0 && selected.length < MAX_MODEL_IMAGES; index -= 1) {
    const candidate = candidates[index];
    if (!candidate || seen.has(candidate)) continue;
    if (totalCharacters + candidate.length > MAX_MODEL_IMAGE_DATA_URL_CHARACTERS) continue;
    seen.add(candidate);
    selected.unshift(candidate);
    totalCharacters += candidate.length;
  }
  return selected;
}
