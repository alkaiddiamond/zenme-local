import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  inspectWorkspaceRoot,
  resolveExistingWorkspacePath,
  WorkspacePathError,
} from "@/lib/workspace/workspace-inspection";

let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-inspect-"));
});

afterEach(async () => {
  await fs.rm(tempDir, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 50,
  });
});

describe("workspace inspection", () => {
  it("accepts an existing local directory and creates a stable identity", async () => {
    await fs.writeFile(path.join(tempDir, "package.json"), "{}", "utf8");
    const first = await inspectWorkspaceRoot(tempDir);
    const second = await inspectWorkspaceRoot(tempDir);

    expect(first.realPath).toBe(await fs.realpath(tempDir));
    expect(first.identity.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.identity).toEqual(first.identity);
  });

  it("rejects relative, missing, and network paths", async () => {
    await expect(inspectWorkspaceRoot("relative/path")).rejects.toMatchObject({
      code: "invalid_path",
    });
    await expect(
      inspectWorkspaceRoot(path.join(tempDir, "missing")),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(inspectWorkspaceRoot("\\\\server\\share")).rejects.toMatchObject({
      code: "network_path_unsupported",
    });
  });

  it("rejects lexical and symbolic-link escapes", async () => {
    const workspace = path.join(tempDir, "workspace");
    const outside = path.join(tempDir, "outside");
    await fs.mkdir(workspace);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.txt"), "secret", "utf8");

    await expect(
      resolveExistingWorkspacePath(await fs.realpath(workspace), "../outside/secret.txt"),
    ).rejects.toBeInstanceOf(WorkspacePathError);

    const linkPath = path.join(workspace, "outside-link");
    try {
      await fs.symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    await expect(
      resolveExistingWorkspacePath(await fs.realpath(workspace), "outside-link/secret.txt"),
    ).rejects.toMatchObject({ code: "invalid_path" });
  });
});
