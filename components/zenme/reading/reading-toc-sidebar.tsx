import { FileText, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";

import { findReadingNavigationIndex } from "./navigation";
import {
  getCenteredReadingTocScrollTop,
  getReadingTocVisibleRange,
  READING_TOC_ROW_HEIGHT,
} from "./toc-virtualization";

type NavigationSection = {
  endIndex: number;
  index: number;
  pageNumber?: number;
  title: string;
};

type ReadingTocSidebarProps = {
  activeSection: number;
  collapsed: boolean;
  navigationSections: NavigationSection[];
  onCollapsedChange: (collapsed: boolean) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSectionSelect: (index: number) => void;
};

export const ReadingTocSidebar = memo(function ReadingTocSidebar({
  activeSection,
  collapsed,
  navigationSections,
  onCollapsedChange,
  onResizeStart,
  onSectionSelect,
}: ReadingTocSidebarProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [visibleRange, setVisibleRange] = useState<[number, number]>([0, 40]);
  const activeNavigationIndex = useMemo(
    () => findReadingNavigationIndex(navigationSections, activeSection),
    [activeSection, navigationSections],
  );
  const updateVisibleRange = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const nextRange = getReadingTocVisibleRange({
      clientHeight: list.clientHeight,
      itemCount: navigationSections.length,
      scrollTop: list.scrollTop,
    });
    setVisibleRange((current) =>
      current[0] === nextRange[0] && current[1] === nextRange[1]
        ? current
        : nextRange,
    );
  }, [navigationSections.length]);
  const visibleSections = useMemo(
    () =>
      navigationSections.slice(visibleRange[0], visibleRange[1] + 1),
    [navigationSections, visibleRange],
  );

  useEffect(() => {
    if (collapsed || activeNavigationIndex < 0) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      list.scrollTop = getCenteredReadingTocScrollTop({
        clientHeight: list.clientHeight,
        itemCount: navigationSections.length,
        itemIndex: activeNavigationIndex,
      });
      updateVisibleRange();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    activeNavigationIndex,
    collapsed,
    navigationSections.length,
    updateVisibleRange,
  ]);

  useEffect(() => {
    if (collapsed) return;
    const frame = requestAnimationFrame(updateVisibleRange);
    return () => cancelAnimationFrame(frame);
  }, [collapsed, updateVisibleRange]);

  return (
    <aside className="relative min-h-0 border-r border-zinc-200 bg-zinc-50/70">
      <div className="flex h-10 items-center justify-between border-b border-zinc-200 px-3 text-xs font-medium text-zinc-500">
        {collapsed ? (
          <button
            aria-label="展开目录"
            className="flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            onClick={() => onCollapsedChange(false)}
            title="展开目录"
            type="button"
          >
            <PanelLeftOpen className="size-4" />
          </button>
        ) : (
          <>
            <span>目录</span>
            <button
              aria-label="收起目录"
              className="flex size-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
              onClick={() => onCollapsedChange(true)}
              title="收起目录"
              type="button"
            >
              <PanelLeftClose className="size-4" />
            </button>
          </>
        )}
      </div>
      {!collapsed ? (
        <OverlayScrollArea
          className="h-full"
          contentKey={String(navigationSections.length)}
          onScroll={updateVisibleRange}
          ref={listRef}
          viewportClassName="h-full overflow-auto px-2 py-2"
        >
          <div
            className="relative"
            style={{ height: navigationSections.length * READING_TOC_ROW_HEIGHT }}
          >
            {visibleSections.map((section, offset) => {
              const index = visibleRange[0] + offset;
              return (
                <button
                  className={`absolute left-0 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs leading-4 ${
                    activeSection >= section.index &&
                    activeSection <= section.endIndex
                      ? "bg-zinc-950 text-white"
                      : "text-zinc-700 hover:bg-zinc-100"
                  }`}
                  key={section.index}
                  onClick={() => onSectionSelect(section.index)}
                  style={{
                    height: READING_TOC_ROW_HEIGHT - 4,
                    top: index * READING_TOC_ROW_HEIGHT,
                  }}
                  type="button"
                >
                  <FileText className="size-3 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {section.title}
                  </span>
                  {section.pageNumber ? (
                    <span className="shrink-0 tabular-nums opacity-60">
                      {section.pageNumber}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </OverlayScrollArea>
      ) : null}
      {!collapsed ? (
        <div
          aria-label="调整目录宽度"
          className="absolute -right-1 top-0 h-full w-2 cursor-col-resize"
          onPointerDown={onResizeStart}
          role="separator"
          title="调整目录宽度"
        />
      ) : null}
    </aside>
  );
});
