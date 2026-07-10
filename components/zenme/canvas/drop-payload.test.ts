import { describe, expect, it, vi } from "vitest";

import {
  parseDroppedReadingNotePayload,
  READING_NOTE_DROP_MIME,
} from "./drop-payload";

describe("canvas drop payload helpers", () => {
  it("parses reading note drag payloads from DataTransfer", () => {
    const asset = { id: "asset-1", title: "地师" };
    const note = { id: "note-1", selectedText: "选中文字" };
    const getData = vi
      .fn()
      .mockReturnValue(JSON.stringify({ asset, note }));

    expect(parseDroppedReadingNotePayload({ getData }) as unknown).toEqual({
      asset,
      note,
    });
    expect(getData).toHaveBeenCalledWith(READING_NOTE_DROP_MIME);
  });

  it("ignores missing or invalid reading note drag payloads", () => {
    expect(
      parseDroppedReadingNotePayload({
        getData: vi.fn().mockReturnValue(""),
      }),
    ).toBeNull();
    expect(
      parseDroppedReadingNotePayload({
        getData: vi.fn().mockReturnValue("{bad json"),
      }),
    ).toBeNull();
    expect(
      parseDroppedReadingNotePayload({
        getData: vi.fn().mockReturnValue(JSON.stringify({ note: {} })),
      }),
    ).toBeNull();
    expect(
      parseDroppedReadingNotePayload({
        getData: vi.fn().mockReturnValue(JSON.stringify({ asset: {} })),
      }),
    ).toBeNull();
  });
});
