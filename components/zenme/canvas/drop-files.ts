import type { CanvasNodeData } from "@/components/zenme/node-types";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import type { ReadingAsset } from "@/lib/reading/types";
import { uploadProjectFileToApi } from "@/lib/zenme-api";

import {
  createImagePreview,
  getReadingCoverUrl,
  isBookFile,
} from "./files";
import {
  createBookCoverPreview,
  registerReadingAsset,
} from "./reading-assets";
import { getImageDisplaySize } from "../image-edit-options";
import type { CanvasNode } from "./types";

export async function createDroppedFileCanvasNodes(input: {
  files: File[];
  onReadingError: (message: string) => void;
  position: { x: number; y: number };
  projectId: string;
}): Promise<CanvasNode[]> {
  return Promise.all(
    input.files.map(async (file, index): Promise<CanvasNode> => {
      const id = crypto.randomUUID();
      const isImage = file.type.startsWith("image/");
      const isBook = isBookFile(file);
      const isMusic = file.type.startsWith("audio/");
      const preview = isImage ? await createImagePreview(file) : undefined;
      const bookCover = isBook
        ? await createBookCoverPreview(file)
        : undefined;
      let fileId: string | undefined;
      let previewUrl = preview?.dataUrl;
      let readingAsset: ReadingAsset | null = null;
      let originalUrl = getDroppedFileOriginalUrl({
        file,
        isBook,
        isImage,
        previewUrl,
      });
      let uploadStatus: CanvasNodeData["uploadStatus"] = "pending";

      try {
        const upload = await uploadProjectFileToApi({
          projectId: input.projectId,
          file,
          preview: preview?.blob,
        });

        fileId = upload.fileId;
        previewUrl = upload.previewUrl ?? previewUrl;
        originalUrl = upload.originalUrl;
        uploadStatus = "uploaded";
      } catch {
        uploadStatus = "failed";
      }

      let readingError: string | undefined;
      if (isBook) {
        try {
          readingAsset = await registerReadingAsset({
            projectId: input.projectId,
            nodeId: id,
            file,
            fileName: file.name,
            cover: bookCover,
          });
        } catch (error) {
          readingError = getReadingApiErrorMessage(error, "阅读资料登记失败");
          input.onReadingError(`阅读资料登记失败：${readingError}`);
        }
      }

      const imageSize = preview
        ? getImageDisplaySize(preview.width / preview.height)
        : undefined;

      return {
        id,
        type: isImage ? "image" : isBook ? "book" : isMusic ? "music" : "file",
        position: {
          x: input.position.x + index * 32,
          y: input.position.y + index * 32,
        },
        ...(imageSize ? { style: imageSize } : {}),
        data: {
          kind: isImage ? "image" : isBook ? "book" : isMusic ? "music" : "file",
          title: readingAsset?.title ?? file.name,
          projectId: input.projectId,
          fileName: file.name,
          fileSize: file.size,
          coverUrl: getReadingCoverUrl(readingAsset),
          fileId,
          readingAssetId: readingAsset?.id,
          readingError,
          mimeType: file.type,
          imageAspectRatio: preview ? preview.width / preview.height : undefined,
          imageHeight: preview?.height,
          imageWidth: preview?.width,
          previewUrl,
          originalUrl,
          uploadStatus,
        },
      };
    }),
  );
}

function getDroppedFileOriginalUrl(input: {
  file: File;
  isBook: boolean;
  isImage: boolean;
  previewUrl?: string;
}) {
  if (input.isImage) {
    return URL.createObjectURL(input.file);
  }

  if (input.isBook) {
    return URL.createObjectURL(input.file);
  }

  return undefined;
}
