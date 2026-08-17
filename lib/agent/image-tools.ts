import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { generateConfiguredImage } from "@/lib/ai/image-generation-service";
import { getProjectDir } from "@/lib/local/data-dir";
import { assertSafePathSegment, resolveInside } from "@/lib/local/path-safety";
import { getLocalWorkspaceBinding } from "@/lib/local/workspace-repository";
import { canUseWorkspaceRootCapability, listWorkspaceRoots } from "@/lib/workspace/types";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_REFERENCE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif"]);

export type AgentGeneratedImage = {
  absolutePath: string;
  mediaType: string;
  revisedPrompt?: string;
  url: string;
};

export type AgentImageResult = {
  durationMs: number;
  images: AgentGeneratedImage[];
  model: string;
  operation: "edit" | "generate";
  prompt: string;
  provider: string;
};

export async function generateAgentImages(input: {
  aspectRatio?: string;
  count?: number;
  dataDir: string;
  executionId: string;
  projectId: string;
  prompt: string;
  quality?: string;
}): Promise<AgentImageResult> {
  return runAgentImageOperation({ ...input, operation: "generate", imageDataUrls: [] });
}

export async function editAgentImages(input: {
  aspectRatio?: string;
  dataDir: string;
  executionId: string;
  projectId: string;
  prompt: string;
  quality?: string;
  referencedImagePaths: string[];
  workspaceRootId?: string;
}): Promise<AgentImageResult> {
  if (input.referencedImagePaths.length < 1 || input.referencedImagePaths.length > 3) {
    throw new Error("图片编辑需要 1 至 3 个参考图片路径");
  }
  const imageDataUrls = await Promise.all(input.referencedImagePaths.map((filePath) =>
    readAllowedReferenceImage(input.projectId, filePath, input.dataDir, input.workspaceRootId)));
  return runAgentImageOperation({ ...input, count: 1, operation: "edit", imageDataUrls });
}

async function runAgentImageOperation(input: {
  aspectRatio?: string;
  count?: number;
  dataDir: string;
  executionId: string;
  imageDataUrls: string[];
  operation: "edit" | "generate";
  projectId: string;
  prompt: string;
  quality?: string;
}): Promise<AgentImageResult> {
  assertSafePathSegment(input.projectId, "projectId");
  assertSafePathSegment(input.executionId, "executionId");
  const count = Math.max(1, Math.min(4, input.count ?? 1));
  const startedAt = Date.now();
  const images: AgentGeneratedImage[] = [];
  let model = "";
  let provider = "";
  for (let index = 0; index < count; index += 1) {
    const generated = await generateConfiguredImage({
      aspectRatio: input.aspectRatio,
      imageDataUrls: input.imageDataUrls,
      operation: input.operation,
      prompt: input.prompt,
      quality: input.quality,
    });
    model = generated.model;
    provider = generated.providerName;
    const persisted = await persistGeneratedImage({
        b64Json: generated.b64Json,
        dataDir: input.dataDir,
        executionId: input.executionId,
        mediaType: generated.mediaType,
        projectId: input.projectId,
      });
    images.push({
      absolutePath: persisted.absolutePath,
      mediaType: generated.mediaType,
      revisedPrompt: generated.revisedPrompt,
      url: `/api/projects/${encodeURIComponent(input.projectId)}/agent-images/${encodeURIComponent(input.executionId)}/${encodeURIComponent(persisted.fileName)}`,
    });
  }
  return {
    durationMs: Date.now() - startedAt,
    images,
    model,
    operation: input.operation,
    prompt: input.prompt,
    provider,
  };
}

async function persistGeneratedImage(input: {
  b64Json: string;
  dataDir: string;
  executionId: string;
  mediaType: string;
  projectId: string;
}) {
  const extension = input.mediaType === "image/jpeg"
    ? "jpg"
    : input.mediaType === "image/webp"
      ? "webp"
      : "png";
  const directory = resolveInside(
    getProjectDir(input.projectId, input.dataDir),
    "agent-generated-images",
    input.executionId,
  );
  await fs.mkdir(directory, { recursive: true });
  const filePath = resolveInside(directory, `${crypto.randomUUID()}.${extension}`);
  const buffer = Buffer.from(input.b64Json, "base64");
  if (!buffer.length || buffer.length > MAX_REFERENCE_BYTES) {
    throw new Error("生成图片为空或超过 20 MiB 限制");
  }
  await fs.writeFile(filePath, buffer, { flag: "wx" });
  return { absolutePath: filePath, fileName: path.basename(filePath) };
}

async function readAllowedReferenceImage(projectId: string, filePath: string, dataDir: string, workspaceRootId?: string) {
  if (!path.isAbsolute(filePath)) throw new Error("参考图片必须使用工具返回的绝对路径");
  const resolved = await fs.realpath(path.resolve(filePath));
  const generatedRoot = resolveInside(getProjectDir(projectId, dataDir), "agent-generated-images");
  const canonicalGeneratedRoot = await fs.realpath(generatedRoot).catch(() => generatedRoot);
  let allowed = isInside(canonicalGeneratedRoot, resolved);
  if (!allowed) {
    const binding = await getLocalWorkspaceBinding(projectId, dataDir);
    allowed = Boolean(binding && listWorkspaceRoots(binding).some((root) =>
      (!workspaceRootId || root.id === workspaceRootId) &&
      canUseWorkspaceRootCapability(root, "read") && isInside(root.realPath, resolved)));
  }
  if (!allowed) throw new Error("参考图片不在当前项目的可读 Workspace 或 Agent 图片目录内");
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size < 1 || stat.size > MAX_REFERENCE_BYTES) {
    throw new Error("参考图片不存在、为空或超过 20 MiB 限制");
  }
  const metadata = await sharp(resolved, { animated: false, failOn: "error" }).metadata();
  if (!metadata.format || !SUPPORTED_REFERENCE_FORMATS.has(metadata.format)) {
    throw new Error("参考图片格式无效");
  }
  const buffer = await fs.readFile(resolved);
  const mediaType = metadata.format === "jpeg" ? "image/jpeg" : `image/${metadata.format}`;
  return `data:${mediaType};base64,${buffer.toString("base64")}`;
}

function isInside(rootPath: string, candidatePath: string) {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
