import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getAppShellState,
  updateAppShellState,
} from "@/lib/local/app-shell-state";

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-app-shell-state-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
});

describe("app shell state", () => {
  it("persists favorite projects across independent reads", async () => {
    await updateAppShellState({ favoriteProjectIds: ["project-a"] }, dataDir);

    await expect(getAppShellState(dataDir)).resolves.toMatchObject({
      favoriteProjectIds: ["project-a"],
    });
  });

  it("serializes concurrent partial updates without losing fields", async () => {
    await Promise.all([
      updateAppShellState({ favoriteProjectIds: ["favorite"] }, dataDir),
      updateAppShellState({ pinnedProjectIds: ["pinned"] }, dataDir),
    ]);

    await expect(getAppShellState(dataDir)).resolves.toMatchObject({
      favoriteProjectIds: ["favorite"],
      pinnedProjectIds: ["pinned"],
    });
  });

  it("normalizes duplicate and excessive open project ids", async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `project-${index}`);
    const state = await updateAppShellState({
      favoriteProjectIds: ["project-a", "project-a", ""],
      openProjectIds: ids,
    }, dataDir);

    expect(state.favoriteProjectIds).toEqual(["project-a"]);
    expect(state.openProjectIds).toEqual(ids.slice(-9));
  });
});
