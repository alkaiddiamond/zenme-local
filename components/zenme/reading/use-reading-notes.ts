import { useCallback, useState } from "react";

import type { ReadingAnnotationColor } from "@/lib/reading/types";

import {
  createPdfReadingAnnotation,
  createReadingNote,
  deleteReadingNote,
  saveReadingNoteOrder,
  updateReadingNote,
} from "./api";
import type {
  PdfAnnotationDraft,
  ReadingPayload,
  TextSelection,
} from "./types";
import { reorderReadingNoteList } from "./utils";

export function useReadingNotes(input: {
  activeSection: number;
  assetId: string;
  canSavePdfAnnotation: boolean;
  comment: string;
  getSectionTitle: (index: number) => string;
  payload: ReadingPayload | null;
  pdfAnnotationDraft: PdfAnnotationDraft | null;
  projectId: string;
  selectedColor: ReadingAnnotationColor;
  selectedText: string;
  selection: TextSelection | null;
  setComment: (comment: string) => void;
  setError: (error: string | null) => void;
  setPayload: (
    payload:
      | ReadingPayload
      | null
      | ((current: ReadingPayload | null) => ReadingPayload | null),
  ) => void;
  setPdfAnnotationDraft: (draft: PdfAnnotationDraft | null) => void;
  setPdfAnnotationResetKey: (updater: (key: number) => number) => void;
  setSelectedText: (text: string) => void;
  setSelection: (selection: TextSelection | null) => void;
  onNoteCreated: () => void;
}) {
  const {
    activeSection,
    assetId,
    canSavePdfAnnotation,
    comment,
    getSectionTitle,
    onNoteCreated,
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
  } = input;
  const [isSavingNote, setIsSavingNote] = useState(false);

  const reorderNotes = useCallback(
    async (
      sourceId: string | null,
      targetId: string,
      placement: "before" | "after",
    ) => {
      if (!payload || !sourceId) {
        return;
      }

      const previousNotes = payload.notes;
      const nextNotes = reorderReadingNoteList(
        previousNotes,
        sourceId,
        targetId,
        placement,
      );
      if (nextNotes === previousNotes) {
        return;
      }

      setPayload({ ...payload, notes: nextNotes });

      try {
        const savedNotes = await saveReadingNoteOrder(
          assetId,
          nextNotes.map((note) => note.id),
        );
        setPayload((current) =>
          current ? { ...current, notes: savedNotes } : current,
        );
      } catch (err) {
        setPayload({ ...payload, notes: previousNotes });
        setError(err instanceof Error ? err.message : "保存笔记顺序失败");
      }
    },
    [assetId, payload, setError, setPayload],
  );

  const createNote = useCallback(
    async (color: ReadingAnnotationColor = selectedColor) => {
      const noteText = selectedText.trim() || comment.trim();
      if (!payload || !noteText) {
        return;
      }

      setIsSavingNote(true);
      try {
        const sectionIndex = selection?.sectionIndex ?? activeSection;
        const note = await createReadingNote({
          assetId,
          projectId,
          selectedText: noteText,
          comment,
          sectionIndex,
          chapterTitle: getSectionTitle(sectionIndex),
          color,
          type: selection ? "highlight" : "note",
          offset: selection?.offset ?? null,
          length: selection?.length ?? null,
        });
        onNoteCreated();
        setPayload({
          ...payload,
          notes: [...payload.notes, note],
        });
        setSelectedText("");
        setSelection(null);
        setComment("");
        window.getSelection()?.removeAllRanges();
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存笔记失败");
      } finally {
        setIsSavingNote(false);
      }
    },
    [
      activeSection,
      assetId,
      comment,
      getSectionTitle,
      onNoteCreated,
      payload,
      projectId,
      selectedColor,
      selectedText,
      selection,
      setComment,
      setError,
      setPayload,
      setSelectedText,
      setSelection,
    ],
  );

  const createPdfAnnotationNote = useCallback(
    async (color: ReadingAnnotationColor = selectedColor) => {
      if (!payload || !pdfAnnotationDraft) {
        return;
      }

      if (!canSavePdfAnnotation) {
        return;
      }

      setIsSavingNote(true);
      try {
        const note = await createPdfReadingAnnotation({
          assetId,
          projectId,
          comment,
          color,
          draft: pdfAnnotationDraft,
          chapterTitle: getSectionTitle(pdfAnnotationDraft.pageIndex),
        });
        onNoteCreated();
        setPayload({
          ...payload,
          notes: [...payload.notes, note],
        });
        setPdfAnnotationDraft(null);
        setPdfAnnotationResetKey((key) => key + 1);
        setComment("");
        window.getSelection()?.removeAllRanges();
      } catch (err) {
        setError(err instanceof Error ? err.message : "保存 PDF 标注失败");
      } finally {
        setIsSavingNote(false);
      }
    },
    [
      assetId,
      canSavePdfAnnotation,
      comment,
      getSectionTitle,
      onNoteCreated,
      payload,
      pdfAnnotationDraft,
      projectId,
      selectedColor,
      setComment,
      setError,
      setPayload,
      setPdfAnnotationDraft,
      setPdfAnnotationResetKey,
    ],
  );

  const saveEditedNote = useCallback(
    async (
      noteId: string,
      updates: { comment: string; selectedText: string },
    ) => {
      const selectedText = updates.selectedText.trim();
      if (!payload || !selectedText) {
        return;
      }

      const updated = await updateReadingNote({
        noteId,
        selectedText,
        comment: updates.comment,
      }).catch((err) => {
        setError(err instanceof Error ? err.message : "保存笔记失败");
        return null;
      });
      if (!updated) return;
      setPayload({
        ...payload,
        notes: payload.notes.map((note) =>
          note.id === updated.id ? updated : note,
        ),
      });
    },
    [payload, setError, setPayload],
  );

  const deleteNote = useCallback(
    async (noteId: string) => {
      if (!payload) return;
      try {
        await deleteReadingNote(noteId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "删除笔记失败");
        return;
      }

      setPayload({
        ...payload,
        notes: payload.notes.filter((note) => note.id !== noteId),
      });
    },
    [payload, setError, setPayload],
  );

  return {
    createNote,
    createPdfAnnotationNote,
    deleteNote,
    isSavingNote,
    reorderNotes,
    saveEditedNote,
  };
}
