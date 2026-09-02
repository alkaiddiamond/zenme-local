import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadReadingFileAttachments,
  ReadingFileAttachmentError,
} from "@/lib/agent/reading-file-attachments";
import { createLocalProject } from "@/lib/local/project-repository";
import { createLocalReadingAsset } from "@/lib/local/reading-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-agent-reading-"));
  const project = await createLocalProject({
    model: "gpt-5.6-sol",
    name: "Reading attachments",
    prompt: "",
  }, dataDir);
  projectId = project.id;
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("Agent reading file attachments", () => {
  it("loads the original PDF after checking project ownership", async () => {
    const bytes = Buffer.from("%PDF-1.7 original bytes");
    const asset = await createLocalReadingAsset({
      bytes,
      fileName: "manual.pdf",
      mimeType: "application/pdf",
      projectId,
    }, dataDir);

    await expect(loadReadingFileAttachments({
      assetIds: [asset.id, asset.id],
      dataDir,
      projectId,
    })).resolves.toEqual([{
      dataUrl: `data:application/pdf;base64,${bytes.toString("base64")}`,
      fileName: "manual.pdf",
      mimeType: "application/pdf",
    }]);
  });

  it("rejects reading assets from another project", async () => {
    const asset = await createLocalReadingAsset({
      bytes: Buffer.from("text"),
      fileName: "notes.txt",
      mimeType: "text/plain",
      projectId,
    }, dataDir);

    await expect(loadReadingFileAttachments({
      assetIds: [asset.id],
      dataDir,
      projectId: "another-project",
    })).rejects.toBeInstanceOf(ReadingFileAttachmentError);
  });
});
