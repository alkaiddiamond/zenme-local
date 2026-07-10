import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { importZenmeExport } from "./import-local-data.mjs";

let tmpDir;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-import-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { force: true, recursive: true });
});

describe("import-local-data", () => {
  it("imports a Supabase-shaped export directory into the local data layout", async () => {
    const sourceDir = path.join(tmpDir, "export");
    const dataDir = path.join(tmpDir, "data");
    await fs.mkdir(path.join(sourceDir, "project_files"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "reading_files"), { recursive: true });

    await writeJson(path.join(sourceDir, "projects.json"), [
      {
        id: "project-1",
        name: "Imported",
        prompt: "prompt",
        model: "glm-4.5",
        created_at: "2026-07-08T00:00:00.000Z",
        updated_at: "2026-07-08T00:00:00.000Z",
      },
    ]);
    await writeJson(path.join(sourceDir, "canvas_snapshots.json"), [
      {
        project_id: "project-1",
        snapshot: {
          version: 1,
          nodes: [{ id: "node-1" }],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 },
          updatedAt: "2026-07-08T00:00:00.000Z",
        },
        updated_at: "2026-07-08T00:00:00.000Z",
      },
    ]);
    await writeJson(path.join(sourceDir, "project_files.json"), [
      {
        id: "file-1",
        project_id: "project-1",
        original_path: "user-1/project-1/original/file-1-note.txt",
        file_name: "note.txt",
        mime_type: "text/plain",
        size_bytes: 5,
        created_at: "2026-07-08T00:00:00.000Z",
      },
    ]);
    await fs.writeFile(
      path.join(sourceDir, "project_files", "user-1__project-1__original__file-1-note.txt"),
      "hello",
    );

    await writeJson(path.join(sourceDir, "reading_assets.json"), [
      {
        id: "asset-1",
        project_id: "project-1",
        node_id: "node-1",
        title: "Book",
        format: "txt",
        file_name: "book.txt",
        storage_path: "user-1/project-1/reading/original/asset-1-book.txt",
        created_at: "2026-07-08T00:00:00.000Z",
        updated_at: "2026-07-08T00:00:00.000Z",
      },
    ]);
    await writeJson(path.join(sourceDir, "reading_sections.json"), [
      {
        asset_id: "asset-1",
        index: 0,
        title: "Book",
        html: "",
        text: "hello book",
      },
    ]);
    await writeJson(path.join(sourceDir, "reading_notes.json"), [
      {
        id: "note-1",
        asset_id: "asset-1",
        project_id: "project-1",
        selected_text: "hello",
        comment: "comment",
        section_index: 0,
        created_at: "2026-07-08T00:00:00.000Z",
        updated_at: "2026-07-08T00:00:00.000Z",
      },
    ]);
    await writeJson(path.join(sourceDir, "reading_progress.json"), [
      {
        asset_id: "asset-1",
        content_scale: 1,
        section_index: 0,
        scroll_ratio: 0.4,
        updated_at: "2026-07-08T00:00:00.000Z",
      },
    ]);
    await fs.writeFile(
      path.join(
        sourceDir,
        "reading_files",
        "user-1__project-1__reading__original__asset-1-book.txt",
      ),
      "hello book",
    );

    await expect(importZenmeExport({ source: sourceDir, dataDir })).resolves.toMatchObject({
      projects: 1,
      projectFiles: 1,
      readingAssets: 1,
      readingNotes: 1,
    });

    await expect(
      fs.readFile(path.join(dataDir, "projects", "project-1", "project.json"), "utf-8"),
    ).resolves.toContain('"name": "Imported"');
    await expect(
      fs.readFile(
        path.join(dataDir, "projects", "project-1", "canvas", "latest.json"),
        "utf-8",
      ),
    ).resolves.toContain("node-1");
    await expect(
      fs.readFile(
        path.join(dataDir, "projects", "project-1", "reading", "asset-1", "notes.json"),
        "utf-8",
      ),
    ).resolves.toContain("comment");
    await expect(
      fs.readFile(
        path.join(dataDir, "projects", "project-1", "files", "original", "file-1-note.txt"),
        "utf-8",
      ),
    ).resolves.toBe("hello");
  });
});

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
