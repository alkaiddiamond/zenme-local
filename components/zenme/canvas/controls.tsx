"use client";

import {
  AlertCircle,
  Bot,
  Crosshair,
  EyeOff,
  Folder,
  Grid3X3,
  Group as GroupIcon,
  History,
  Map as MapIcon,
  MessageSquareText,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";

import {
  ZenmeControlButton,
  ZenmeIconButton,
} from "@/components/zenme/visual-components";

type CanvasSelectionToolbarProps = {
  left: number;
  onGroupSelectedNodes: () => void;
  top: number;
};

export function CanvasSelectionToolbar({
  left,
  onGroupSelectedNodes,
  top,
}: CanvasSelectionToolbarProps) {
  return (
    <div
      className="zenme-shadow-canvas fixed z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 text-zinc-800 backdrop-blur"
      data-thumbnail-hidden="true"
      style={{ left, top }}
    >
      <button
        className="inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium transition hover:bg-zinc-100 hover:text-zinc-950"
        onClick={onGroupSelectedNodes}
        type="button"
      >
        <GroupIcon className="size-4 text-zinc-500" />
        打组
      </button>
    </div>
  );
}

type CanvasSideToolbarProps = {
  onOpenAgent: () => void;
  onSave: () => void;
  onZoomIn: () => void;
};

export function CanvasSideToolbar({
  onOpenAgent,
  onSave,
  onZoomIn,
}: CanvasSideToolbarProps) {
  return (
    <div
      className="zenme-shadow-canvas absolute left-3 top-1/2 z-20 flex w-[53px] -translate-y-1/2 flex-col items-center gap-2 rounded-full border border-zinc-200 bg-white/95 py-3 backdrop-blur"
      data-thumbnail-hidden="true"
    >
      <ZenmeIconButton active onClick={onZoomIn} title="放大画布">
        <Plus className="size-6" />
      </ZenmeIconButton>
      <ZenmeIconButton className="relative" title="项目文件">
        <Folder className="size-5" />
        <span className="absolute -right-1 -top-1 size-2 rounded-full bg-sky-400" />
      </ZenmeIconButton>
      <ZenmeIconButton title="项目侧栏占位">
        <SlidersHorizontal className="size-5" />
      </ZenmeIconButton>
      <ZenmeIconButton onClick={onOpenAgent} title="开启 Agent 对话">
        <MessageSquareText className="size-5" />
      </ZenmeIconButton>
      <ZenmeIconButton onClick={onSave} title="手动保存">
        <History className="size-5" />
      </ZenmeIconButton>
      <div className="h-px w-10 bg-zinc-200" />
      <button
        className="flex size-9 items-center justify-center rounded-full bg-zinc-100 text-base font-medium text-zinc-700"
        type="button"
      >
        A
      </button>
    </div>
  );
}

type CanvasBottomControlsProps = {
  onFitView: () => void;
  onToggleMiniMap: () => void;
  onToggleSnapToGrid: () => void;
  onZoomChange: (zoom: number) => void;
  showMiniMap: boolean;
  zoomLevel: number;
};

export function CanvasBottomControls({
  onFitView,
  onToggleMiniMap,
  onToggleSnapToGrid,
  onZoomChange,
  showMiniMap,
  zoomLevel,
}: CanvasBottomControlsProps) {
  return (
    <div
      className="zenme-shadow-canvas absolute bottom-3 left-3 z-20 flex w-[200px] items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1.5 backdrop-blur"
      data-thumbnail-hidden="true"
    >
      <ZenmeControlButton
        className="size-8 rounded-full shadow-none"
        onClick={onToggleMiniMap}
        title={showMiniMap ? "关闭小地图" : "打开小地图"}
      >
        {showMiniMap ? (
          <EyeOff className="size-4" />
        ) : (
          <MapIcon className="size-4" />
        )}
      </ZenmeControlButton>
      <ZenmeControlButton
        className="size-8 rounded-full shadow-none"
        onClick={onToggleSnapToGrid}
        title="网格吸附"
      >
        <Grid3X3 className="size-4" />
      </ZenmeControlButton>
      <ZenmeControlButton
        className="size-8 rounded-full shadow-none"
        onClick={onFitView}
        title="重置位置"
      >
        <Crosshair className="size-4" />
      </ZenmeControlButton>
      <div className="flex h-8 min-w-0 flex-1 items-center rounded-full border border-zinc-200 bg-white px-2.5">
        <input
          aria-label="缩放画布"
          className="h-1 w-full accent-zinc-800"
          max="2"
          min="0.2"
          onChange={(event) => onZoomChange(Number(event.target.value))}
          onInput={(event) => onZoomChange(Number(event.currentTarget.value))}
          step="0.01"
          type="range"
          value={zoomLevel}
        />
      </div>
    </div>
  );
}

type CanvasAgentButtonProps = {
  onOpenAgent: () => void;
};

export function CanvasAgentButton({ onOpenAgent }: CanvasAgentButtonProps) {
  return (
    <ZenmeIconButton
      className="zenme-shadow-canvas absolute bottom-5 right-5 z-10 bg-white text-zinc-700 ring-1 ring-zinc-200"
      data-thumbnail-hidden="true"
      onClick={onOpenAgent}
      title="开启 Agent 对话"
    >
      <Bot className="size-5" />
    </ZenmeIconButton>
  );
}

type CanvasNoticeProps = {
  message: string;
  onClose: () => void;
};

export function CanvasNotice({ message, onClose }: CanvasNoticeProps) {
  return (
    <div
      className="zenme-shadow-dropdown absolute right-5 top-5 z-40 flex max-w-md items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      data-thumbnail-hidden="true"
    >
      <AlertCircle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        className="flex size-6 items-center justify-center rounded-full text-red-500 hover:bg-red-100 hover:text-red-700"
        onClick={onClose}
        type="button"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function EmptyCanvasHint() {
  return (
    <div
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 w-[420px] max-w-[calc(100vw-96px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-200 bg-white/80 px-6 py-5 text-center text-sm leading-6 text-zinc-500"
      data-thumbnail-hidden="true"
    >
      <p>双击画布创建一个节点</p>
      <p>或上传一本书、一张图片、一段文字...</p>
    </div>
  );
}
