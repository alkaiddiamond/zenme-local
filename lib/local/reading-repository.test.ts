import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalReadingAsset,
  createLocalReadingNote,
  getLocalReadingAssetFile,
  getLocalReadingProgress,
  getLocalReadingSections,
  listLocalReadingNotes,
  saveLocalReadingProgress,
  updateLocalReadingNote,
  deleteLocalReadingNote,
} from "@/lib/local/reading-repository";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-reading-"));
  const project = await createLocalProject({
    name: "Reading",
    prompt: "",
    model: "glm-4.5",
  }, dataDir);
  projectId = project.id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local reading repository", () => {
  it("imports text assets and persists notes and progress", async () => {
    const asset = await createLocalReadingAsset({
      projectId,
      nodeId: "node-1",
      fileName: "book.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("第一章\nhello local reading"),
    }, dataDir);

    expect(asset).toMatchObject({
      fileName: "book.txt",
      format: "txt",
      ownerId: "local",
      projectId,
    });
    await expect(getLocalReadingAssetFile(asset.id, dataDir)).resolves.toMatchObject({
      fileName: "book.txt",
      format: "txt",
    });
    await expect(getLocalReadingSections(asset.id, dataDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ index: 0, text: expect.stringContaining("hello") }),
      ]),
    );

    const note = await createLocalReadingNote({
      assetId: asset.id,
      ownerId: "local",
      projectId,
      selectedText: "hello",
      comment: "note",
      sectionIndex: 0,
    }, dataDir);
    expect(note.sortOrder).toBe(0);
    await expect(listLocalReadingNotes(asset.id, dataDir)).resolves.toHaveLength(1);

    await expect(updateLocalReadingNote(note.id, { comment: "updated" }, dataDir))
      .resolves.toMatchObject({ comment: "updated" });

    await saveLocalReadingProgress({
      assetId: asset.id,
      contentScale: 1.25,
      projectId,
      scrollRatio: 0.5,
      sectionIndex: 1,
    }, dataDir);
    await expect(getLocalReadingProgress(asset.id, dataDir)).resolves.toMatchObject({
      contentScale: 1.3,
      scrollRatio: 0.5,
      sectionIndex: 1,
    });

    await expect(deleteLocalReadingNote(note.id, dataDir)).resolves.toBe(true);
    await expect(listLocalReadingNotes(asset.id, dataDir)).resolves.toEqual([]);
  });
});
