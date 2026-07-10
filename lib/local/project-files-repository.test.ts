import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteLocalProjectFile,
  getLocalProjectFile,
  importLocalProjectFile,
  listLocalProjectFiles,
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
});

