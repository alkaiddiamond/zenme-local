import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  NOTES_DEFAULT_WIDTH_MODAL,
  NOTES_DEFAULT_WIDTH_NODE,
  NOTES_MAX_WIDTH,
  NOTES_MIN_WIDTH,
  TOC_DEFAULT_WIDTH_MODAL,
  TOC_DEFAULT_WIDTH_NODE,
  TOC_MAX_WIDTH,
  TOC_MIN_WIDTH,
} from "./constants";

type ResizeState = {
  startWidth: number;
  startX: number;
};

export function useResizableReadingPanels(input: { nodeMode: boolean }) {
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [tocDraftWidth, setTocDraftWidth] = useState<number | null>(null);
  const [tocWidth, setTocWidth] = useState(() =>
    input.nodeMode ? TOC_DEFAULT_WIDTH_NODE : TOC_DEFAULT_WIDTH_MODAL,
  );
  const [notesDraftWidth, setNotesDraftWidth] = useState<number | null>(null);
  const [notesWidth, setNotesWidth] = useState(() =>
    input.nodeMode ? NOTES_DEFAULT_WIDTH_NODE : NOTES_DEFAULT_WIDTH_MODAL,
  );
  const tocResizeRef = useRef<ResizeState | null>(null);
  const notesResizeRef = useRef<ResizeState | null>(null);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const tocResizeState = tocResizeRef.current;
      if (tocResizeState) {
        const nextWidth = clampPanelWidth(
          tocResizeState.startWidth + event.clientX - tocResizeState.startX,
          TOC_MIN_WIDTH,
          TOC_MAX_WIDTH,
        );
        setTocDraftWidth(nextWidth);
      }

      const notesResizeState = notesResizeRef.current;
      if (notesResizeState) {
        const nextWidth = clampPanelWidth(
          notesResizeState.startWidth -
            (event.clientX - notesResizeState.startX),
          NOTES_MIN_WIDTH,
          NOTES_MAX_WIDTH,
        );
        setNotesDraftWidth(nextWidth);
      }
    }

    function handlePointerUp() {
      if (tocDraftWidth !== null) {
        setTocWidth(tocDraftWidth);
        setTocDraftWidth(null);
      }
      if (notesDraftWidth !== null) {
        setNotesWidth(notesDraftWidth);
        setNotesDraftWidth(null);
      }
      tocResizeRef.current = null;
      notesResizeRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [notesDraftWidth, tocDraftWidth]);

  const startTocResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setTocCollapsed(false);
      setTocDraftWidth(tocWidth);
      tocResizeRef.current = {
        startWidth: tocWidth,
        startX: event.clientX,
      };
    },
    [tocWidth],
  );

  const startNotesResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setNotesDraftWidth(notesWidth);
      notesResizeRef.current = {
        startWidth: notesWidth,
        startX: event.clientX,
      };
    },
    [notesWidth],
  );

  return {
    notesDraftWidth,
    notesWidth,
    setTocCollapsed,
    startNotesResize,
    startTocResize,
    tocCollapsed,
    tocDraftWidth,
    tocWidth,
  };
}

function clampPanelWidth(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
