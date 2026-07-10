import type { ReadingAsset, ReadingNote } from "@/lib/reading/types";

export const READING_NOTE_DROP_MIME = "application/x-zenme-reading-note";

export type DroppedReadingNotePayload = {
  asset: ReadingAsset;
  note: ReadingNote;
};

export function parseDroppedReadingNotePayload(
  dataTransfer: Pick<DataTransfer, "getData">,
): DroppedReadingNotePayload | null {
  const payload = dataTransfer.getData(READING_NOTE_DROP_MIME);
  if (!payload) {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Partial<DroppedReadingNotePayload>;
    if (!parsed.asset || !parsed.note) {
      return null;
    }

    return {
      asset: parsed.asset as ReadingAsset,
      note: parsed.note as ReadingNote,
    };
  } catch {
    return null;
  }
}
