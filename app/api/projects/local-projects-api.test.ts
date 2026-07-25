import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GET as getProject } from "@/app/api/projects/[projectId]/route";
import {
  GET as getCanvas,
  PUT as putCanvas,
} from "@/app/api/projects/[projectId]/canvas/route";
import {
  GET as getThumbnail,
  PUT as putThumbnail,
} from "@/app/api/projects/[projectId]/thumbnail/route";
import {
  GET as listProjects,
  POST as createProject,
} from "@/app/api/projects/route";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-api-"));
  process.env.ZENME_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.ZENME_DATA_DIR;
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local projects API", () => {
  it("persists the initial prompt text node with the new project", async () => {
    const updatedAt = "2026-07-25T00:00:00.000Z";
    const initialCanvas = {
      version: 3 as const,
      nodes: [
        {
          id: "home-prompt",
          type: "text",
          position: { x: 120, y: 120 },
          data: {
            kind: "text",
            plainText: "从首页开始生成",
            richTextHtml: "",
            textGenerationModel: "provider/model",
            textGenerationPrompt: "从首页开始生成",
            textMode: "plain",
            title: "文本",
          },
        },
      ],
      edges: [],
      viewport: { x: 160, y: 120, zoom: 1 },
      updatedAt,
    };
    const createResponse = await createProject(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({
          initialCanvas,
          model: "provider/model",
          name: "首页项目",
          prompt: "从首页开始生成",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const project = await createResponse.json() as { id: string };
    const canvasResponse = await getCanvas(
      new Request(`http://localhost/api/projects/${project.id}/canvas`),
      { params: Promise.resolve({ projectId: project.id }) },
    );

    await expect(canvasResponse.json()).resolves.toMatchObject({
      snapshot: {
        nodes: [
          {
            id: "home-prompt",
            data: { plainText: "从首页开始生成" },
          },
        ],
      },
    });
  });

  it("creates projects and saves the latest canvas snapshot locally", async () => {
    const createResponse = await createProject(
      new Request("http://localhost/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: "Local API",
          prompt: "build locally",
          model: "glm-4.5",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    const project = await createResponse.json() as { id: string; name: string };
    expect(project.name).toBe("Local API");

    const projectResponse = await getProject(
      new Request(`http://localhost/api/projects/${project.id}`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(projectResponse.status).toBe(200);

    const snapshot = {
      version: 3,
      nodes: [{ id: "node-1" }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      updatedAt: new Date(Date.now() + 1_000).toISOString(),
    };
    const formData = new FormData();
    formData.set("snapshot", JSON.stringify(snapshot));

    const saveResponse = await putCanvas(
      new Request(`http://localhost/api/projects/${project.id}/canvas`, {
        method: "PUT",
        body: formData,
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(saveResponse.status).toBe(200);

    const canvasResponse = await getCanvas(
      new Request(`http://localhost/api/projects/${project.id}/canvas`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(await canvasResponse.json()).toMatchObject({
      snapshot: {
        nodes: [{ id: "node-1" }],
      },
    });

    const thumbnailResponse = await putThumbnail(
      new Request(`http://localhost/api/projects/${project.id}/thumbnail`, {
        method: "PUT",
        headers: { "content-type": "image/webp" },
        body: new Blob(["webp"], { type: "image/webp" }),
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(thumbnailResponse.status).toBe(200);
    const savedThumbnail = await getThumbnail(
      new Request(`http://localhost/api/projects/${project.id}/thumbnail`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(await savedThumbnail.text()).toBe("webp");

    const canvasAfterThumbnail = await getCanvas(
      new Request(`http://localhost/api/projects/${project.id}/canvas`),
      { params: Promise.resolve({ projectId: project.id }) },
    );
    expect(await canvasAfterThumbnail.json()).toMatchObject({
      snapshot: { nodes: [{ id: "node-1" }] },
    });

    const listResponse = await listProjects();
    expect(await listResponse.json()).toHaveLength(1);
  });
});
