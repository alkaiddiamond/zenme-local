"use client";

import { useEffect, useRef } from "react";

import {
  AlertCircle,
  Bot,
  Crosshair,
  EyeOff,
  Grid3X3,
  Group as GroupIcon,
  Map as MapIcon,
  MessageSquareText,
  Save,
  Search as SearchIcon,
  Sparkles,
  X,
} from "lucide-react";

import {
  ZenmeControlButton,
  ZenmeIconButton,
} from "@/components/zenme/visual-components";
import type { CanvasTextSearchResult } from "@/components/zenme/canvas/text-search";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";

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
  onArrange: () => void;
  onOpenAgent: () => void;
  onSave: () => void;
  onToggleSearch: () => void;
  searchOpen: boolean;
};

export function CanvasSideToolbar({
  onArrange,
  onOpenAgent,
  onSave,
  onToggleSearch,
  searchOpen,
}: CanvasSideToolbarProps) {
  return (
    <div
      className="zenme-shadow-canvas absolute left-3 top-1/2 z-20 flex w-[53px] -translate-y-1/2 flex-col items-center gap-2 rounded-full border border-zinc-200 bg-white/95 py-3 backdrop-blur"
      data-thumbnail-hidden="true"
    >
      <ZenmeIconButton
        aria-pressed={searchOpen}
        data-canvas-search-trigger="true"
        onClick={onToggleSearch}
        title="搜索画布"
      >
        <SearchIcon className="size-5" />
      </ZenmeIconButton>
      <ZenmeIconButton onClick={onArrange} title="快速整理画布">
        <Sparkles className="size-5" />
      </ZenmeIconButton>
      <ZenmeIconButton onClick={onOpenAgent} title="开启 Agent 对话">
        <MessageSquareText className="size-5" />
      </ZenmeIconButton>
      <ZenmeIconButton onClick={onSave} title="手动保存">
        <Save className="size-5" />
      </ZenmeIconButton>
    </div>
  );
}

type CanvasTextSearchPanelProps = {
  onClose: () => void;
  onFocusNode: (nodeId: string) => void;
  onQueryChange: (query: string) => void;
  query: string;
  results: CanvasTextSearchResult[];
};

export function CanvasTextSearchPanel({
  onClose,
  onFocusNode,
  onQueryChange,
  query,
  results,
}: CanvasTextSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function closeOnOutsidePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node) || panelRef.current?.contains(target)) return;
      if (
        target instanceof Element
        && target.closest("[data-canvas-search-trigger]")
      ) return;
      onClose();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [onClose]);

  return (
    <section
      aria-label="画布全文搜索"
      className="zenme-shadow-dropdown absolute left-[76px] top-1/2 z-30 flex max-h-[min(520px,calc(100%-2rem))] w-[360px] -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 backdrop-blur"
      data-thumbnail-hidden="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      ref={panelRef}
    >
      <div className="flex items-center gap-2 border-b border-zinc-100 p-3">
        <SearchIcon className="size-4 shrink-0 text-zinc-400" />
        <input
          aria-label="搜索画布内容"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索画布中的文本…"
          ref={inputRef}
          type="search"
          value={query}
        />
        <button
          aria-label="关闭搜索"
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
          onClick={onClose}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <OverlayScrollArea
        contentKey={`${query}\u0000${results.length}`}
        viewportClassName="min-h-20 overflow-y-auto p-2"
      >
        {!query.trim() ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-400">输入关键词搜索当前画布</p>
        ) : results.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-zinc-400">未找到匹配内容</p>
        ) : (
          <>
            <p className="px-2 pb-1 pt-0.5 text-xs text-zinc-400">找到 {results.length} 个节点</p>
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={result.id}>
                  <button
                    className="w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-zinc-100"
                    onClick={() => {
                      onFocusNode(result.id);
                      onClose();
                    }}
                    type="button"
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">{result.title}</span>
                      <span className="shrink-0 text-xs text-zinc-400">{result.kindLabel}</span>
                    </span>
                    {result.snippet ? (
                      <span className="mt-1 block line-clamp-2 text-xs leading-5 text-zinc-500">{result.snippet}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </OverlayScrollArea>
    </section>
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
