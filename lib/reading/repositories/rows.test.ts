import { describe, expect, it } from "vitest";

import {
  normalizeColor,
  normalizeType,
  rowToAsset,
  rowToNote,
  rowToProgress,
  type ReadingAssetRow,
  type ReadingNoteRow,
  type ReadingProgressRow,
} from "./rows";

describe("reading repository row mappers", () => {
  it("maps reading asset rows to client models", () => {
    const row: ReadingAssetRow = {
      author: "作者",
      cover_path: "user/project/reading/covers/asset.webp",
      created_at: "2026-06-28T01:00:00.000Z",
      file_name: "地师.epub",
      format: "epub",
      id: "asset-1",
      mime_type: "application/epub+zip",
      node_id: "node-1",
      owner_id: "user-1",
      project_id: "project-1",
      size_bytes: 123,
      storage_path: "user/project/reading/original/asset.epub",
      title: "地师",
      updated_at: "2026-06-28T02:00:00.000Z",
    };

    expect(rowToAsset(row)).toEqual({
      author: "作者",
      coverPath: "user/project/reading/covers/asset.webp",
      createdAt: "2026-06-28T01:00:00.000Z",
      fileName: "地师.epub",
      filePath: "user/project/reading/original/asset.epub",
      format: "epub",
      id: "asset-1",
      nodeId: "node-1",
      ownerId: "user-1",
      projectId: "project-1",
      storagePath: "user/project/reading/original/asset.epub",
      title: "地师",
      updatedAt: "2026-06-28T02:00:00.000Z",
    });
  });

  it("maps notes and normalizes invalid color/type values", () => {
    const row: ReadingNoteRow = {
      asset_id: "asset-1",
      chapter_title: "第一章",
      color: "cyan",
      comment: "批注",
      created_at: "2026-06-28T01:00:00.000Z",
      id: "note-1",
      length: 8,
      offset: 3,
      owner_id: "user-1",
      project_id: "project-1",
      rect: { h: 40, w: 100, x: 10, y: 20 },
      section_index: 2,
      selected_text: "选中文字",
      sort_order: null,
      type: "marker",
      updated_at: "2026-06-28T02:00:00.000Z",
    };

    expect(rowToNote(row)).toEqual({
      assetId: "asset-1",
      chapterTitle: "第一章",
      color: "yellow",
      comment: "批注",
      createdAt: "2026-06-28T01:00:00.000Z",
      id: "note-1",
      length: 8,
      offset: 3,
      ownerId: "user-1",
      projectId: "project-1",
      rect: { h: 40, w: 100, x: 10, y: 20 },
      sectionIndex: 2,
      selectedText: "选中文字",
      sortOrder: 0,
      type: "highlight",
      updatedAt: "2026-06-28T02:00:00.000Z",
    });
  });

  it("keeps supported note color and type values", () => {
    expect(normalizeColor("purple")).toBe("purple");
    expect(normalizeType("region")).toBe("region");
  });

  it("normalizes progress values to the supported reader range", () => {
    const base: ReadingProgressRow = {
      asset_id: "asset-1",
      content_scale: 1.25,
      owner_id: "user-1",
      project_id: "project-1",
      scroll_ratio: 1.5,
      section_index: 4,
      updated_at: "2026-06-28T02:00:00.000Z",
    };

    expect(rowToProgress(base)).toEqual({
      assetId: "asset-1",
      contentScale: 1.3,
      ownerId: "user-1",
      scrollRatio: 1,
      sectionIndex: 4,
      updatedAt: "2026-06-28T02:00:00.000Z",
    });
    expect(rowToProgress({ ...base, scroll_ratio: -0.2 }).scrollRatio).toBe(0);
    expect(rowToProgress({ ...base, scroll_ratio: 0.4 }).scrollRatio).toBe(0.4);
    expect(rowToProgress({ ...base, section_index: -2 }).sectionIndex).toBe(0);
    expect(rowToProgress({ ...base, content_scale: 8 }).contentScale).toBe(1.8);
  });
});
