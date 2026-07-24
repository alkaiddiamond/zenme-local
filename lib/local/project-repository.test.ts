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
  saveLocalProjectThumbnail,
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

    const updatedAt = new Date(Date.now() + 1_000).toISOString();
    await saveLocalCanvasSnapshot({
      projectId: project.id,
      snapshot: {
        version: 3,
        nodes: [{ id: "node-1" }],
        edges: [],
        viewport: { x: 1, y: 2, zoom: 1.5 },
        updatedAt,
      },
    }, dataDir);

    await expect(getLocalCanvasSnapshot(project.id, dataDir)).resolves.toMatchObject({
      snapshot: {
        nodes: [{ id: "node-1" }],
        viewport: { x: 1, y: 2, zoom: 1.5 },
      },
      updated_at: updatedAt,
    });
  });

  it("never lets an older canvas snapshot overwrite a newer save", async () => {
    const project = await createLocalProject({
      name: "Ordered Canvas",
      prompt: "",
      model: "glm-4.5",
    }, dataDir);
    const projectCreatedAt = Date.parse(project.createdAt);
    const staleUpdatedAt = new Date(projectCreatedAt + 5_000).toISOString();
    const newestUpdatedAt = new Date(projectCreatedAt + 10_000).toISOString();

    await saveLocalCanvasSnapshot({
      projectId: project.id,
      snapshot: {
        version: 3,
        nodes: [{ id: "new-node" }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: newestUpdatedAt,
      },
    }, dataDir);
    await saveLocalCanvasSnapshot({
      projectId: project.id,
      snapshot: {
        version: 3,
        nodes: [{ id: "stale-node" }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: staleUpdatedAt,
      },
    }, dataDir);

    await expect(getLocalCanvasSnapshot(project.id, dataDir)).resolves.toMatchObject({
      snapshot: { nodes: [{ id: "new-node" }] },
      updated_at: newestUpdatedAt,
    });
  });

  it("updates the project thumbnail without rewriting the canvas snapshot", async () => {
    const project = await createLocalProject({
      name: "Thumbnail",
      prompt: "",
      model: "glm-4.5",
    }, dataDir);
    const before = await getLocalCanvasSnapshot(project.id, dataDir);

    await saveLocalProjectThumbnail({
      projectId: project.id,
      thumbnail: Buffer.from("webp"),
    }, dataDir);

    await expect(getLocalCanvasSnapshot(project.id, dataDir)).resolves.toEqual(before);
    await expect(
      fs.readFile(
        path.join(dataDir, "projects", project.id, "canvas", "thumbnail.webp"),
        "utf8",
      ),
    ).resolves.toBe("webp");
  });

  it("migrates and rewrites legacy image edit snapshots on first read", async () => {
    const project = await createLocalProject({
      name: "Legacy Canvas",
      prompt: "",
      model: "glm-4.5",
    }, dataDir);
    const snapshotPath = path.join(
      dataDir,
      "projects",
      project.id,
      "canvas",
      "latest.json",
    );
    await fs.writeFile(snapshotPath, JSON.stringify({
      snapshot: {
        version: 1,
        nodes: [{
          id: "legacy",
          type: "imageEdit",
          position: { x: 0, y: 0 },
          data: { kind: "imageEdit", title: "图片编辑" },
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        updatedAt: "2026-07-08T00:00:00.000Z",
      },
      updated_at: "2026-07-08T00:00:00.000Z",
    }), "utf8");

    await expect(getLocalCanvasSnapshot(project.id, dataDir)).resolves.toMatchObject({
      snapshot: {
        version: 3,
        nodes: [{
          type: "imageGeneration",
          data: { kind: "imageGeneration", title: "图片生成" },
        }],
      },
    });
    const persisted = JSON.parse(await fs.readFile(snapshotPath, "utf8"));
    expect(persisted.snapshot.version).toBe(3);
    expect(JSON.stringify(persisted)).not.toContain("imageEdit\"");
  });
});
