"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import type {
  ReadingAnnotationColor,
  ReadingAsset,
  ReadingNote,
} from "@/lib/reading/types";
import { writeTextToClipboard } from "@/lib/clipboard";

import {
  startCanvasInteractionSample,
  stopCanvasInteractionSample,
  tickCanvasInteractionSample,
} from "./canvas/performance";
import {
  buildReadingNavigationSections,
  getReadingActiveTitle,
  getReadingSectionTitle,
  isPagedReadingFormat,
} from "./reading/navigation";
import { ReadingAnnotationOverlays } from "./reading/reading-annotation-overlays";
import { ReadingMainPane } from "./reading/reading-main-pane";
import { ReadingNotesSidebar } from "./reading/reading-notes-sidebar";
import { ReadingTocSidebar } from "./reading/reading-toc-sidebar";
import { ReadingWorkspaceHeader } from "./reading/reading-workspace-header";
import {
  ReadingResizeGuides,
  ReadingWorkspaceErrorState,
  ReadingWorkspaceLoadingState,
  ReadingWorkspaceShell,
} from "./reading/reading-workspace-state";
import {
  readCachedReadingNotesScrollTop,
  readCachedReadingProgress,
  saveReadingNotesScrollTop,
} from "./reading/api";
import {
  getClosestEpubSectionIndex,
  getEpubVisibleRange,
} from "./reading/epub-virtualization";
import {
  getQuickNotePanelCopy,
  getReadingGridColumns,
  supportsReadingContentScale,
} from "./reading/layout";
import type { PdfOutlineSection, ReadingPayload } from "./reading/types";
import {
  getReadingSectionIndexNearViewportTop,
  scrollElementIntoContainer,
  scrollToEpubSection,
  scrollToReadingTarget,
} from "./reading/utils";
import { useReadingNotes } from "./reading/use-reading-notes";
import { useReadingPayload } from "./reading/use-reading-payload";
import { useReadingProgress } from "./reading/use-reading-progress";
import { usePdfAnnotationDraft } from "./reading/use-pdf-annotation-draft";
import { useReadingSelection } from "./reading/use-reading-selection";
import { useResizableReadingPanels } from "./reading/use-resizable-reading-panels";

type ReadingWorkspaceProps = {
  assetId: string;
  projectId: string;
  onCreateNoteNode: (note: ReadingNote, asset: ReadingAsset) => void;
  onToggleCollapse?: () => void;
  nodeMode?: boolean;
};

