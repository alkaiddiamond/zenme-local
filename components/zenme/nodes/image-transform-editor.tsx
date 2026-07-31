"use client";

import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, RotateCcw, X } from "lucide-react";

import {
  mapClientPointToImage,
  normalizeCropRect,
  type ImageCropRect,
  type ImagePoint,
} from "./image-transform";

export type ImageTransformMode = "brush" | "crop";

export function ImageTransformEditor({
  imageUrl,
  mode,
  onApply,
  onClose,
  title,
}: {
  imageUrl: string;
  mode: ImageTransformMode;
  onApply: (input: { file: File; height: number; width: number }) => Promise<void> | void;
  onClose: () => void;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<ImagePoint | null>(null);
  const cropStartRef = useRef<ImagePoint | null>(null);
  const cropEndRef = useRef<ImagePoint | null>(null);
  const [cropRect, setCropRect] = useState<ImageCropRect | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;

    void (async () => {
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("图片读取失败");
        objectUrl = URL.createObjectURL(await response.blob());
        const image = await loadImage(objectUrl);
        if (cancelled) return;
        sourceImageRef.current = image;
        drawSourceImage(canvasRef.current, image);
        setReady(true);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "图片读取失败");
        }
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return mapClientPointToImage({
      bounds: canvas.getBoundingClientRect(),
      clientX: event.clientX,
      clientY: event.clientY,
      imageHeight: canvas.height,
      imageWidth: canvas.width,
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready || saving) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    if (mode === "brush") {
      lastPointRef.current = point;
      drawBrushStroke(canvasRef.current, point, point);
      setDirty(true);
      return;
    }
    cropStartRef.current = point;
    cropEndRef.current = point;
    setCropRect(null);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (mode === "brush") {
      const previous = lastPointRef.current ?? point;
      drawBrushStroke(canvasRef.current, previous, point);
      lastPointRef.current = point;
      return;
    }
    cropEndRef.current = point;
    const canvas = canvasRef.current;
    const image = sourceImageRef.current;
    const start = cropStartRef.current;
    if (!canvas || !image || !start) return;
    const nextRect = normalizeCropRect(start, point, canvas.width, canvas.height);
    setCropRect(nextRect);
    drawCropPreview(canvas, image, nextRect);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastPointRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function reset() {
    const image = sourceImageRef.current;
    if (image) drawSourceImage(canvasRef.current, image);
    drawingRef.current = false;
    lastPointRef.current = null;
    cropStartRef.current = null;
    cropEndRef.current = null;
    setCropRect(null);
    setDirty(false);
  }

  async function apply() {
    const sourceCanvas = canvasRef.current;
    const sourceImage = sourceImageRef.current;
    if (!sourceCanvas || !sourceImage || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const output = document.createElement("canvas");
      if (mode === "crop") {
        if (!cropRect) return;
        output.width = cropRect.width;
        output.height = cropRect.height;
        output.getContext("2d")?.drawImage(
          sourceImage,
          cropRect.x,
          cropRect.y,
          cropRect.width,
          cropRect.height,
          0,
          0,
          cropRect.width,
          cropRect.height,
        );
      } else {
        if (!dirty) return;
        output.width = sourceCanvas.width;
        output.height = sourceCanvas.height;
        output.getContext("2d")?.drawImage(sourceCanvas, 0, 0);
      }
      const blob = await canvasToBlob(output);
      const operationLabel = mode === "brush" ? "marked" : "cropped";
      await onApply({
        file: new File([blob], `${operationLabel}-${Date.now()}.png`, {
          type: "image/png",
        }),
        height: output.height,
        width: output.width,
      });
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "图片处理失败");
    } finally {
      setSaving(false);
    }
  }

  const canApply = ready && !saving && (mode === "brush" ? dirty : Boolean(cropRect));

  return createPortal(
    <div className="fixed inset-0 z-[1100] flex flex-col bg-zinc-950/95 text-white">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div>
          <p className="text-sm font-medium">{mode === "brush" ? "画笔标记" : "裁剪图片"}</p>
          <p className="mt-0.5 text-xs text-zinc-400">
            {title} · {mode === "brush" ? "在图片上拖动画笔进行标记" : "拖动选择需要保留的区域"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white"
            onClick={reset}
            type="button"
          >
            <RotateCcw className="size-4" />
            重置
          </button>
          <button
            className="flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
            disabled={!canApply}
            onClick={() => void apply()}
            type="button"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            生成新节点
          </button>
          <button
            aria-label="关闭图片编辑"
            className="flex size-9 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black/40">
          {!ready && !error ? <Loader2 className="size-7 animate-spin text-zinc-500" /> : null}
          {error ? <p className="rounded-lg bg-red-950/70 px-4 py-3 text-sm text-red-200">{error}</p> : null}
          <canvas
            className={`max-h-full max-w-full touch-none object-contain ${mode === "brush" ? "cursor-crosshair" : "cursor-cell"}`}
            onPointerCancel={handlePointerUp}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            ref={canvasRef}
          />
        </div>
      </main>
      {mode === "crop" && cropRect ? (
        <footer className="shrink-0 pb-4 text-center text-xs text-zinc-400">
          裁剪尺寸：{cropRect.width} × {cropRect.height}
        </footer>
      ) : null}
    </div>,
    document.body,
  );
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = source;
  });
}

function drawSourceImage(canvas: HTMLCanvasElement | null, image: HTMLImageElement) {
  if (!canvas) return;
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  context?.clearRect(0, 0, canvas.width, canvas.height);
  context?.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function drawBrushStroke(
  canvas: HTMLCanvasElement | null,
  from: ImagePoint,
  to: ImagePoint,
) {
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;
  context.save();
  context.strokeStyle = "#ef4444";
  context.fillStyle = "#ef4444";
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = Math.max(4, Math.min(canvas.width, canvas.height) * 0.012);
  context.beginPath();
  context.moveTo(from.x, from.y);
  context.lineTo(to.x, to.y);
  context.stroke();
  if (from.x === to.x && from.y === to.y) {
    context.beginPath();
    context.arc(from.x, from.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawCropPreview(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  rect: ImageCropRect | null,
) {
  drawSourceImage(canvas, image);
  if (!rect) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
  );
  context.strokeStyle = "#ffffff";
  context.lineWidth = Math.max(2, Math.min(canvas.width, canvas.height) * 0.003);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("无法导出处理后的图片"));
    }, "image/png");
  });
}
