import { createImagePreview, isReadableFile } from "@/components/zenme/canvas/files";
import { registerReadingAsset } from "@/components/zenme/canvas/reading-assets";

export const COMPOSER_ATTACHMENT_ACCEPT = "image/*,.txt,.md,.markdown,.pdf,.docx,.epub";
export type ComposerAttachment = {
  id: string;
  name: string;
  size: number;
} & ({ kind: "image"; dataUrl: string } | { kind: "document"; readingAssetId: string });

export function validateComposerAttachments(files: File[], current: ComposerAttachment[]) {
  let images = current.filter((item) => item.kind === "image").length;
  let documents = current.length - images;
  let documentBytes = current.filter((item) => item.kind === "document").reduce((sum, item) => sum + item.size, 0);
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      images += 1;
      if (file.size > 50 * 1024 * 1024) throw new Error("单张图片不能超过 50 MB");
    } else {
      if (!isReadableFile(file)) throw new Error(`不支持附件「${file.name}」，请选择图片、TXT、Markdown、PDF、DOCX 或 EPUB`);
      documents += 1;
      documentBytes += file.size;
    }
  }
  if (images > 4) throw new Error("单次最多添加 4 张图片");
  if (documents > 4) throw new Error("单次最多添加 4 个文档附件");
  if (documentBytes > 32 * 1024 * 1024) throw new Error("文档附件总大小不能超过 32 MB");
}

export async function prepareComposerAttachment(file: File, context: { projectId: string; nodeId: string }): Promise<ComposerAttachment> {
  const common = { id: crypto.randomUUID(), name: file.name, size: file.size };
  if (file.type.startsWith("image/")) {
    return { ...common, kind: "image", dataUrl: (await createImagePreview(file)).dataUrl };
  }
  const asset = await registerReadingAsset({ ...context, file, fileName: file.name });
  return { ...common, kind: "document", readingAssetId: asset.id };
}

export function composerAttachmentPayload(attachments: ComposerAttachment[]) {
  return {
    imageDataUrls: attachments.flatMap((item) => item.kind === "image" ? [item.dataUrl] : []),
    readingAssetIds: attachments.flatMap((item) => item.kind === "document" ? [item.readingAssetId] : []),
  };
}

export function mergeComposerReadingAssets(inherited: string[], attached: string[] = []) {
  const ids = [...new Set([...inherited, ...attached])];
  if (ids.length > 4) throw new Error("附件与上游节点的文档合计不能超过 4 个，请减少附件或上游连接");
  return ids;
}
