export type ImagePoint = { x: number; y: number };
export type ImageCropRect = { height: number; width: number; x: number; y: number };

export function mapClientPointToImage(input: {
  bounds: Pick<DOMRect, "height" | "left" | "top" | "width">;
  clientX: number;
  clientY: number;
  imageHeight: number;
  imageWidth: number;
}): ImagePoint {
  const width = Math.max(input.bounds.width, 1);
  const height = Math.max(input.bounds.height, 1);
  return {
    x: clamp(
      ((input.clientX - input.bounds.left) / width) * input.imageWidth,
      0,
      input.imageWidth,
    ),
    y: clamp(
      ((input.clientY - input.bounds.top) / height) * input.imageHeight,
      0,
      input.imageHeight,
    ),
  };
}

export function normalizeCropRect(
  start: ImagePoint,
  end: ImagePoint,
  imageWidth: number,
  imageHeight: number,
  aspectRatio?: number | null,
): ImageCropRect | null {
  if (aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
    const anchor = { x: clamp(start.x, 0, imageWidth), y: clamp(start.y, 0, imageHeight) };
    const directionX = end.x < anchor.x ? -1 : 1;
    const directionY = end.y < anchor.y ? -1 : 1;
    const maxWidth = directionX > 0 ? imageWidth - anchor.x : anchor.x;
    const maxHeight = directionY > 0 ? imageHeight - anchor.y : anchor.y;
    const width = Math.min(
      Math.max(Math.abs(end.x - anchor.x), Math.abs(end.y - anchor.y) * aspectRatio),
      maxWidth,
      maxHeight * aspectRatio,
    );
    return normalizeCropRect(anchor, {
      x: anchor.x + directionX * width,
      y: anchor.y + directionY * width / aspectRatio,
    }, imageWidth, imageHeight);
  }
  const left = clamp(Math.min(start.x, end.x), 0, imageWidth);
  const top = clamp(Math.min(start.y, end.y), 0, imageHeight);
  const right = clamp(Math.max(start.x, end.x), 0, imageWidth);
  const bottom = clamp(Math.max(start.y, end.y), 0, imageHeight);
  const width = Math.round(right - left);
  const height = Math.round(bottom - top);
  if (width < 2 || height < 2) return null;
  return {
    height,
    width,
    x: Math.round(left),
    y: Math.round(top),
  };
}

export function createCenteredCropRect(imageWidth: number, imageHeight: number, aspectRatio: number, region?: ImageCropRect | null): ImageCropRect | null {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const bounds = region ?? { x: 0, y: 0, width: imageWidth, height: imageHeight };
  const width = Math.min(bounds.width, bounds.height * aspectRatio);
  const height = width / aspectRatio;
  const x = bounds.x + (bounds.width - width) / 2;
  const y = bounds.y + (bounds.height - height) / 2;
  return normalizeCropRect({ x, y }, { x: x + width, y: y + height }, imageWidth, imageHeight);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
