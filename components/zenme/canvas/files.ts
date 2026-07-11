import type { ReadingAsset } from "@/lib/reading/types";

export function dataUrlToBlob(dataUrl: string) {
  const [meta, content] = dataUrl.split(",");
  const mime =
    meta.match(/data:(.*);base64/)?.[1] ?? "application/octet-stream";
  const bytes = atob(content);
  const buffer = new Uint8Array(bytes.length);

  for (let index = 0; index < bytes.length; index += 1) {
    buffer[index] = bytes.charCodeAt(index);
  }

  return new Blob([buffer], { type: mime });
}

export function isBookFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".epub") || name.endsWith(".pdf") || name.endsWith(".txt")
  );
}

export function getReadingCoverUrl(asset: ReadingAsset | null | undefined) {
  if (!asset?.coverPath) {
    return undefined;
  }

  return `/api/reading/assets/${asset.id}/cover?updatedAt=${encodeURIComponent(
    asset.updatedAt,
  )}`;
}

export function createImagePreview(file: File) {
  return new Promise<{ dataUrl: string; blob: Blob; height: number; width: number }>((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(reader.error);
    img.onload = () => {
      const maxSide = 1200;
      const ratio = Math.min(maxSide / img.width, maxSide / img.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建图片预览"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/webp", 0.88);
      resolve({
        dataUrl,
        blob: dataUrlToBlob(dataUrl),
        height: img.naturalHeight || img.height,
        width: img.naturalWidth || img.width,
      });
    };
    img.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function getImageDimensions(source: string) {
  return new Promise<{ height: number; width: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      height: image.naturalHeight || image.height,
      width: image.naturalWidth || image.width,
    });
    image.onerror = () => reject(new Error("图片尺寸读取失败"));
    image.src = source;
  });
}
