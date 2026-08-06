import { useCallback, useState } from "react";
import type { RefObject } from "react";

import type { TextSelection } from "./types";
import { readSelection } from "./utils";

export function useReadingSelection(input: {
  annotationLayerRef: RefObject<HTMLDivElement | null>;
  isPdf: boolean;
  onSectionSelect: (sectionIndex: number) => void;
}) {
  const { annotationLayerRef, isPdf, onSectionSelect } = input;
  const [selectedText, setSelectedText] = useState("");
  const [selection, setSelection] = useState<TextSelection | null>(null);

  const captureSelection = useCallback(() => {
    if (isPdf) {
      return;
    }
    const nextSelection = readSelection(annotationLayerRef.current);
    if (nextSelection) {
      clearNativeReadingSelection(window.getSelection());
      setSelection(nextSelection);
      setSelectedText(nextSelection.text);
      onSectionSelect(nextSelection.sectionIndex);
    }
  }, [annotationLayerRef, isPdf, onSectionSelect]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    setSelectedText("");
    clearNativeReadingSelection(window.getSelection());
  }, []);

  return {
    captureSelection,
    clearSelection,
    selectedText,
    selection,
    setSelectedText,
    setSelection,
  };
}

export function clearNativeReadingSelection(
  selection: Pick<Selection, "removeAllRanges"> | null | undefined,
) {
  selection?.removeAllRanges();
}
