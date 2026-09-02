import type { AgentFileAttachment } from "@/lib/ai/file-attachment";
import {
  getLocalReadingAsset,
  getLocalReadingAssetFile,
} from "@/lib/local/reading-repository";

export const MAX_AGENT_READING_ATTACHMENTS = 4;
export const MAX_AGENT_READING_ATTACHMENT_BYTES = 32 * 1024 * 1024;

export class ReadingFileAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadingFileAttachmentError";
  }
}

export async function loadReadingFileAttachments(input: {
  assetIds?: string[];
  dataDir: string;
  projectId: string;
}) {
  const attachments: AgentFileAttachment[] = [];
  const assetIds = [...new Set(input.assetIds?.filter(Boolean) ?? [])];
  let totalBytes = 0;

  for (const assetId of assetIds) {
    const asset = await getLocalReadingAsset(assetId, input.dataDir);
    if (!asset || asset.projectId !== input.projectId) {
      throw new ReadingFileAttachmentError(
        "阅读资料不存在或不属于当前项目",
      );
    }
    const file = await getLocalReadingAssetFile(assetId, input.dataDir);
    if (!file) {
      throw new ReadingFileAttachmentError("阅读资料原文件不存在");
    }
    totalBytes += file.bytes.byteLength;
    if (totalBytes > MAX_AGENT_READING_ATTACHMENT_BYTES) {
      throw new ReadingFileAttachmentError(
        "阅读资料附件总大小不能超过 32 MB",
      );
    }
    const mimeType = file.mimeType.split(";", 1)[0] ?? file.mimeType;
    attachments.push({
      dataUrl: `data:${mimeType};base64,${file.bytes.toString("base64")}`,
      fileName: file.fileName,
      mimeType,
    });
  }

  return attachments;
}
