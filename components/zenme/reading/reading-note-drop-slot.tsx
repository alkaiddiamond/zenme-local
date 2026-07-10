import type { DragEvent as ReactDragEvent } from "react";

export type NoteDropPlacement = "before" | "after";

type ReadingNoteDropSlotProps = {
  noteId: string;
  placement: NoteDropPlacement;
  readDraggedNoteId: (event: ReactDragEvent<HTMLElement>) => string | null;
  reorderNotes: (
    sourceId: string | null,
    targetId: string,
    placement: NoteDropPlacement,
  ) => void;
  show: boolean;
  updateNoteDropIndicator: (placement: NoteDropPlacement) => void;
};

export function ReadingNoteDropSlot({
  noteId,
  placement,
  readDraggedNoteId,
  reorderNotes,
  show,
  updateNoteDropIndicator,
}: ReadingNoteDropSlotProps) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden transition-[height,margin] duration-150 ease-out ${
        show ? "mb-2 h-7" : "mb-0 h-0"
      }`}
      onDragOver={(event) => {
        const draggedNoteId = readDraggedNoteId(event);
        if (!draggedNoteId || draggedNoteId === noteId) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        updateNoteDropIndicator(placement);
      }}
      onDrop={(event) => {
        const draggedNoteId = readDraggedNoteId(event);
        if (!draggedNoteId) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        reorderNotes(draggedNoteId, noteId, placement);
      }}
    >
      <div className="flex h-7 items-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-3">
        <span className="h-px flex-1 bg-zinc-300" />
        <span className="text-[11px] text-zinc-400">释放到这里</span>
        <span className="h-px flex-1 bg-zinc-300" />
      </div>
    </div>
  );
}
