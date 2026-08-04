import { Highlighter, Plus } from "lucide-react";
import { memo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";
import { OverlayScrollArea } from "@/components/zenme/overlay-scroll-area";

import { ReadingNoteCard } from "./reading-note-card";
import type { NoteDropIndicator, PdfAnnotationDraft } from "./types";

type ReadingNotesSidebarProps = {
  asset: ReadingAsset;
  comment: string;
  copyNote: (note: ReadingNote) => void;
  createNote: () => void;
  createPdfAnnotationNote: () => void;
  deleteNote: (noteId: string) => void;
  isSavingNote: boolean;
  jumpToNote: (note: ReadingNote) => void;
  notes: ReadingNote[];
  notesListRef: RefObject<HTMLDivElement | null>;
  onCreateNoteNode: (note: ReadingNote, asset: ReadingAsset) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  pdfAnnotationDraft: PdfAnnotationDraft | null;
  quickNoteActionLabel: string;
  quickNoteHint: string;
  quickNoteText: string;
  reorderNotes: (
    sourceId: string | null,
    targetId: string,
    placement: "before" | "after",
  ) => void;
  saveEditedNote: (
    noteId: string,
    updates: { comment: string; selectedText: string },
  ) => void;
  setComment: (value: string) => void;
};

export const ReadingNotesSidebar = memo(function ReadingNotesSidebar({
  asset,
  comment,
  copyNote,
  createNote,
  createPdfAnnotationNote,
  deleteNote,
  isSavingNote,
  jumpToNote,
  notes,
  notesListRef,
  onCreateNoteNode,
  onResizeStart,
  pdfAnnotationDraft,
  quickNoteActionLabel,
  quickNoteHint,
  quickNoteText,
  reorderNotes,
  saveEditedNote,
  setComment,
}: ReadingNotesSidebarProps) {
  const draggingNoteIdRef = useRef<string | null>(null);
  const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingSelectedText, setEditingSelectedText] = useState("");
  const [editingComment, setEditingComment] = useState("");
  const [noteDropIndicator, setNoteDropIndicator] =
    useState<NoteDropIndicator>(null);

  function startEditNote(note: ReadingNote) {
    setEditingNoteId(note.id);
    setEditingSelectedText(note.selectedText);
    setEditingComment(note.comment);
  }

  function saveCurrentEdit(noteId: string) {
    saveEditedNote(noteId, {
      comment: editingComment,
      selectedText: editingSelectedText,
    });
    setEditingNoteId(null);
  }

  return (
    <aside className="relative flex min-h-0 flex-col border-l border-zinc-200 bg-white">
      <div
        aria-label="调整笔记宽度"
        className="absolute -left-1 top-0 h-full w-2 cursor-col-resize"
        onPointerDown={onResizeStart}
        role="separator"
        title="调整笔记宽度"
      />
      <div className="border-b border-zinc-200 px-4 py-4 pr-8">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Highlighter className="size-4 text-zinc-500" />
          笔记
        </div>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="line-clamp-3 min-h-10 text-xs leading-5 text-zinc-600">
            {quickNoteHint}
          </p>
          <textarea
            className="mt-3 h-16 w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-2 text-xs text-zinc-900 caret-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:placeholder:text-transparent select-text"
            onChange={(event) => setComment(event.target.value)}
            placeholder="补充备注"
            value={comment}
          />
          <button
            className="mt-2 inline-flex h-8 items-center gap-1 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={
              (!quickNoteText && !comment.trim() && !pdfAnnotationDraft) ||
              isSavingNote
            }
            onClick={() => {
              if (pdfAnnotationDraft) {
                createPdfAnnotationNote();
                return;
              }
              createNote();
            }}
            type="button"
          >
            <Plus className="size-3.5" />
            {quickNoteActionLabel}
          </button>
        </div>
      </div>

      <OverlayScrollArea
        className="min-h-0 flex-1"
        contentKey={`${notes.length}:${editingNoteId ?? ""}`}
        ref={notesListRef}
        viewportClassName="h-full overflow-auto px-4 py-3"
      >
        {notes.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-zinc-400">
            暂无笔记
          </p>
        ) : null}
        <div>
          {notes.map((note) => (
            <ReadingNoteCard
              asset={asset}
              copyNote={copyNote}
              deleteNote={deleteNote}
              draggingNoteId={draggingNoteId}
              draggingNoteIdRef={draggingNoteIdRef}
              editingComment={editingComment}
              editingNoteId={editingNoteId}
              editingSelectedText={editingSelectedText}
              jumpToNote={jumpToNote}
              key={note.id}
              note={note}
              noteDropIndicator={noteDropIndicator}
              onCreateNoteNode={onCreateNoteNode}
              reorderNotes={reorderNotes}
              saveEditedNote={saveCurrentEdit}
              setDraggingNoteId={setDraggingNoteId}
              setEditingComment={setEditingComment}
              setEditingNoteId={setEditingNoteId}
              setEditingSelectedText={setEditingSelectedText}
              setNoteDropIndicator={setNoteDropIndicator}
              startEditNote={startEditNote}
            />
          ))}
        </div>
      </OverlayScrollArea>
    </aside>
  );
});
