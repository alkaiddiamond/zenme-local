"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const TRACK_INSET = 8;
const MIN_THUMB_HEIGHT = 28;
const CONTENT_MEASURE_DELAY = 180;

type OverlayScrollbarProps = {
  axis?: "horizontal" | "vertical";
  contentKey?: string;
  scrollRef: RefObject<HTMLElement | null>;
};

type ScrollbarMetrics = {
  thumbOffset: number;
  thumbSize: number;
  visible: boolean;
};

export function areOverlayScrollbarMetricsEqual(
  left: ScrollbarMetrics,
  right: ScrollbarMetrics,
) {
  return (
    left.visible === right.visible &&
    Math.abs(left.thumbSize - right.thumbSize) < 0.1 &&
    Math.abs(left.thumbOffset - right.thumbOffset) < 0.1
  );
}

const hiddenMetrics: ScrollbarMetrics = {
  thumbOffset: 0,
  thumbSize: 0,
  visible: false,
};

export function getOverlayScrollbarMetrics({
  clientSize,
  scrollOffset,
  scrollSize,
}: {
  clientSize: number;
  scrollOffset: number;
  scrollSize: number;
}): ScrollbarMetrics {
  const trackSize = Math.max(0, clientSize - TRACK_INSET * 2);
  const maxScrollOffset = Math.max(0, scrollSize - clientSize);

  if (maxScrollOffset <= 1 || trackSize <= 0) {
    return hiddenMetrics;
  }

  const thumbSize = Math.min(
    trackSize,
    Math.max(MIN_THUMB_HEIGHT, (clientSize / scrollSize) * trackSize),
  );
  const maxThumbOffset = Math.max(0, trackSize - thumbSize);
  const boundedScrollOffset = Math.min(
    maxScrollOffset,
    Math.max(0, scrollOffset),
  );

  return {
    thumbOffset: (boundedScrollOffset / maxScrollOffset) * maxThumbOffset,
    thumbSize,
    visible: true,
  };
}

export function OverlayScrollbar({
  axis = "vertical",
  contentKey,
  scrollRef,
}: OverlayScrollbarProps) {
  const [metrics, setMetrics] = useState<ScrollbarMetrics>(hiddenMetrics);
  const [isDragging, setIsDragging] = useState(false);
  const contentMeasureTimerRef = useRef<number | null>(null);
  const updateFrameRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startClientPosition: number;
    startScrollOffset: number;
  } | null>(null);

  const updateMetrics = useCallback(() => {
    const element = scrollRef.current;

    if (!element) {
      setMetrics(hiddenMetrics);
      return;
    }

    const nextMetrics = getOverlayScrollbarMetrics({
      clientSize:
        axis === "vertical" ? element.clientHeight : element.clientWidth,
      scrollOffset:
        axis === "vertical" ? element.scrollTop : element.scrollLeft,
      scrollSize:
        axis === "vertical" ? element.scrollHeight : element.scrollWidth,
    });

    setMetrics((currentMetrics) =>
      areOverlayScrollbarMetricsEqual(currentMetrics, nextMetrics)
        ? currentMetrics
        : nextMetrics,
    );
  }, [axis, scrollRef]);

  const scheduleMetricsUpdate = useCallback(() => {
    if (updateFrameRef.current !== null) {
      return;
    }

    updateFrameRef.current = requestAnimationFrame(() => {
      updateFrameRef.current = null;
      updateMetrics();
    });
  }, [updateMetrics]);

  const scheduleContentMetricsUpdate = useCallback(() => {
    if (contentMeasureTimerRef.current !== null) {
      window.clearTimeout(contentMeasureTimerRef.current);
    }

    contentMeasureTimerRef.current = window.setTimeout(() => {
      contentMeasureTimerRef.current = null;
      scheduleMetricsUpdate();
    }, CONTENT_MEASURE_DELAY);
  }, [scheduleMetricsUpdate]);

  useEffect(() => {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    const resizeObserver = new ResizeObserver(scheduleMetricsUpdate);

    element.addEventListener("input", scheduleContentMetricsUpdate);
    element.addEventListener("scroll", scheduleMetricsUpdate, { passive: true });
    resizeObserver.observe(element);
    scheduleMetricsUpdate();

    return () => {
      if (contentMeasureTimerRef.current !== null) {
        window.clearTimeout(contentMeasureTimerRef.current);
        contentMeasureTimerRef.current = null;
      }
      if (updateFrameRef.current !== null) {
        cancelAnimationFrame(updateFrameRef.current);
        updateFrameRef.current = null;
      }
      element.removeEventListener("input", scheduleContentMetricsUpdate);
      element.removeEventListener("scroll", scheduleMetricsUpdate);
      resizeObserver.disconnect();
    };
  }, [scheduleContentMetricsUpdate, scheduleMetricsUpdate, scrollRef]);

  useEffect(() => {
    if (contentKey !== undefined) {
      scheduleContentMetricsUpdate();
    }
  }, [contentKey, scheduleContentMetricsUpdate]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;

    if (!element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientPosition:
        axis === "vertical" ? event.clientY : event.clientX,
      startScrollOffset:
        axis === "vertical" ? element.scrollTop : element.scrollLeft,
    };
    setIsDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const element = scrollRef.current;
    const dragState = dragStateRef.current;

    if (!element || !dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const clientSize =
      axis === "vertical" ? element.clientHeight : element.clientWidth;
    const scrollSize =
      axis === "vertical" ? element.scrollHeight : element.scrollWidth;
    const clientPosition =
      axis === "vertical" ? event.clientY : event.clientX;
    const trackSize = Math.max(0, clientSize - TRACK_INSET * 2);
    const thumbTravel = Math.max(0, trackSize - metrics.thumbSize);
    const maxScrollOffset = Math.max(0, scrollSize - clientSize);

    if (thumbTravel > 0) {
      const nextScrollOffset =
        dragState.startScrollOffset +
        ((clientPosition - dragState.startClientPosition) / thumbTravel) *
          maxScrollOffset;
      if (axis === "vertical") {
        element.scrollTop = nextScrollOffset;
      } else {
        element.scrollLeft = nextScrollOffset;
      }
    }
  }

  function finishDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    event.stopPropagation();
    dragStateRef.current = null;
    setIsDragging(false);
  }

  if (!metrics.visible) {
    return null;
  }

  return (
    <div
      aria-hidden
      className={`nodrag pointer-events-none absolute z-20 ${
        axis === "vertical"
          ? "bottom-2 right-1.5 top-2 w-2"
          : "bottom-1.5 left-2 right-2 h-2"
      }`}
    >
      <div
        className={`nowheel pointer-events-auto absolute rounded-full transition-colors ${
          axis === "vertical" ? "right-0 w-1.5" : "bottom-0 h-1.5"
        } ${
          isDragging
            ? "bg-zinc-500"
            : "bg-zinc-300/80 hover:bg-zinc-400"
        }`}
        onPointerCancel={finishDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDragging}
        style={{
          ...(axis === "vertical"
            ? { height: metrics.thumbSize, top: metrics.thumbOffset }
            : { left: metrics.thumbOffset, width: metrics.thumbSize }),
          touchAction: "none",
        }}
      />
    </div>
  );
}

export function OverlayScrollbars(props: Omit<OverlayScrollbarProps, "axis">) {
  return (
    <>
      <OverlayScrollbar {...props} axis="vertical" />
      <OverlayScrollbar {...props} axis="horizontal" />
    </>
  );
}
