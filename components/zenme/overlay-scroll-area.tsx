"use client";

import {
  type HTMLAttributes,
  forwardRef,
  useImperativeHandle,
  useRef,
} from "react";

import { OverlayScrollbars } from "@/components/zenme/nodes/overlay-scrollbar";

type OverlayScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  contentKey?: string;
  viewportClassName?: string;
};

export const OverlayScrollArea = forwardRef<
  HTMLDivElement,
  OverlayScrollAreaProps
>(function OverlayScrollArea(
  {
    children,
    className = "",
    contentKey,
    viewportClassName = "",
    ...viewportProps
  },
  forwardedRef,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(forwardedRef, () => viewportRef.current as HTMLDivElement);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <div
        {...viewportProps}
        className={`zenme-overlay-scroll-container ${viewportClassName}`}
        ref={viewportRef}
      >
        {children}
      </div>
      <OverlayScrollbars contentKey={contentKey} scrollRef={viewportRef} />
    </div>
  );
});
