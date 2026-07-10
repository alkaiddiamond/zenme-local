import { GripVertical } from "lucide-react";
import { memo } from "react";
import type {
  DragEvent as ReactDragEvent,
  MutableRefObject,
} from "react";

import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

import { HIGHLIGHT_STYLES } from "./constants";
import { ReadingNoteActions } from "./reading-note-actions";
import {
  ReadingNoteDropSlot,
  type NoteDropPlacement,
} from "./reading-note-drop-slot";
import type { NoteDropIndicator } from "./types";
import { formatNoteTimestamp } from "./utils";

type ReadingNoteCardProps = {
  asset: ReadingAsset;
  copyNote: (note: ReadingNote) => void;
  deleteNote: (noteId: string) => void;
  draggingNoteId: string | null;
  draggingNoteIdRef: MutableRefObject<string | null>;
  editingComment: string;
  editingNoteId: string | null;
  editingSelectedText: string;
  jumpToNote: (note: ReadingNote) => void;
  note: ReadingNote;
  noteDropIndicator: NoteDropIndicator;
  onCreateNoteNode: (note: ReadingNote, asset: ReadingAsset) => void;
  reorderNotes: (
    sourceId: string | null,
    targetId: string,
    placement: NoteDropPlacement,
  ) => void;
  saveEditedNote: (noteId: string) => void;
  setDraggingNoteId: (noteId: string | null) => void;
  setEditingComment: (value: string) => void;
  setEditingNoteId: (noteId: string | null) => void;
  setEditingSelectedText: (value: string) => void;
  setNoteDropIndicator: (indicator: NoteDropIndicator) => void;
  startEditNote: (note: ReadingNote) => void;
};

