import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteLocalProjectFile,
  getLocalProjectFile,
  importLocalProjectFile,
  listLocalProjectFiles,
  referenceLocalProjectFile,
} from "@/lib/local/project-files-repository";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-local-files-"));
  const project = await createLocalProject({
    name: "Files",
    prompt: "",
    model: "glm-4.5",
  }, dataDir);
  projectId = project.id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local project file repository", () => {
  it("imports, reads, lists, and deletes project files", async () => {
    const record = await importLocalProjectFile({
      projectId,
      fileName: "../unsafe:name.txt",
      mimeType: "text/plain",
      bytes: Buffer.from("hello"),
      previewBytes: Buffer.from("webp"),
    }, dataDir);

    expect(record.fileName).toBe("../unsafe:name.txt");
    expect(record.originalPath).toMatch(/^files\/original\//);
    expect(record.originalPath).not.toContain("..");
    expect(record.previewPath).toBe(`files/preview/${record.id}.webp`);

    await expect(listLocalProjectFiles(projectId, dataDir)).resolves.toHaveLength(1);
    await expect(
      getLocalProjectFile({ projectId, fileId: record.id, variant: "original" }, dataDir),
    ).resolves.toMatchObject({
      bytes: Buffer.from("hello"),
      fileName: "../unsafe:name.txt",
      mimeType: "text/plain",
    });
    await expect(
      getLocalProjectFile({ projectId, fileId: record.id, variant: "preview" }, dataDir),
    ).resolves.toMatchObject({
      bytes: Buffer.from("webp"),
      mimeType: "image/webp",
    });

    await deleteLocalProjectFile({ projectId, fileId: record.id }, dataDir);
    await expect(listLocalProjectFiles(projectId, dataDir)).resolves.toEqual([]);
    await expect(
      getLocalProjectFile({ projectId, fileId: record.id, variant: "original" }, dataDir),
    ).resolves.toBeNull();
  });

  it("references an external file without copying or deleting it", async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-external-file-"));
    const externalPath = path.join(externalDir, "张悬 - 喜欢.ogg");
    await fs.writeFile(externalPath, "audio-bytes");

    try {
      const record = await referenceLocalProjectFile(
        {
          projectId,
          externalPath,
          fileName: "张悬 - 喜欢.ogg",
          mimeType: "audio/ogg",
        },
        dataDir,
      );

      expect(record).toMatchObject({
        externalPath: await fs.realpath(externalPath),
        originalPath: "",
        sizeBytes: 11,
      });
      await expect(
        getLocalProjectFile(
          { projectId, fileId: record.id, variant: "original" },
          dataDir,
        ),
      ).resolves.toMatchObject({ bytes: Buffer.from("audio-bytes") });

      await deleteLocalProjectFile({ projectId, fileId: record.id }, dataDir);
      await expect(fs.readFile(externalPath, "utf8")).resolves.toBe("audio-bytes");
    } finally {
      await fs.rm(externalDir, { force: true, recursive: true });
    }
  });

  it("reuses an existing reference for the same external path", async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-external-dedupe-"));
    const externalPath = path.join(externalDir, "same.ogg");
    await fs.writeFile(externalPath, "audio");
    try {
      const first = await referenceLocalProjectFile(
        { projectId, externalPath, fileName: "same.ogg", mimeType: "audio/ogg" },
        dataDir,
      );
      const second = await referenceLocalProjectFile(
        { projectId, externalPath, fileName: "same.ogg", mimeType: "audio/ogg" },
        dataDir,
      );
      expect(second.id).toBe(first.id);
      await expect(listLocalProjectFiles(projectId, dataDir)).resolves.toHaveLength(1);
    } finally {
      await fs.rm(externalDir, { force: true, recursive: true });
    }
  });

  it("returns null after a referenced external file becomes unavailable", async () => {
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-missing-file-"));
    const externalPath = path.join(externalDir, "missing.ogg");
    await fs.writeFile(externalPath, "audio");
    const record = await referenceLocalProjectFile(
      { projectId, externalPath, fileName: "missing.ogg", mimeType: "audio/ogg" },
      dataDir,
    );
    await fs.rm(externalDir, { force: true, recursive: true });

    await expect(
      getLocalProjectFile(
        { projectId, fileId: record.id, variant: "original" },
        dataDir,
      ),
    ).resolves.toBeNull();
  });
});
