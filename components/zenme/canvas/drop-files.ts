import type { CanvasNodeData } from "@/components/zenme/node-types";
import { getReadingApiErrorMessage } from "@/lib/reading/api-errors";
import type { ReadingAsset } from "@/lib/reading/types";
import {
  referenceProjectFileInApi,
  uploadProjectFileToApi,
} from "@/lib/zenme-api";

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
  const nodes = await Promise.all(
    input.files.map(async (file, index): Promise<CanvasNode | null> => {
      const id = crypto.randomUUID();
      let desktopFolder: Awaited<ReturnType<typeof getDesktopMusicFolder>>;
      try {
        desktopFolder = await getDesktopMusicFolder(file);
      } catch (error) {
        input.onReadingError(
          error instanceof Error ? error.message : "系统文件夹识别失败",
        );
        return null;
      }
      if (desktopFolder) {
        const sources: NonNullable<CanvasNodeData["musicFolderSources"]> = [];
        for (const audioFile of desktopFolder.files) {
          const reference = await referenceProjectFileInApi({
            projectId: input.projectId,
            externalPath: audioFile.path,
            fileName: audioFile.name,
            mimeType: audioFile.type,
          });
          sources.push({
            id: reference.fileId,
            fileId: reference.fileId,
            fileName: audioFile.name,
            fileSize: audioFile.size,
            mimeType: audioFile.type,
            originalUrl: reference.originalUrl,
            title: audioFile.name,
          });
        }
        return {
          id,
          type: "musicFolder",
          position: {
            x: input.position.x + index * 32,
            y: input.position.y + index * 32,
          },
          data: {
            kind: "musicFolder",
            title: desktopFolder.name || "文件夹",
            projectId: input.projectId,
            musicFolderMode: "system",
            musicFolderPath: desktopFolder.path,
            musicFolderSources: sources,
            musicFolderExpanded: false,
          },
        };
      }
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
        const desktopFile = isMusic ? getDesktopFileReference(file) : null;
        if (desktopFile?.isDesktop && !desktopFile.path) {
          throw new Error("桌面文件路径能力尚未加载，请完全重启桌面开发模式后重试");
        }
        const externalPath = desktopFile?.path;
        const upload = externalPath
          ? await referenceProjectFileInApi({
              projectId: input.projectId,
              externalPath,
              fileName: file.name,
              mimeType: file.type,
            })
          : await uploadProjectFileToApi({
              projectId: input.projectId,
              file,
              preview: preview?.blob,
            });

        fileId = upload.fileId;
        previewUrl = upload.previewUrl ?? previewUrl;
        originalUrl = upload.originalUrl;
        uploadStatus = "uploaded";
      } catch (error) {
        uploadStatus = "failed";
        if (isMusic) {
          input.onReadingError(
            error instanceof Error ? error.message : "音频文件引用失败",
          );
        }
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

  return nodes.filter((node): node is CanvasNode => Boolean(node));
}

async function getDesktopMusicFolder(file: File) {
  if (typeof window === "undefined") return null;
  const desktopApi = (
    window as Window & {
      zenmeDesktop?: {
        inspectMusicFolderForFile?: (file: File) => Promise<{
          files: Array<{ name: string; path: string; size: number; type: string }>;
          name: string;
          path: string;
        } | null>;
      };
    }
  ).zenmeDesktop;
  if (!desktopApi?.inspectMusicFolderForFile) {
    if (
      desktopApi &&
      file.type === "" &&
      !/\.[^./\\]+$/.test(file.name)
    ) {
      throw new Error("系统文件夹能力尚未加载，请完全重启桌面开发模式后重新拖入");
    }
    return null;
  }
  try {
    return await desktopApi.inspectMusicFolderForFile(file);
  } catch {
    return null;
  }
}

function getDesktopFileReference(file: File) {
  if (typeof window === "undefined") {
    return { isDesktop: false, path: undefined };
  }
  const desktopApi = (
    window as Window & {
      zenmeDesktop?: { getPathForFile?: (file: File) => string };
    }
  ).zenmeDesktop;
  try {
    return {
      isDesktop: Boolean(desktopApi),
      path: desktopApi?.getPathForFile?.(file) || undefined,
    };
  } catch {
    return { isDesktop: Boolean(desktopApi), path: undefined };
  }
}

export function getDroppedFiles(
  dataTransfer: Pick<DataTransfer, "files" | "items">,
) {
  const candidates = [
    ...Array.from(dataTransfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile()),
    ...Array.from(dataTransfer.files),
  ];
  const seen = new Set<string>();

  return candidates.flatMap((file) => {
    if (!file) return [];
    const key = [
      file.name,
      file.size,
      file.lastModified,
      file.type,
    ].join(":");
    if (seen.has(key)) return [];
    seen.add(key);
    return [file];
  });
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
