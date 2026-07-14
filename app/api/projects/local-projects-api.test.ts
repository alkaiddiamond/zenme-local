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
      updatedAt: "2026-07-08T00:00:00.000Z",
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

    const listResponse = await listProjects();
    expect(await listResponse.json()).toHaveLength(1);
  });
});
