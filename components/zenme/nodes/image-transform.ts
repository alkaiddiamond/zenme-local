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
): ImageCropRect | null {
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
