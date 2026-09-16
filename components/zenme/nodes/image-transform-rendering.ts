import type { ImageCropRect, ImagePoint } from "./image-transform";

export function drawImageEditStroke(canvas: HTMLCanvasElement, from: ImagePoint, to: ImagePoint, size: number, color: string) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建绘制图层");
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = size;
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(from.x, from.y, size / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

export function commitImageEditStroke(paint: HTMLCanvasElement, stroke: HTMLCanvasElement, transparency: number, erase = false) {
  const context = paint.getContext("2d");
  if (!context) throw new Error("无法创建绘制图层");
  context.save();
  context.globalCompositeOperation = erase ? "destination-out" : "source-over";
  // Bake opacity once per stroke; later brush changes never affect old strokes.
  context.globalAlpha = 1 - Math.min(100, Math.max(0, transparency)) / 100;
  context.drawImage(stroke, 0, 0);
  context.restore();
}

export function composeImageEdit(output: HTMLCanvasElement, source: CanvasImageSource, paint: HTMLCanvasElement, crop?: ImageCropRect | null) {
  const rect = crop ?? { x: 0, y: 0, width: paint.width, height: paint.height };
  if (output.width !== rect.width) output.width = rect.width;
  if (output.height !== rect.height) output.height = rect.height;
  const context = output.getContext("2d");
  if (!context) throw new Error("无法创建图片画布");
  context.clearRect(0, 0, output.width, output.height);
  for (const layer of [source, paint]) {
    context.drawImage(layer, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  }
}

export function drawCropGuide(canvas: HTMLCanvasElement, rect: ImageCropRect) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.fillRect(0, 0, canvas.width, rect.y);
  context.fillRect(0, rect.y + rect.height, canvas.width, canvas.height - rect.y - rect.height);
  context.fillRect(0, rect.y, rect.x, rect.height);
  context.fillRect(rect.x + rect.width, rect.y, canvas.width - rect.x - rect.width, rect.height);
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(1, Math.min(canvas.width, canvas.height) * 0.002);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}
