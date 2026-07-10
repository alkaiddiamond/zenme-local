import { Minus, Plus, RotateCcw } from "lucide-react";

import {
  CONTENT_SCALE_MAX,
  CONTENT_SCALE_MIN,
  CONTENT_SCALE_STEP,
} from "./constants";

type ReadingScaleControlsProps = {
  contentScale: number;
  onContentScaleChange: (value: number) => void;
};

export function ReadingScaleControls({
  contentScale,
  onContentScaleChange,
}: ReadingScaleControlsProps) {
  const contentScaleLabel = `${Math.round(contentScale * 100)}%`;

  return (
    <div
      aria-label="阅读内容缩放"
      className="nodrag flex h-8 items-center gap-1 rounded-md border border-zinc-200 bg-white p-1 text-xs text-zinc-600"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <button
        aria-label="缩小阅读内容"
        className="flex size-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={contentScale <= CONTENT_SCALE_MIN}
        onClick={() => onContentScaleChange(contentScale - CONTENT_SCALE_STEP)}
        title="缩小阅读内容"
        type="button"
      >
        <Minus className="size-3.5" />
      </button>
      <button
        aria-label="重置阅读内容缩放"
        className="flex h-6 min-w-12 items-center justify-center rounded px-1 font-medium tabular-nums text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950"
        onClick={() => onContentScaleChange(1)}
        title="重置阅读内容缩放"
        type="button"
      >
        {contentScaleLabel}
      </button>
      <button
        aria-label="放大阅读内容"
        className="flex size-6 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={contentScale >= CONTENT_SCALE_MAX}
        onClick={() => onContentScaleChange(contentScale + CONTENT_SCALE_STEP)}
        title="放大阅读内容"
        type="button"
      >
        <Plus className="size-3.5" />
      </button>
      <button
        aria-label="恢复 100%"
        className="flex size-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-950"
        onClick={() => onContentScaleChange(1)}
        title="恢复 100%"
        type="button"
      >
        <RotateCcw className="size-3.5" />
      </button>
    </div>
  );
}
