import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DELETE as deleteFile,
  GET as getFile,
} from "@/app/api/projects/[projectId]/files/[fileId]/route";
import {
  GET as getPreview,
} from "@/app/api/projects/[projectId]/files/[fileId]/preview/route";
import {
  GET as listFiles,
  POST as uploadFile,
} from "@/app/api/projects/[projectId]/files/route";
import { createLocalProject } from "@/lib/local/project-repository";

let dataDir: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-files-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
  process.env.ZENME_STORAGE_DRIVER = "local";
  const project = await createLocalProject({
    name: "Files API",
    prompt: "",
    model: "glm-4.5",
  });
  projectId = project.id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  delete process.env.ZENME_STORAGE_DRIVER;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local project files API", () => {
  it("uploads, serves, lists, and deletes files", async () => {
    const formData = new FormData();
    formData.set("file", new File(["hello"], "note.txt", { type: "text/plain" }));
    formData.set("preview", new File(["webp"], "preview.webp", { type: "image/webp" }));

    const uploadResponse = await uploadFile(
      new Request(`http://localhost/api/projects/${projectId}/files`, {
        method: "POST",
        body: formData,
      }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(uploadResponse.status).toBe(200);
    const upload = await uploadResponse.json() as {
      fileId: string;
      originalUrl: string;
      previewUrl: string;
    };
    expect(upload.originalUrl).toBe(`/api/projects/${projectId}/files/${upload.fileId}`);
    expect(upload.previewUrl).toBe(`/api/projects/${projectId}/files/${upload.fileId}/preview`);

    const fileResponse = await getFile(
      new Request(`http://localhost${upload.originalUrl}`),
      { params: Promise.resolve({ projectId, fileId: upload.fileId }) },
    );
    expect(fileResponse.headers.get("content-type")).toBe("text/plain");
    await expect(fileResponse.text()).resolves.toBe("hello");

    const previewResponse = await getPreview(
      new Request(`http://localhost${upload.previewUrl}`),
      { params: Promise.resolve({ projectId, fileId: upload.fileId }) },
    );
    expect(previewResponse.headers.get("content-type")).toBe("image/webp");
    await expect(previewResponse.text()).resolves.toBe("webp");

    const listResponse = await listFiles(
      new Request(`http://localhost/api/projects/${projectId}/files`),
      { params: Promise.resolve({ projectId }) },
    );
    expect(await listResponse.json()).toHaveLength(1);

    const deleteResponse = await deleteFile(
      new Request(`http://localhost${upload.originalUrl}`, { method: "DELETE" }),
      { params: Promise.resolve({ projectId, fileId: upload.fileId }) },
    );
    expect(deleteResponse.status).toBe(200);

    const secondListResponse = await listFiles(
      new Request(`http://localhost/api/projects/${projectId}/files`),
      { params: Promise.resolve({ projectId }) },
    );
    expect(await secondListResponse.json()).toEqual([]);
  });
});

