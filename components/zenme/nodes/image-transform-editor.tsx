"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Brush, Check, Crop, Eraser, Layers, Loader2, RotateCcw, X } from "lucide-react";
import { IMAGE_EDIT_ASPECT_RATIO_OPTIONS } from "@/components/zenme/image-edit-options";
import { createCenteredCropRect, mapClientPointToImage, normalizeCropRect, type ImageCropRect, type ImagePoint } from "./image-transform";
import { commitImageEditStroke, composeImageEdit, drawCropGuide, drawImageEditStroke } from "./image-transform-rendering";

type ImageEditorTool = "crop" | "brush" | "mask" | "erase";
const TOOLS = [
  { value: "crop", label: "裁剪", Icon: Crop },
  { value: "brush", label: "画笔", Icon: Brush },
  { value: "mask", label: "蒙版笔", Icon: Layers },
  { value: "erase", label: "橡皮擦", Icon: Eraser },
] as const;

export function ImageTransformEditor({ imageUrl, onApply, onClose, title }: {
  imageUrl: string;
  onApply: (input: { file: File; height: number; width: number }) => Promise<void> | void;
  onClose: () => void;
  title: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sourceImageRef = useRef<HTMLImageElement | null>(null);
  const paintRef = useRef<HTMLCanvasElement | null>(null);
  const strokeRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef<number | null>(null);
  const lastPointRef = useRef<ImagePoint | null>(null);
  const cropStartRef = useRef<ImagePoint | null>(null);
  const previousCropRef = useRef<ImageCropRect | null>(null);
  const strokeSettingsRef = useRef({ size: 32, transparency: 0, color: "#ef4444", erase: false });
  const savingRef = useRef(false);
  const [tool, setTool] = useState<ImageEditorTool>("crop");
  const [cropRect, setCropRect] = useState<ImageCropRect | null>(null);
  const [cropRatio, setCropRatio] = useState("free");
  const [brushSize, setBrushSize] = useState(32);
  const [transparency, setTransparency] = useState({ brush: 0, mask: 50 });
  const [cursor, setCursor] = useState<{ x: number; y: number; diameter: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setReady(false);
    setError(undefined);
    setCropRect(null);
    setCropRatio("free");
    setDirty(false);
    void (async () => {
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error("图片读取失败");
        objectUrl = URL.createObjectURL(await response.blob());
        const image = await loadImage(objectUrl);
        if (cancelled) return;
        sourceImageRef.current = image;
        for (const ref of [paintRef, strokeRef, previewRef]) {
          const layer = document.createElement("canvas");
          layer.width = image.naturalWidth;
          layer.height = image.naturalHeight;
          ref.current = layer;
        }
        setReady(true);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "图片读取失败");
      } finally {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [imageUrl]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !savingRef.current) onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const output = canvasRef.current, source = sourceImageRef.current, paint = paintRef.current;
    if (!ready || !output || !source || !paint) return;
    composeImageEdit(output, source, paint);
    if (cropRect) drawCropGuide(output, cropRect);
  }, [ready, cropRect, tool]);

  function redraw(rect = cropRect, includeStroke = false) {
    const output = canvasRef.current, source = sourceImageRef.current, paint = paintRef.current, preview = previewRef.current, stroke = strokeRef.current;
    if (!output || !source || !paint || !preview || !stroke) return;
    let layer = paint;
    if (includeStroke) {
      const context = preview.getContext("2d")!;
      context.clearRect(0, 0, preview.width, preview.height);
      context.drawImage(paint, 0, 0);
      commitImageEditStroke(preview, stroke, strokeSettingsRef.current.transparency, strokeSettingsRef.current.erase);
      layer = preview;
    }
    composeImageEdit(output, source, layer);
    if (rect) drawCropGuide(output, rect);
  }

  function ratioValue(value = cropRatio) {
    const image = sourceImageRef.current;
    if (value === "free" || !image) return null;
    if (value === "original") return image.naturalWidth / image.naturalHeight;
    const [width, height] = value.split(":").map(Number);
    return width / height;
  }

  function changeRatio(value: string) {
    setCropRatio(value);
    const canvas = canvasRef.current, ratio = ratioValue(value);
    if (canvas && ratio) setCropRect(createCenteredCropRect(canvas.width, canvas.height, ratio, cropRect));
  }

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (tool !== "crop") setCursor({ x: event.clientX, y: event.clientY, diameter: brushSize * bounds.width / canvas.width });
    return mapClientPointToImage({ bounds, clientX: event.clientX, clientY: event.clientY, imageHeight: canvas.height, imageWidth: canvas.width });
  }

  function paintStroke(from: ImagePoint, to: ImagePoint) {
    const stroke = strokeRef.current;
    if (!stroke) return;
    drawImageEditStroke(stroke, from, to, strokeSettingsRef.current.size, strokeSettingsRef.current.color);
    redraw(cropRect, true);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready || savingRef.current || event.button !== 0 || pointerRef.current !== null) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = event.pointerId;
    lastPointRef.current = point;
    if (tool === "crop") {
      previousCropRef.current = cropRect;
      cropStartRef.current = point;
      setCropRect(null);
      redraw(null);
    } else {
      const stroke = strokeRef.current!;
      stroke.getContext("2d")!.clearRect(0, 0, stroke.width, stroke.height);
      strokeSettingsRef.current = { size: brushSize, transparency: tool === "erase" ? 0 : transparency[tool], color: tool === "brush" ? "#ef4444" : "#ffffff", erase: tool === "erase" };
      paintStroke(point, point);
    }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!ready || savingRef.current) return;
    const point = pointFromEvent(event);
    if (!point || pointerRef.current !== event.pointerId) return;
    if (tool === "crop") {
      const canvas = canvasRef.current, start = cropStartRef.current;
      if (canvas && start) {
        const rect = normalizeCropRect(start, point, canvas.width, canvas.height, ratioValue());
        setCropRect(rect);
        redraw(rect);
      }
    } else paintStroke(lastPointRef.current ?? point, point);
    lastPointRef.current = point;
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (pointerRef.current !== event.pointerId) return;
    if (event.type === "pointerup") {
      handlePointerMove(event);
      if (tool !== "crop" && paintRef.current && strokeRef.current) {
        commitImageEditStroke(paintRef.current, strokeRef.current, strokeSettingsRef.current.transparency, strokeSettingsRef.current.erase);
        setDirty(true);
        redraw();
      }
    } else if (tool === "crop") {
      setCropRect(previousCropRef.current);
      redraw(previousCropRef.current);
    } else redraw();
    pointerRef.current = null;
    lastPointRef.current = null;
    cropStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function reset() {
    if (savingRef.current) return;
    const paint = paintRef.current;
    paint?.getContext("2d")?.clearRect(0, 0, paint.width, paint.height);
    pointerRef.current = null;
    setCropRect(null);
    setCropRatio("free");
    setDirty(false);
    redraw(null);
  }

  async function apply() {
    const source = sourceImageRef.current, paint = paintRef.current;
    if (!ready || !source || !paint || savingRef.current || (!dirty && !cropRect)) return;
    savingRef.current = true;
    setSaving(true);
    setCursor(null);
    setError(undefined);
    try {
      const output = document.createElement("canvas");
      composeImageEdit(output, source, paint, cropRect);
      const blob = await canvasToBlob(output);
      await onApply({ file: new File([blob], `edited-${Date.now()}.png`, { type: "image/png" }), height: output.height, width: output.width });
      onClose();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "图片处理失败");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const canApply = ready && !saving && (dirty || Boolean(cropRect));
  return createPortal(
    <div aria-label="图片编辑器" aria-modal="true" role="dialog" className="fixed inset-0 z-[1100] flex flex-col bg-zinc-950/95 text-white">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-3">
        <div><p className="text-sm font-medium">编辑图片</p><p className="mt-0.5 text-xs text-zinc-400">{title} · 裁剪与绘制可组合使用，原图保持不变</p></div>
        <div className="flex items-center gap-2">
          <button className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-zinc-300 hover:bg-white/10 disabled:opacity-40" disabled={!ready || saving} onClick={reset} type="button"><RotateCcw className="size-4" />重置</button>
          <button className="flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-sm font-medium text-zinc-950 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400" disabled={!canApply} onClick={() => void apply()} type="button">{saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}生成新节点</button>
          <button aria-label="关闭图片编辑" className="flex size-9 items-center justify-center rounded-full text-zinc-400 hover:bg-white/10 disabled:opacity-40" disabled={saving} onClick={onClose} type="button"><X className="size-4" /></button>
        </div>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-white/10 px-5 py-3">
        <div aria-label="编辑工具" className="flex gap-1">
          {TOOLS.map(({ value, label, Icon }) => <button aria-pressed={tool === value} className={`flex h-9 items-center gap-2 rounded-lg px-3 text-sm ${tool === value ? "bg-white text-zinc-950" : "text-zinc-300 hover:bg-white/10"}`} disabled={!ready || saving} key={value} onClick={() => { setTool(value); setCursor(null); }} type="button"><Icon className="size-4" />{label}</button>)}
        </div>
        {tool === "crop" ? <>
          <label className="flex items-center gap-2 text-sm">裁剪比例<select aria-label="裁剪比例" className="rounded-lg border border-white/20 bg-zinc-900 px-3 py-2" disabled={!ready || saving} onChange={(event) => changeRatio(event.target.value)} value={cropRatio}><option value="free">自由</option><option value="original">原图比例</option>{IMAGE_EDIT_ASPECT_RATIO_OPTIONS.filter((option) => option.value !== "auto").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <button className="text-xs text-zinc-400 hover:text-white disabled:opacity-40" disabled={!cropRect || saving} onClick={() => { setCropRect(null); setCropRatio("free"); }} type="button">取消裁剪框</button>
        </> : <label className="flex items-center gap-2 text-xs">笔刷大小<input aria-label="笔刷大小" disabled={saving} max={200} min={1} onChange={(event) => { setBrushSize(Number(event.target.value)); setCursor(null); }} type="range" value={brushSize} /><span className="w-12 tabular-nums" title="原图像素">{brushSize} px</span></label>}
        {tool === "mask" || tool === "brush" ? <label className="flex items-center gap-2 text-xs">{tool === "mask" ? "蒙版透明度" : "笔刷透明度"}<input aria-label={tool === "mask" ? "蒙版透明度" : "笔刷透明度"} disabled={saving} max={100} min={0} onChange={(event) => setTransparency((current) => ({ ...current, [tool]: Number(event.target.value) }))} type="range" value={transparency[tool]} /><span className="w-9 tabular-nums">{transparency[tool]}%</span></label> : null}
      </div>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black/40">
          {!ready && !error ? <Loader2 className="size-7 animate-spin text-zinc-500" /> : null}
          <canvas aria-label="图片编辑画布" className={`max-h-full max-w-full touch-none object-contain ${tool === "crop" ? "cursor-cell" : "cursor-none"}`} onLostPointerCapture={handlePointerEnd} onPointerCancel={handlePointerEnd} onPointerDown={handlePointerDown} onPointerLeave={() => setCursor(null)} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} ref={canvasRef} />
        </div>
      </main>
      {cursor && tool !== "crop" && !saving ? <div aria-hidden="true" className="pointer-events-none fixed rounded-full border border-white shadow-[0_0_0_1px_#000]" style={{ left: cursor.x, top: cursor.y, width: cursor.diameter, height: cursor.diameter, transform: "translate(-50%, -50%)" }} /> : null}
      <footer className="shrink-0 space-y-1 px-5 pb-4 text-center text-xs text-zinc-400">
        {error ? <p role="alert" className="text-red-300">{error}</p> : null}
        <p>{cropRect ? `裁剪尺寸：${cropRect.width} × ${cropRect.height} · ` : ""}{tool === "erase" ? "擦除绘制内容，不影响原图" : tool === "crop" ? "拖动选择保留区域；切换画笔不会丢失裁剪框" : "大小与透明度仅影响新笔触；生成后合成为普通图片"}</p>
      </footer>
    </div>, document.body,
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

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("无法导出处理后的图片")), "image/png");
  });
}
