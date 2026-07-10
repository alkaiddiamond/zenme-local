import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalProject,
  getLocalCanvasSnapshot,
  getLocalProject,
  listLocalProjects,
  saveLocalCanvasSnapshot,
  updateLocalProjectName,
} from "@/lib/local/project-repository";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-local-repo-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("local project repository", () => {
  it("creates, lists, renames, and reads projects", async () => {
    const project = await createLocalProject({
      name: "Local project",
      prompt: "hello",
      model: "glm-4.5",
    }, dataDir);

    await expect(getLocalProject(project.id, dataDir)).resolves.toMatchObject({
      id: project.id,
      name: "Local project",
    });
    await expect(listLocalProjects(dataDir)).resolves.toHaveLength(1);

    const renamed = await updateLocalProjectName({
      projectId: project.id,
      name: "Renamed",
    }, dataDir);
    expect(renamed.name).toBe("Renamed");
  });

  it("saves and restores the latest canvas snapshot", async () => {
    const project = await createLocalProject({
      name: "Canvas",
      prompt: "",
      model: "glm-4.5",
    }, dataDir);

    await saveLocalCanvasSnapshot({
      projectId: project.id,
      snapshot: {
        version: 1,
        nodes: [{ id: "node-1" }],
        edges: [],
        viewport: { x: 1, y: 2, zoom: 1.5 },
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
    }, dataDir);

    await expect(getLocalCanvasSnapshot(project.id, dataDir)).resolves.toMatchObject({
      snapshot: {
        nodes: [{ id: "node-1" }],
        viewport: { x: 1, y: 2, zoom: 1.5 },
      },
      updated_at: "2026-07-08T00:00:00.000Z",
    });
  });
});

