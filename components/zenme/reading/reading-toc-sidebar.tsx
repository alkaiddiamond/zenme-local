import { FileText, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

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
  const activeItemRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeNavigationIndex = useMemo(
    () =>
      navigationSections.findIndex(
        (section) =>
          activeSection >= section.index && activeSection <= section.endIndex,
      ),
    [activeSection, navigationSections],
  );

  useEffect(() => {
    if (collapsed || activeNavigationIndex < 0) {
      return;
    }

    const scrollActiveItemIntoView = () => {
      const list = listRef.current;
      const activeItem = activeItemRef.current;
      if (!list || !activeItem) {
        return;
      }

      const listRect = list.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      const top = itemRect.top - listRect.top + list.scrollTop;
      const centeredTop = top - (list.clientHeight - itemRect.height) / 2;
      list.scrollTo({ top: Math.max(0, centeredTop) });
    };

    requestAnimationFrame(scrollActiveItemIntoView);
    const restoreTimer = window.setTimeout(scrollActiveItemIntoView, 120);
    return () => window.clearTimeout(restoreTimer);
  }, [activeNavigationIndex, collapsed]);

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
        <div className="h-full overflow-auto px-2 py-2" ref={listRef}>
          {navigationSections.map((section, index) => (
            <button
              className={`mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs leading-4 ${
                activeSection >= section.index &&
                activeSection <= section.endIndex
                  ? "bg-zinc-950 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
              key={section.index}
              onClick={() => onSectionSelect(section.index)}
              ref={index === activeNavigationIndex ? activeItemRef : null}
              type="button"
            >
              <FileText className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{section.title}</span>
              {section.pageNumber ? (
                <span className="shrink-0 tabular-nums opacity-60">
                  {section.pageNumber}
                </span>
              ) : null}
            </button>
          ))}
        </div>
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
