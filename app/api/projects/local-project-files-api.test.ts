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
  const project = await createLocalProject({
    name: "Files API",
    prompt: "",
    model: "glm-4.5",
  });
  projectId = project.id;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  delete process.env.ZENME_DESKTOP;
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
    expect(fileResponse.headers.get("accept-ranges")).toBe("bytes");
    expect(fileResponse.headers.get("content-length")).toBe("5");
    await expect(fileResponse.text()).resolves.toBe("hello");

    const rangeResponse = await getFile(
      new Request(`http://localhost${upload.originalUrl}`, {
        headers: { range: "bytes=1-3" },
      }),
      { params: Promise.resolve({ projectId, fileId: upload.fileId }) },
    );
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(rangeResponse.headers.get("content-length")).toBe("3");
    await expect(rangeResponse.text()).resolves.toBe("ell");

    const invalidRangeResponse = await getFile(
      new Request(`http://localhost${upload.originalUrl}`, {
        headers: { range: "bytes=10-20" },
      }),
      { params: Promise.resolve({ projectId, fileId: upload.fileId }) },
    );
    expect(invalidRangeResponse.status).toBe(416);
    expect(invalidRangeResponse.headers.get("content-range")).toBe("bytes */5");

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

  it("streams desktop file references without copying or deleting the source", async () => {
    process.env.ZENME_DESKTOP = "1";
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-api-external-"));
    const externalPath = path.join(externalDir, "song.ogg");
    await fs.writeFile(externalPath, "audio-content");

    try {
      const referenceResponse = await uploadFile(
        new Request(`http://localhost/api/projects/${projectId}/files`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            externalPath,
            fileName: "song.ogg",
            mimeType: "audio/ogg",
          }),
        }),
        { params: Promise.resolve({ projectId }) },
      );
      expect(referenceResponse.status).toBe(200);
      const reference = (await referenceResponse.json()) as {
        externalPath: string;
        fileId: string;
        originalPath: string;
        originalUrl: string;
      };
      expect(reference).toMatchObject({
        externalPath: await fs.realpath(externalPath),
        originalPath: "",
      });

      const rangeResponse = await getFile(
        new Request(`http://localhost${reference.originalUrl}`, {
          headers: { range: "bytes=6-12" },
        }),
        { params: Promise.resolve({ projectId, fileId: reference.fileId }) },
      );
      expect(rangeResponse.status).toBe(206);
      expect(rangeResponse.headers.get("content-type")).toBe("audio/ogg");
      await expect(rangeResponse.text()).resolves.toBe("content");

      await deleteFile(
        new Request(`http://localhost${reference.originalUrl}`, { method: "DELETE" }),
        { params: Promise.resolve({ projectId, fileId: reference.fileId }) },
      );
      await expect(fs.readFile(externalPath, "utf8")).resolves.toBe("audio-content");
    } finally {
      await fs.rm(externalDir, { force: true, recursive: true });
    }
  });
});