export function ReadingWorkspace({
  assetId,
  nodeMode = false,
  onCreateNoteNode,
  onToggleCollapse,
  projectId,
}: ReadingWorkspaceProps) {
  const cachedInitialProgress = useMemo(
    () => readCachedReadingProgress(assetId),
    [assetId],
  );
  const cachedInitialNotesScrollTop = useMemo(
    () => readCachedReadingNotesScrollTop(assetId) ?? 0,
    [assetId],
  );
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfOutlineSections, setPdfOutlineSections] = useState<
    PdfOutlineSection[]
  >([]);
  const [selectedColor, setSelectedColor] =
    useState<ReadingAnnotationColor>("yellow");
  const [comment, setComment] = useState("");
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);
  const [pagedVisibleRange, setPagedVisibleRange] = useState<[number, number]>([
    0, 12,
  ]);
  const {
    notesDraftWidth,
    notesWidth,
    setTocCollapsed,
    startNotesResize,
    startTocResize,
    tocCollapsed,
    tocDraftWidth,
    tocWidth,
  } = useResizableReadingPanels({ nodeMode });
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const annotationLayerRef = useRef<HTMLDivElement | null>(null);
  const readerScrollRef = useRef<HTMLElement | null>(null);
  const notesListRef = useRef<HTMLDivElement | null>(null);
  const notesScrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const notesScrollTopRef = useRef(cachedInitialNotesScrollTop);
  const didRestoreNotesScroll = useRef(false);
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({});
  const {
    activeSection,
    activeSectionRef,
    applyLoadedProgress,
    contentScale,
    getCurrentScrollRatio,
    lastSavedScrollRatio,
    lastSavedSection,
    saveProgress,
    setActiveSection,
    updateContentScale,
  } = useReadingProgress({
    assetId,
    initialProgress: cachedInitialProgress,
    readerScrollRef,
  });
  const readerScrollFrame = useRef<number | null>(null);
  const readerScrollSample = useRef<ReturnType<
    typeof startCanvasInteractionSample
  > | null>(null);
  const readerScrollSampleTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const shouldScrollNotesToEnd = useRef(false);

  const restoreReadingScroll = useCallback(
    (scrollRatio: number, fallbackSection: number) => {
      const container = readerScrollRef.current;
      if (!container) {
        scrollElementIntoContainer({
          container: null,
          target: sectionRefs.current[fallbackSection],
        });
        return;
      }

      const maxScrollTop = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      if (fallbackSection > 0 && scrollRatio <= 0.001) {
        scrollElementIntoContainer({
          container,
          target: sectionRefs.current[fallbackSection],
        });
        return;
      }

      if (maxScrollTop > 0) {
        container.scrollTo({
          top: maxScrollTop * Math.min(1, Math.max(0, scrollRatio)),
        });
        return;
      }

      scrollElementIntoContainer({
        container,
        target: sectionRefs.current[fallbackSection],
      });
    },
    [],
  );

  useEffect(() => {
    setPdfPageCount(0);
  }, [assetId]);

  const handleReadingPayloadLoaded = useCallback(
    (data: ReadingPayload) => {
      const progress = applyLoadedProgress(data.progress);
      requestAnimationFrame(() => {
        restoreReadingScroll(progress.scrollRatio, progress.sectionIndex);
        window.setTimeout(
          () =>
            restoreReadingScroll(progress.scrollRatio, progress.sectionIndex),
          160,
        );
        window.setTimeout(
          () =>
            restoreReadingScroll(progress.scrollRatio, progress.sectionIndex),
          520,
        );
      });
    },
    [applyLoadedProgress, restoreReadingScroll],
  );

  const { error, loadProgress, payload, setError, setPayload } =
    useReadingPayload({
      assetId,
      onLoaded: handleReadingPayloadLoaded,
    });

  const {
    canSavePdfAnnotation,
    isPdfOcrBusy,
    pdfAnnotationDraft,
    pdfAnnotationResetKey,
    pdfOcrError,
    resetPdfAnnotationDraft,
    setPdfAnnotationDraft,
    setPdfAnnotationResetKey,
  } = usePdfAnnotationDraft();

  const {
    captureSelection,
    clearSelection,
    selectedText,
    selection,
    setSelectedText,
    setSelection,
  } = useReadingSelection({
    annotationLayerRef,
    isPdf: payload?.asset.format === "pdf",
    onSectionSelect: setActiveSection,
  });

  const activeTitle = useMemo(() => {
    if (!payload) return "";
    return getReadingActiveTitle({
      activeSection,
      assetFormat: payload.asset.format,
      assetTitle: payload.asset.title,
      pdfPageCount,
      sections: payload.sections,
    });
  }, [activeSection, payload, pdfPageCount]);

  const navigationSections = useMemo(() => {
    if (!payload) return [];
    return buildReadingNavigationSections({
      assetFormat: payload.asset.format,
      pdfPageCount,
      pdfOutlineSections,
      sections: payload.sections,
    });
  }, [payload, pdfOutlineSections, pdfPageCount]);

  const updatePagedVisibleRange = useCallback(
    (container: HTMLElement | null, pageCount: number) => {
      if (!container || pageCount <= 0) {
        return;
      }

      const nextRange = getEpubVisibleRange({
        clientHeight: container.clientHeight,
        contentScale,
        pageCount,
        scrollTop: container.scrollTop,
      });
      setPagedVisibleRange((current) =>
        current[0] === nextRange[0] && current[1] === nextRange[1]
          ? current
          : nextRange,
      );
    },
    [contentScale],
  );

  useEffect(() => {
    if (!shouldScrollNotesToEnd.current || !payload) {
      return;
    }

    shouldScrollNotesToEnd.current = false;
    requestAnimationFrame(() => {
      const notesList = notesListRef.current;
      if (notesList) {
        notesList.scrollTop = notesList.scrollHeight;
      }
    });
  }, [payload]);

  useEffect(() => {
    didRestoreNotesScroll.current = false;
    notesScrollTopRef.current = readCachedReadingNotesScrollTop(assetId) ?? 0;
  }, [assetId]);

  useEffect(() => {
    if (
      !payload ||
      payload.asset.id !== assetId ||
      didRestoreNotesScroll.current
    ) {
      return;
    }
    const cachedScrollTop = readCachedReadingNotesScrollTop(assetId);
    notesScrollTopRef.current =
      cachedScrollTop ?? payload.progress?.notesScrollTop ?? 0;
    didRestoreNotesScroll.current = true;
    const frame = requestAnimationFrame(() => {
      const notesList = notesListRef.current;
      if (notesList) {
        notesList.scrollTop = notesScrollTopRef.current;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [assetId, payload]);

  useEffect(() => {
    return () => {
      if (notesScrollSaveTimer.current !== null) {
        clearTimeout(notesScrollSaveTimer.current);
        notesScrollSaveTimer.current = null;
      }
      void saveReadingNotesScrollTop(assetId, notesScrollTopRef.current, {
        keepalive: true,
      });
    };
  }, [assetId]);

  useEffect(() => {
    if (!payload || !isPagedReadingFormat(payload.asset.format)) {
      return;
    }
    requestAnimationFrame(() => {
      updatePagedVisibleRange(readerScrollRef.current, payload.sections.length);
    });
  }, [payload, updatePagedVisibleRange]);

  useEffect(() => {
    return () => {
      if (readerScrollFrame.current !== null) {
        cancelAnimationFrame(readerScrollFrame.current);
        readerScrollFrame.current = null;
      }
      if (readerScrollSampleTimer.current !== null) {
        clearTimeout(readerScrollSampleTimer.current);
        readerScrollSampleTimer.current = null;
      }
      stopCanvasInteractionSample(readerScrollSample.current, {
        assetFormat: payload?.asset.format,
        assetId,
        projectId,
      });
      readerScrollSample.current = null;
    };
  }, [assetId, payload?.asset.format, projectId]);

  const getSectionTitle = useCallback(
    (index: number) => {
      if (!payload) {
        return "";
      }

      return getReadingSectionTitle({
        activeTitle: payload.asset.title,
        assetFormat: payload.asset.format,
        index,
        sections: payload.sections,
      });
    },
    [payload],
  );

  const jumpToSection = useCallback(
    (index: number) => {
      activeSectionRef.current = index;
      setActiveSection(index);
      saveProgress(index, contentScale, 0);
      if (payload && isPagedReadingFormat(payload.asset.format)) {
        scrollToEpubSection(
          readerScrollRef.current,
          index,
          contentScale,
          "smooth",
        );
        updatePagedVisibleRange(
          readerScrollRef.current,
          payload.sections.length,
        );
        return;
      }
      const scrollToPdfPage = (behavior: ScrollBehavior) => {
        scrollElementIntoContainer({
          behavior,
          container: readerScrollRef.current,
          target: sectionRefs.current[index],
        });
      };
      scrollToPdfPage("smooth");
      window.setTimeout(() => scrollToPdfPage("auto"), 120);
      window.setTimeout(() => scrollToPdfPage("auto"), 360);
    },
    [
      activeSectionRef,
      contentScale,
      payload,
      saveProgress,
      setActiveSection,
      updatePagedVisibleRange,
    ],
  );

  const jumpToNote = useCallback(
    (note: ReadingNote) => {
      activeSectionRef.current = note.sectionIndex;
      setActiveSection(note.sectionIndex);
      saveProgress(note.sectionIndex);
      setFocusedNoteId(note.id);

      const targetSelector =
        payload?.asset.format === "pdf"
          ? `[data-pdf-annotation-note="${note.id}"]`
          : `[data-reading-highlight-note="${note.id}"]`;

      const scrollToTarget = () => {
        const behavior = payload?.asset.format === "pdf" ? "auto" : "smooth";
        return scrollToReadingTarget({
          behavior,
          fallbackSection: sectionRefs.current[note.sectionIndex],
          selector: targetSelector,
          container: readerScrollRef.current,
          workspace: workspaceRef.current,
        });
      };

      const found = scrollToTarget();
      if (!found && payload && isPagedReadingFormat(payload.asset.format)) {
        scrollToEpubSection(
          readerScrollRef.current,
          note.sectionIndex,
          contentScale,
          "auto",
        );
        updatePagedVisibleRange(
          readerScrollRef.current,
          payload.sections.length,
        );
        window.setTimeout(scrollToTarget, 80);
        window.setTimeout(scrollToTarget, 240);
      }
      if (!found && payload?.asset.format === "pdf") {
        window.setTimeout(scrollToTarget, 240);
        window.setTimeout(scrollToTarget, 720);
      }
      window.setTimeout(() => {
        setFocusedNoteId((current) => (current === note.id ? null : current));
      }, 1800);
    },
    [
      activeSectionRef,
      contentScale,
      payload,
      saveProgress,
      setActiveSection,
      updatePagedVisibleRange,
    ],
  );

  function processReaderScroll() {
    readerScrollFrame.current = null;
    tickCanvasInteractionSample(readerScrollSample.current);

    const container = readerScrollRef.current;
    if (!container || !payload) {
      return;
    }

    if (isPagedReadingFormat(payload.asset.format)) {
      updatePagedVisibleRange(container, payload.sections.length);
      const closestIndex = getClosestEpubSectionIndex({
        clientHeight: container.clientHeight,
        contentScale,
        pageCount: payload.sections.length,
        scrollTop: container.scrollTop,
      });
      if (closestIndex !== activeSection) {
        activeSectionRef.current = closestIndex;
        setActiveSection(closestIndex);
      }
      const scrollRatio = getCurrentScrollRatio();
      if (
        closestIndex !== lastSavedSection.current ||
        Math.abs(scrollRatio - lastSavedScrollRatio.current) > 0.002
      ) {
        saveProgress(closestIndex, contentScale, scrollRatio);
      }
      return;
    }

    const closestIndex = getReadingSectionIndexNearViewportTop(
      container,
      activeSection,
    );

    if (closestIndex !== activeSection) {
      activeSectionRef.current = closestIndex;
      setActiveSection(closestIndex);
    }
    const scrollRatio = getCurrentScrollRatio();
    if (
      closestIndex !== lastSavedSection.current ||
      Math.abs(scrollRatio - lastSavedScrollRatio.current) > 0.002
    ) {
      saveProgress(closestIndex, contentScale, scrollRatio);
    }
  }

  function handleReaderScroll() {
    if (!readerScrollSample.current) {
      readerScrollSample.current = startCanvasInteractionSample(
        "reading scroll",
        {
          assetFormat: payload?.asset.format,
          assetId,
          projectId,
        },
      );
    }
    if (readerScrollSampleTimer.current !== null) {
      clearTimeout(readerScrollSampleTimer.current);
    }
    readerScrollSampleTimer.current = setTimeout(() => {
      readerScrollSampleTimer.current = null;
      stopCanvasInteractionSample(readerScrollSample.current, {
        assetFormat: payload?.asset.format,
        assetId,
        projectId,
      });
      readerScrollSample.current = null;
    }, 160);

    if (readerScrollFrame.current !== null) {
      return;
    }

    readerScrollFrame.current = requestAnimationFrame(processReaderScroll);
  }

  const handleNotesScroll = useCallback(() => {
    const notesList = notesListRef.current;
    if (!notesList) return;
    notesScrollTopRef.current = notesList.scrollTop;
    if (notesScrollSaveTimer.current !== null) {
      clearTimeout(notesScrollSaveTimer.current);
    }
    notesScrollSaveTimer.current = setTimeout(() => {
      notesScrollSaveTimer.current = null;
      void saveReadingNotesScrollTop(assetId, notesScrollTopRef.current);
    }, 120);
  }, [assetId]);

  const {
    createNote,
    createPdfAnnotationNote,
    deleteNote,
    isSavingNote,
    reorderNotes,
    saveEditedNote,
  } = useReadingNotes({
    activeSectionRef,
    assetId,
    canSavePdfAnnotation,
    comment,
    getSectionTitle,
    onNoteCreated: () => {
      shouldScrollNotesToEnd.current = true;
    },
    payload,
    pdfAnnotationDraft,
    projectId,
    selectedColor,
    selectedText,
    selection,
    setComment,
    setError,
    setPayload,
    setPdfAnnotationDraft,
    setPdfAnnotationResetKey,
    setSelectedText,
    setSelection,
  });

  const copyNote = useCallback((note: ReadingNote) => {
    const text = [note.selectedText, note.comment].filter(Boolean).join("\n\n");
    if (!text) return;
    void writeTextToClipboard(text);
  }, []);

  const quickNoteText =
    pdfOcrError && !canSavePdfAnnotation
      ? pdfOcrError
      : pdfAnnotationDraft?.ocrFailed && !canSavePdfAnnotation
        ? "未识别到文字，请重新框选"
        : isPdfOcrBusy && !canSavePdfAnnotation
          ? "OCR 识别中，首次加载可能较慢..."
          : (pdfAnnotationDraft?.selectedText ?? selectedText);
  const quickNoteCopy = getQuickNotePanelCopy({
    assetFormat: payload?.asset.format,
    hasPdfAnnotationDraft: Boolean(pdfAnnotationDraft),
    quickNoteText,
  });
  const supportsContentScale = supportsReadingContentScale(
    payload?.asset.format,
  );
  const readingGridColumns = getReadingGridColumns({
    notesWidth,
    nodeMode,
    tocCollapsed,
    tocWidth,
  });

  const handleCreateQuickNote = useCallback(() => {
    void createNote();
  }, [createNote]);

  const handleCreatePdfAnnotationQuickNote = useCallback(() => {
    void createPdfAnnotationNote();
  }, [createPdfAnnotationNote]);

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      void deleteNote(noteId);
    },
    [deleteNote],
  );

  const handleReorderNotes = useCallback(
    (
      sourceId: string | null,
      targetId: string,
      placement: "before" | "after",
    ) => {
      void reorderNotes(sourceId, targetId, placement);
    },
    [reorderNotes],
  );

  const handleSaveEditedNote = useCallback(
    (noteId: string, updates: { comment: string; selectedText: string }) => {
      void saveEditedNote(noteId, updates);
    },
    [saveEditedNote],
  );

  function handleWorkspaceWheelCapture(event: ReactWheelEvent<HTMLDivElement>) {
    if (event.ctrlKey) {
      return;
    }

    event.stopPropagation();
  }

  function handleWorkspaceMiddleMouse(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.button === 1) {
      event.preventDefault();
    }
  }

  return (
    <ReadingWorkspaceShell
      nodeMode={nodeMode}
      onAuxClickCapture={handleWorkspaceMiddleMouse}
      onMouseDownCapture={handleWorkspaceMiddleMouse}
      onWheelCapture={handleWorkspaceWheelCapture}
      workspaceRef={workspaceRef}
    >
      <ReadingWorkspaceHeader
        activeTitle={activeTitle}
        contentScale={contentScale}
        nodeMode={nodeMode}
        onContentScaleChange={updateContentScale}
        onToggleCollapse={onToggleCollapse}
        supportsContentScale={supportsContentScale}
        title={payload?.asset.title ?? "阅读器"}
      />

      {error ? <ReadingWorkspaceErrorState message={error} /> : null}

      {!payload && !error ? (
        <ReadingWorkspaceLoadingState progress={loadProgress} />
      ) : null}

      {payload ? (
        <div
          className="nodrag relative grid min-h-0 flex-1"
          data-reading-annotation-layer
          ref={annotationLayerRef}
          style={{ gridTemplateColumns: readingGridColumns }}
        >
          <ReadingResizeGuides
            notesDraftWidth={notesDraftWidth}
            tocCollapsed={tocCollapsed}
            tocDraftWidth={tocDraftWidth}
          />
          <ReadingTocSidebar
            activeSection={activeSection}
            collapsed={tocCollapsed}
            navigationSections={navigationSections}
            onCollapsedChange={setTocCollapsed}
            onResizeStart={startTocResize}
            onSectionSelect={jumpToSection}
          />

          <ReadingMainPane
            annotationResetKey={pdfAnnotationResetKey}
            assetId={assetId}
            contentScale={contentScale}
            focusedNoteId={focusedNoteId}
            nodeMode={nodeMode}
            onAnnotationDraft={setPdfAnnotationDraft}
            onError={setError}
            onMouseUp={captureSelection}
            onOutline={setPdfOutlineSections}
            onPageCount={setPdfPageCount}
            onScroll={handleReaderScroll}
            payload={payload}
            readerScrollRef={readerScrollRef}
            sectionRefs={sectionRefs}
            selection={selection}
            visibleRange={pagedVisibleRange}
          />

          <ReadingAnnotationOverlays
            canSavePdfAnnotation={canSavePdfAnnotation}
            isSavingNote={isSavingNote}
            onClearSelection={clearSelection}
            onCreateNote={(color) => {
              void createNote(color);
            }}
            onCreatePdfAnnotationNote={(color) => {
              void createPdfAnnotationNote(color);
            }}
            onResetPdfAnnotationDraft={resetPdfAnnotationDraft}
            pdfAnnotationDraft={pdfAnnotationDraft}
            selectedColor={selectedColor}
            selection={selection}
            setSelectedColor={setSelectedColor}
          />

          <ReadingNotesSidebar
            asset={payload.asset}
            comment={comment}
            copyNote={copyNote}
            createNote={handleCreateQuickNote}
            createPdfAnnotationNote={handleCreatePdfAnnotationQuickNote}
            deleteNote={handleDeleteNote}
            isSavingNote={
              isSavingNote ||
              (Boolean(pdfAnnotationDraft) && !canSavePdfAnnotation)
            }
            jumpToNote={jumpToNote}
            notes={payload.notes}
            notesListRef={notesListRef}
            onCreateNoteNode={onCreateNoteNode}
            onResizeStart={startNotesResize}
            onScroll={handleNotesScroll}
            pdfAnnotationDraft={pdfAnnotationDraft}
            quickNoteActionLabel={quickNoteCopy.actionLabel}
            quickNoteHint={quickNoteCopy.hint}
            quickNoteText={quickNoteText}
            reorderNotes={handleReorderNotes}
            saveEditedNote={handleSaveEditedNote}
            setComment={setComment}
          />
        </div>
      ) : null}
    </ReadingWorkspaceShell>
  );
}
