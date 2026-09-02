"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

type SupportedEditor = HTMLDivElement | HTMLTextAreaElement;

type EditorSelectionSnapshot =
  | {
      editor: HTMLTextAreaElement;
      end: number;
      kind: "textarea";
      start: number;
      direction: "backward" | "forward" | "none";
    }
  | {
      editor: HTMLDivElement;
      kind: "richText";
      range: Range | null;
    };

export function useEditorFocusReturn(
  editorRefs: Array<RefObject<SupportedEditor | null>>,
) {
  const snapshotRef = useRef<EditorSelectionSnapshot | null>(null);
  const editorRefsRef = useRef(editorRefs);
  const restoreFrameRef = useRef<number | null>(null);
  editorRefsRef.current = editorRefs;

  useEffect(() => {
    function preserveActiveEditorSelection() {
      const activeElement = document.activeElement;
      const editor = editorRefsRef.current
        .map((editorRef) => editorRef.current)
        .find((candidate) => candidate === activeElement);
      if (editor) snapshotRef.current = captureEditorSelection(editor);
    }

    function restoreEditorSelection() {
      const snapshot = snapshotRef.current;
      snapshotRef.current = null;
      if (!snapshot?.editor.isConnected) return;

      restoreFrameRef.current = window.requestAnimationFrame(() => {
        restoreFrameRef.current = null;
        const ownerDocument = snapshot.editor.ownerDocument;
        if (!snapshot.editor.isConnected || !ownerDocument.hasFocus()) return;
        if (
          ownerDocument.activeElement !== ownerDocument.body &&
          ownerDocument.activeElement !== snapshot.editor
        ) {
          return;
        }
        snapshot.editor.focus({ preventScroll: true });
        if (snapshot.kind === "textarea") {
          snapshot.editor.setSelectionRange(
            snapshot.start,
            snapshot.end,
            snapshot.direction,
          );
          return;
        }

        if (!snapshot.range) return;
        const selection = snapshot.editor.ownerDocument.defaultView?.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(snapshot.range);
      });
    }

    function cancelScheduledRestore() {
      if (restoreFrameRef.current === null) return;
      window.cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }

    window.addEventListener("blur", preserveActiveEditorSelection);
    window.addEventListener("focus", restoreEditorSelection);
    window.addEventListener("pointerdown", cancelScheduledRestore, true);
    return () => {
      cancelScheduledRestore();
      window.removeEventListener("blur", preserveActiveEditorSelection);
      window.removeEventListener("focus", restoreEditorSelection);
      window.removeEventListener("pointerdown", cancelScheduledRestore, true);
    };
  }, []);

  return useCallback((editor: SupportedEditor) => {
    if (snapshotRef.current?.editor === editor) return true;
    if (editor.ownerDocument.hasFocus()) return false;
    snapshotRef.current = captureEditorSelection(editor);
    return true;
  }, []);
}

function captureEditorSelection(
  editor: SupportedEditor,
): EditorSelectionSnapshot {
  if (editor instanceof HTMLTextAreaElement) {
    return {
      direction: editor.selectionDirection ?? "none",
      editor,
      end: editor.selectionEnd,
      kind: "textarea",
      start: editor.selectionStart,
    };
  }

  const selection = editor.ownerDocument.defaultView?.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  return {
    editor,
    kind: "richText",
    range: range && editor.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null,
  };
}
