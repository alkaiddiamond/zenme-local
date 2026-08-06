import type { ReadingAsset } from "@/lib/reading/types";
import {
  getReadingAssetSizeError,
  shouldUseBinaryReadingAssetUpload,
} from "@/lib/reading/limits";

import type { CanvasNode } from "./types";

export async function prepareReadingAssetForCanvasNode(input: {
  node: CanvasNode;
  projectId: string;
}) {
  if (input.node.data.kind === "text" || input.node.data.kind === "markdown") {
    const content = input.node.data.plainText?.trimEnd();
    if (!content) return null;
    const markdown =
      input.node.data.kind === "markdown" || input.node.data.textMode === "markdown";
    const fileName = createTextReadingFileName(
      input.node.data.title || input.node.data.name || "未命名文本",
      markdown ? ".md" : ".txt",
    );
    const file = new File([content], fileName, {
      type: markdown ? "text/markdown;charset=utf-8" : "text/plain;charset=utf-8",
    });
    return registerReadingAsset({
      projectId: input.projectId,
      nodeId: input.node.id,
      file,
      fileName,
    });
  }

  const originalUrl = input.node.data.originalUrl;
  const fileName = input.node.data.fileName;

  if (!originalUrl || !fileName) {
    return null;
  }

  const response = await fetch(originalUrl);
  if (!response.ok) {
    throw new Error("无法读取原始图书文件");
  }

  const blob = await response.blob();
  const file = new File([blob], fileName, {
    type: input.node.data.mimeType,
  });
  const cover = await createBookCoverPreview(file);

  return registerReadingAsset({
    projectId: input.projectId,
    nodeId: input.node.id,
    file,
    fileName,
    cover,
  });
}

function createTextReadingFileName(title: string, extension: ".md" | ".txt") {
  const safeTitle = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return `${safeTitle || "未命名文本"}${extension}`;
}

export async function registerReadingAsset(input: {
  projectId: string;
  nodeId: string;
  file: Blob;
  fileName: string;
  cover?: Blob;
}) {
  const sizeError = getReadingAssetSizeError(input.file.size);
  if (sizeError) {
    throw new Error(sizeError);
  }

  if (shouldUseBinaryReadingAssetUpload(input.file.size)) {
    return registerReadingAssetAsBinary(input);
  }

  const formData = new FormData();
  formData.append("projectId", input.projectId);
  formData.append("nodeId", input.nodeId);
  formData.append("fileSize", String(input.file.size));
  formData.append("file", input.file, input.fileName);
  if (input.cover) {
    formData.append("cover", input.cover, "cover.webp");
  }

  const response = await fetch("/api/reading/assets", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (payload?.error?.includes("FormData")) {
      return registerReadingAssetAsBinary(input);
    }

    throw new Error(payload?.error ?? "阅读资料登记失败");
  }

  return (await response.json()) as ReadingAsset;
}

async function registerReadingAssetAsBinary(input: {
  projectId: string;
  nodeId: string;
  file: Blob;
  fileName: string;
}) {
  const response = await fetch("/api/reading/assets", {
    body: input.file,
    headers: {
      "content-type": "application/octet-stream",
      "x-zenme-file-name": encodeURIComponent(input.fileName),
      "x-zenme-file-size": String(input.file.size),
      "x-zenme-node-id": input.nodeId,
      "x-zenme-project-id": input.projectId,
    },
    method: "POST",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error ?? "阅读资料登记失败");
  }

  return (await response.json()) as ReadingAsset;
}

export async function createBookCoverPreview(file: File) {
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return undefined;
  }

  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.mjs",
      import.meta.url,
    ).toString();

    const bytes = await file.arrayBuffer();
    const documentTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
    const pdf = await documentTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const targetWidth = 360;
    const scale = targetWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) {
      await pdf.cleanup();
      return undefined;
    }

    canvas.width = Math.round(scaledViewport.width);
    canvas.height = Math.round(scaledViewport.height);
    await page.render({
      canvas,
      canvasContext: context,
      viewport: scaledViewport,
    }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.82),
    );
    await pdf.cleanup();

    return blob ?? undefined;
  } catch {
    return undefined;
  }
}
