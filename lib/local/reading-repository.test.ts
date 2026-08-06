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
import { shouldRebuildTxtSections } from "@/lib/reading/parsers/txt-parser";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-reading-"));
  const project = await createLocalProject(
    {
      name: "Reading",
      prompt: "",
      model: "glm-4.5",
    },
    dataDir,
  );
  projectId = project.id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local reading repository", () => {
  it("imports Markdown assets as rendered, annotatable fixed pages", async () => {
    const asset = await createLocalReadingAsset(
      {
        projectId,
        nodeId: "text-node-1",
        fileName: "阅读笔记.md",
        mimeType: "text/markdown",
        bytes: Buffer.from("# 第一章\n\n正文 **重点内容**\n\n\\[x^2\\]"),
      },
      dataDir,
    );

    expect(asset).toMatchObject({
      fileName: "阅读笔记.md",
      format: "markdown",
      nodeId: "text-node-1",
      title: "阅读笔记",
    });
    const sections = await getLocalReadingSections(asset.id, dataDir);
    expect(sections[0]).toMatchObject({ index: 0, title: "第一章" });
    expect(sections[0].html).toContain("<strong>重点内容</strong>");
    expect(sections[0].text).toContain("正文");

    const note = await createLocalReadingNote(
      {
        assetId: asset.id,
        ownerId: "local",
        projectId,
        selectedText: "重点内容",
        sectionIndex: 0,
        offset: sections[0].text.indexOf("重点内容"),
        length: 4,
        ranges: [
          {
            sectionIndex: 0,
            offset: sections[0].text.indexOf("重点内容"),
            length: 4,
          },
          { sectionIndex: 1, offset: 0, length: 2 },
        ],
        type: "highlight",
      },
      dataDir,
    );
    expect(note).toMatchObject({ selectedText: "重点内容", sectionIndex: 0 });
    await expect(listLocalReadingNotes(asset.id, dataDir)).resolves.toEqual([
      expect.objectContaining({
        ranges: [
          expect.objectContaining({ sectionIndex: 0, length: 4 }),
          { sectionIndex: 1, offset: 0, length: 2 },
        ],
      }),
    ]);
  });

  it("repairs legacy TXT sections decoded with the wrong charset", async () => {
    const asset = await createLocalReadingAsset(
      {
        projectId,
        nodeId: "node-gbk",
        fileName: "legacy.txt",
        mimeType: "text/plain",
        bytes: Buffer.from([0xd6, 0xd0, 0xce, 0xc4]),
      },
      dataDir,
    );
    const sectionsPath = path.join(
      dataDir,
      "projects",
      projectId,
      "reading",
      asset.id,
      "sections.json",
    );
    await fs.writeFile(
      sectionsPath,
      JSON.stringify([
        {
          html: "<p>���乱码���</p>",
          index: 0,
          text: "���乱码���",
          title: "正文",
        },
      ]),
      "utf8",
    );

    await expect(getLocalReadingSections(asset.id, dataDir)).resolves.toEqual([
      expect.objectContaining({ text: "中文" }),
    ]);
    await expect(
      fs.readFile(sectionsPath, "utf8").then((value) => JSON.parse(value)),
    ).resolves.toEqual([expect.objectContaining({ text: "中文" })]);
  });

  it("migrates legacy variable-height TXT sections to fixed pages", async () => {
    const source = Array.from(
      { length: 30 },
      (_, index) => `第 ${index + 1} 段正文`,
    ).join("\n");
    const asset = await createLocalReadingAsset(
      {
        projectId,
        nodeId: "node-legacy-pages",
        fileName: "legacy-pages.txt",
        mimeType: "text/plain",
        bytes: Buffer.from(source),
      },
      dataDir,
    );
    const sectionsPath = path.join(
      dataDir,
      "projects",
      projectId,
      "reading",
      asset.id,
      "sections.json",
    );
    const legacySection = {
      html: source
        .split("\n")
        .map((paragraph) => `<p>${paragraph}</p>`)
        .join(""),
      index: 0,
      text: source,
      title: "正文",
    };
    await fs.writeFile(sectionsPath, JSON.stringify([legacySection]), "utf8");
    await createLocalReadingNote(
      {
        assetId: asset.id,
        ownerId: "local",
        projectId,
        selectedText: "第 30 段正文",
        sectionIndex: 0,
        offset: source.indexOf("第 30 段正文"),
        length: "第 30 段正文".length,
      },
      dataDir,
    );

    const migrated = await getLocalReadingSections(asset.id, dataDir);
    const sectionsAfterFirstRead = await fs.readFile(sectionsPath, "utf8");
    const readAgain = await getLocalReadingSections(asset.id, dataDir);
    const sectionsAfterSecondRead = await fs.readFile(sectionsPath, "utf8");
    const [migratedNote] = await listLocalReadingNotes(asset.id, dataDir);

    expect(migrated.length).toBeGreaterThan(1);
    expect(readAgain).toEqual(migrated);
    expect(sectionsAfterSecondRead).toBe(sectionsAfterFirstRead);
    expect(shouldRebuildTxtSections(migrated)).toBe(false);
    expect(migrated.map((section) => section.text).join("\n")).toContain(
      "第 30 段正文",
    );
    expect(migratedNote.sectionIndex).toBeGreaterThan(0);
    expect(migratedNote.ranges).toEqual([
      {
        sectionIndex: migratedNote.sectionIndex,
        offset: migratedNote.offset,
        length: migratedNote.length,
      },
    ]);
  });

  it("imports text assets and persists notes and progress", async () => {
    const asset = await createLocalReadingAsset(
      {
        projectId,
        nodeId: "node-1",
        fileName: "book.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("第一章\nhello local reading"),
      },
      dataDir,
    );

    expect(asset).toMatchObject({
      fileName: "book.txt",
      format: "txt",
      ownerId: "local",
      projectId,
    });
    await expect(
      getLocalReadingAssetFile(asset.id, dataDir),
    ).resolves.toMatchObject({
      fileName: "book.txt",
      format: "txt",
    });
    await expect(getLocalReadingSections(asset.id, dataDir)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          text: expect.stringContaining("hello"),
        }),
      ]),
    );

    const note = await createLocalReadingNote(
      {
        assetId: asset.id,
        ownerId: "local",
        projectId,
        selectedText: "hello",
        comment: "note",
        sectionIndex: 0,
      },
      dataDir,
    );
    expect(note.sortOrder).toBe(0);
    await expect(
      listLocalReadingNotes(asset.id, dataDir),
    ).resolves.toHaveLength(1);

    await expect(
      updateLocalReadingNote(note.id, { comment: "updated" }, dataDir),
    ).resolves.toMatchObject({ comment: "updated" });

    await saveLocalReadingProgress(
      {
        assetId: asset.id,
        contentScale: 1.25,
        notesScrollTop: 486.5,
        projectId,
        scrollRatio: 0.5,
        sectionIndex: 1,
      },
      dataDir,
    );
    await expect(getLocalReadingProgress(asset.id, dataDir)).resolves.toMatchObject({
      notesScrollTop: 486.5,
    });
    await expect(
      getLocalReadingProgress(asset.id, dataDir),
    ).resolves.toMatchObject({
      contentScale: 1.3,
      scrollRatio: 0.5,
      sectionIndex: 1,
    });

    await expect(deleteLocalReadingNote(note.id, dataDir)).resolves.toBe(true);
    await expect(listLocalReadingNotes(asset.id, dataDir)).resolves.toEqual([]);
  });
});