export const ReadingNoteCard = memo(function ReadingNoteCard({
  asset,
  copyNote,
  deleteNote,
  draggingNoteId,
  draggingNoteIdRef,
  editingComment,
  editingNoteId,
  editingSelectedText,
  jumpToNote,
  note,
  noteDropIndicator,
  onCreateNoteNode,
  reorderNotes,
  saveEditedNote,
  setDraggingNoteId,
  setEditingComment,
  setEditingNoteId,
  setEditingSelectedText,
  setNoteDropIndicator,
  startEditNote,
}: ReadingNoteCardProps) {
  const showBeforeIndicator =
    noteDropIndicator?.targetId === note.id &&
    noteDropIndicator.placement === "before";
  const showAfterIndicator =
    noteDropIndicator?.targetId === note.id &&
    noteDropIndicator.placement === "after";
  const isDraggingThisNote = draggingNoteId === note.id;

  function readDraggedNoteId(event: ReactDragEvent<HTMLElement>) {
    return (
      draggingNoteIdRef.current ||
      draggingNoteId ||
      event.dataTransfer.getData("application/x-zenme-reading-note-order")
    );
  }

  function getNoteDropPlacement(event: ReactDragEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? "after" : "before";
  }

  function updateNoteDropIndicator(placement: NoteDropPlacement) {
    setNoteDropIndicator(
      noteDropIndicator?.targetId === note.id &&
        noteDropIndicator.placement === placement
        ? noteDropIndicator
        : { targetId: note.id, placement },
    );
  }

  return (
    <div>
      <ReadingNoteDropSlot
        noteId={note.id}
        placement="before"
        readDraggedNoteId={readDraggedNoteId}
        reorderNotes={reorderNotes}
        show={showBeforeIndicator}
        updateNoteDropIndicator={updateNoteDropIndicator}
      />
      <div
        className={`group mb-2 cursor-pointer rounded-md border bg-white p-3 shadow-sm transition ${
          isDraggingThisNote
            ? "scale-[0.99] border-zinc-300 opacity-50"
            : "border-zinc-200"
        }`}
        data-reading-note-card={note.id}
        onClick={() => {
          if (editingNoteId !== note.id) {
            jumpToNote(note);
          }
        }}
        onDragEnter={(event) => {
          const draggedNoteId = readDraggedNoteId(event);
          if (!draggedNoteId || draggedNoteId === note.id) {
            return;
          }
          event.preventDefault();
          updateNoteDropIndicator(getNoteDropPlacement(event));
        }}
        onDragOver={(event) => {
          const draggedNoteId = readDraggedNoteId(event);
          if (!draggedNoteId || draggedNoteId === note.id) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          updateNoteDropIndicator(getNoteDropPlacement(event));
        }}
        onDrop={(event) => {
          const draggedNoteId = readDraggedNoteId(event);
          if (!draggedNoteId) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          reorderNotes(draggedNoteId, note.id, getNoteDropPlacement(event));
        }}
      >
        <div className="mb-2 flex w-full items-start justify-between gap-2">
          <button
            className="flex min-w-0 flex-1 flex-col gap-1 text-left"
            onClick={(event) => {
              event.stopPropagation();
              jumpToNote(note);
            }}
            type="button"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full border border-zinc-200"
                style={{
                  background: HIGHLIGHT_STYLES[note.color],
                }}
              />
              <span className="truncate text-xs text-zinc-500">
                {note.chapterTitle || "阅读笔记"}
              </span>
            </span>
            <span className="text-[11px] leading-4 text-zinc-400">
              {formatNoteTimestamp(note.createdAt)}
            </span>
          </button>
          <button
            aria-label="拖动调整笔记顺序"
            className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-zinc-300 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing"
            data-reading-note-drag-handle={note.id}
            draggable
            onClick={(event) => event.stopPropagation()}
            onDragEnd={(event) => {
              event.stopPropagation();
              draggingNoteIdRef.current = null;
              setDraggingNoteId(null);
              setNoteDropIndicator(null);
            }}
            onDragStart={(event) => {
              event.stopPropagation();
              draggingNoteIdRef.current = note.id;
              setDraggingNoteId(note.id);
              setNoteDropIndicator(null);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData(
                "application/x-zenme-reading-note-order",
                note.id,
              );
            }}
            onMouseDown={(event) => event.stopPropagation()}
            type="button"
          >
            <GripVertical className="size-3.5" />
          </button>
        </div>
        <p className="text-sm leading-5 text-zinc-800">
          {editingNoteId === note.id ? (
            <textarea
              className="h-24 w-full resize-none rounded-md border border-zinc-200 px-2 py-2 text-sm leading-5 text-zinc-900 caret-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:placeholder:text-transparent select-text"
              onChange={(event) => setEditingSelectedText(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              value={editingSelectedText}
            />
          ) : (
            note.selectedText
          )}
        </p>
        {editingNoteId === note.id ? (
          <textarea
            className="mt-2 h-16 w-full resize-none rounded-md border border-zinc-200 px-2 py-2 text-xs leading-5 text-zinc-900 caret-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:placeholder:text-transparent select-text"
            onChange={(event) => setEditingComment(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            placeholder="备注"
            value={editingComment}
          />
        ) : note.comment ? (
          <p className="mt-2 rounded-md bg-zinc-50 px-2 py-1.5 text-xs leading-5 text-zinc-500">
            {note.comment}
          </p>
        ) : null}
        <ReadingNoteActions
          asset={asset}
          copyNote={copyNote}
          deleteNote={deleteNote}
          isEditing={editingNoteId === note.id}
          note={note}
          onCreateNoteNode={onCreateNoteNode}
          saveEditedNote={saveEditedNote}
          setEditingNoteId={setEditingNoteId}
          startEditNote={startEditNote}
        />
      </div>
      <ReadingNoteDropSlot
        noteId={note.id}
        placement="after"
        readDraggedNoteId={readDraggedNoteId}
        reorderNotes={reorderNotes}
        show={showAfterIndicator}
        updateNoteDropIndicator={updateNoteDropIndicator}
      />
    </div>
  );
});
