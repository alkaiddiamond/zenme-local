import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST as createAsset } from "@/app/api/reading/assets/route";
import { GET as getPayload } from "@/app/api/reading/assets/[assetId]/route";
import { GET as getFile } from "@/app/api/reading/assets/[assetId]/file/route";
import {
  GET as getProgress,
  PUT as putProgress,
} from "@/app/api/reading/assets/[assetId]/progress/route";
import {
  GET as listNotes,
  POST as createNote,
} from "@/app/api/reading/assets/[assetId]/notes/route";
import {
  DELETE as deleteNote,
  PATCH as updateNote,
} from "@/app/api/reading/notes/[noteId]/route";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-reading-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  const project = await createLocalProject({
    name: "Reading API",
    prompt: "",
    model: "glm-4.5",
  });
  projectId = project.id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local reading API", () => {
  it("imports text assets and persists notes and progress locally", async () => {
    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("nodeId", "node-1");
    formData.set("fileSize", String(Buffer.byteLength("hello local api")));
    formData.set("file", new File(["hello local api"], "book.txt", { type: "text/plain" }));

    const createResponse = await createAsset(
      new Request("http://localhost/api/reading/assets", {
        method: "POST",
        body: formData,
      }),
    );
    expect(createResponse.status).toBe(200);
    const asset = await createResponse.json() as { id: string; projectId: string };
    expect(asset.projectId).toBe(projectId);

    const payloadResponse = await getPayload(
      new Request(`http://localhost/api/reading/assets/${asset.id}`),
      { params: Promise.resolve({ assetId: asset.id }) },
    );
    expect(await payloadResponse.json()).toMatchObject({
      asset: { id: asset.id },
      sections: [expect.objectContaining({ text: expect.stringContaining("hello") })],
      notes: [],
      progress: null,
    });

    const fileResponse = await getFile(
      new Request(`http://localhost/api/reading/assets/${asset.id}/file`),
      { params: Promise.resolve({ assetId: asset.id }) },
    );
    expect(fileResponse.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    await expect(fileResponse.text()).resolves.toBe("hello local api");

    const noteResponse = await createNote(
      new Request(`http://localhost/api/reading/assets/${asset.id}/notes`, {
        method: "POST",
        body: JSON.stringify({
          projectId,
          selectedText: "hello",
          comment: "comment",
          sectionIndex: 0,
        }),
      }),
      { params: Promise.resolve({ assetId: asset.id }) },
    );
    expect(noteResponse.status).toBe(200);
    const note = await noteResponse.json() as { id: string };

    const updateResponse = await updateNote(
      new Request(`http://localhost/api/reading/notes/${note.id}`, {
        method: "PATCH",
        body: JSON.stringify({ comment: "updated" }),
      }),
      { params: Promise.resolve({ noteId: note.id }) },
    );
    expect(await updateResponse.json()).toMatchObject({ comment: "updated" });

    const progressResponse = await putProgress(
      new Request(`http://localhost/api/reading/assets/${asset.id}/progress`, {
        method: "PUT",
        body: JSON.stringify({
          contentScale: 1.1,
          sectionIndex: 0,
          scrollRatio: 0.25,
        }),
      }),
      { params: Promise.resolve({ assetId: asset.id }) },
    );
    expect(await progressResponse.json()).toMatchObject({ scrollRatio: 0.25 });

    const savedProgressResponse = await getProgress(
      new Request(`http://localhost/api/reading/assets/${asset.id}/progress`),
      { params: Promise.resolve({ assetId: asset.id }) },
    );
    expect(await savedProgressResponse.json()).toMatchObject({ scrollRatio: 0.25 });

    const notesResponse = await listNotes(
      new Request(`http://localhost/api/reading/assets/${asset.id}/notes`),
      { params: Promise.resolve({ assetId: asset.id }) },
    );
    expect(await notesResponse.json()).toHaveLength(1);

    const deleteResponse = await deleteNote(
      new Request(`http://localhost/api/reading/notes/${note.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ noteId: note.id }) },
    );
    expect(deleteResponse.status).toBe(200);
  });
});
