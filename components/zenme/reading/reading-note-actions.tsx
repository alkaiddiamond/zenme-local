import { Copy, Pencil, Plus, Trash2 } from "lucide-react";

import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

type ReadingNoteActionsProps = {
  asset: ReadingAsset;
  copyNote: (note: ReadingNote) => void;
  deleteNote: (noteId: string) => void;
  isEditing: boolean;
  note: ReadingNote;
  onCreateNoteNode: (note: ReadingNote, asset: ReadingAsset) => void;
  saveEditedNote: (noteId: string) => void;
  setEditingNoteId: (noteId: string | null) => void;
  startEditNote: (note: ReadingNote) => void;
};

export function ReadingNoteActions({
  asset,
  copyNote,
  deleteNote,
  isEditing,
  note,
  onCreateNoteNode,
  saveEditedNote,
  setEditingNoteId,
  startEditNote,
}: ReadingNoteActionsProps) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1">
      {isEditing ? (
        <>
          <button
            className="rounded-md bg-zinc-950 px-2 py-1 text-xs text-white hover:bg-zinc-800"
            onClick={(event) => {
              event.stopPropagation();
              saveEditedNote(note.id);
            }}
            type="button"
          >
            保存
          </button>
          <button
            className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            onClick={(event) => {
              event.stopPropagation();
              setEditingNoteId(null);
            }}
            type="button"
          >
            取消
          </button>
        </>
      ) : (
        <>
          <button
            aria-label="创建画布节点"
            className="inline-flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              onCreateNoteNode(note, asset);
            }}
            onMouseDown={(event) => {
              if (event.button !== 1) {
                event.stopPropagation();
              }
            }}
            title="创建画布节点"
            type="button"
          >
            <Plus className="size-3.5" />
          </button>
          <button
            aria-label="编辑"
            className="inline-flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            onClick={(event) => {
              event.stopPropagation();
              startEditNote(note);
            }}
            title="编辑"
            type="button"
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            aria-label="复制"
            className="inline-flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950"
            onClick={(event) => {
              event.stopPropagation();
              copyNote(note);
            }}
            title="复制"
            type="button"
          >
            <Copy className="size-3.5" />
          </button>
          <button
            aria-label="删除"
            className="inline-flex size-6 items-center justify-center rounded-md text-zinc-500 hover:bg-red-50 hover:text-red-600"
            onClick={(event) => {
              event.stopPropagation();
              deleteNote(note.id);
            }}
            title="删除"
            type="button"
          >
            <Trash2 className="size-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
