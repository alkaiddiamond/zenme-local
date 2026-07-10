import { BookOpen, Minimize2 } from "lucide-react";
import { memo } from "react";

import { ReadingScaleControls } from "./reading-scale-controls";

type ReadingWorkspaceHeaderProps = {
  activeTitle: string;
  contentScale: number;
  nodeMode: boolean;
  onContentScaleChange: (scale: number) => void;
  onToggleCollapse?: () => void;
  supportsContentScale: boolean;
  title: string;
};

export const ReadingWorkspaceHeader = memo(function ReadingWorkspaceHeader({
  activeTitle,
  contentScale,
  nodeMode,
  onContentScaleChange,
  onToggleCollapse,
  supportsContentScale,
  title,
}: ReadingWorkspaceHeaderProps) {
  return (
    <div
      className={`relative z-20 flex h-12 shrink-0 items-center border-b border-zinc-200 bg-white px-4 ${
        nodeMode ? "cursor-move" : ""
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <BookOpen className="size-4 text-zinc-500" />
        <div className="min-w-0">
          <p className="truncate text-sm font-normal">{title}</p>
          <p className="truncate text-xs text-zinc-500">{activeTitle}</p>
        </div>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {supportsContentScale ? (
          <ReadingScaleControls
            contentScale={contentScale}
            onContentScaleChange={onContentScaleChange}
          />
        ) : null}
        {onToggleCollapse ? (
          <button
            aria-label="收起阅读器"
            className="nodrag flex size-8 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            onClick={onToggleCollapse}
            title="收起阅读器"
            type="button"
          >
            <Minimize2 className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
});
