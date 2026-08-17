import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalProject, getLocalProject } from "@/lib/local/project-repository";
import {
  addLocalWorkspaceRoot,
  bindLocalWorkspace,
  getLocalWorkspaceBinding,
  setLocalWorkspaceRootPermissions,
  unbindLocalWorkspace,
} from "@/lib/local/workspace-repository";
import { canUseWorkspaceCapability, type WorkspaceAdditionalRoot } from "@/lib/workspace/types";

let dataDir: string;
let workspaceRoot: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-repo-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-root-"));
  await fs.writeFile(path.join(workspaceRoot, "README.md"), "workspace", "utf8");
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 50,
  });
});

describe("local workspace repository", () => {
  it("persists an additional Workspace root without replacing the primary root", async () => {
    const project = await createLocalProject({ name: "Multiple roots", prompt: "", model: "" }, dataDir);
    const extraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-extra-"));
    try {
      await bindLocalWorkspace({ projectId: project.id, rootPath: workspaceRoot }, dataDir);
      const binding = await addLocalWorkspaceRoot({ projectId: project.id, rootPath: extraRoot }, dataDir);
      expect(binding.realPath).toBe(await fs.realpath(workspaceRoot));
      expect(binding.additionalRoots).toEqual([
        expect.objectContaining({
          realPath: await fs.realpath(extraRoot),
          status: "resolved",
          permissions: { read: true, write: false, delete: false, execute: false, gitWrite: false },
          git: expect.objectContaining({ available: false }),
        }),
      ]);
      await expect(getLocalWorkspaceBinding(project.id, dataDir)).resolves.toMatchObject({
        additionalRoots: [expect.objectContaining({ realPath: await fs.realpath(extraRoot) })],
      });
    } finally {
      await fs.rm(extraRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("migrates old additional roots and keeps their stable identity", async () => {
    const project = await createLocalProject({ name: "Old additional root", prompt: "", model: "" }, dataDir);
    const extraRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-workspace-extra-old-"));
    try {
      const binding = await bindLocalWorkspace({ projectId: project.id, rootPath: workspaceRoot }, dataDir);
      const withRoot = await addLocalWorkspaceRoot({ projectId: project.id, rootPath: extraRoot }, dataDir);
      const bindingPath = path.join(dataDir, "projects", project.id, "workspace", "binding.json");
      const oldRoot = { ...withRoot.additionalRoots![0] } as Partial<WorkspaceAdditionalRoot>;
      delete oldRoot.permissions;
      delete oldRoot.git;
      await fs.writeFile(bindingPath, JSON.stringify({ ...binding, additionalRoots: [oldRoot] }), "utf8");

      const migrated = await getLocalWorkspaceBinding(project.id, dataDir);
      expect(migrated?.additionalRoots?.[0]).toMatchObject({
        id: oldRoot.id,
        permissions: { read: true, write: false, delete: false, execute: false, gitWrite: false },
        git: expect.objectContaining({ available: false }),
      });
      await expect(setLocalWorkspaceRootPermissions({
        projectId: project.id,
        rootId: oldRoot.id!,
        permissions: { write: true },
      }, dataDir)).resolves.toMatchObject({
        additionalRoots: [expect.objectContaining({ permissions: expect.objectContaining({ write: true }) })],
      });
    } finally {
      await fs.rm(extraRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  it("migrates an old binding without additional roots to an empty root list", async () => {
    const project = await createLocalProject({ name: "Old binding", prompt: "", model: "" }, dataDir);
    const binding = await bindLocalWorkspace({ projectId: project.id, rootPath: workspaceRoot }, dataDir);
    const bindingPath = path.join(dataDir, "projects", project.id, "workspace", "binding.json");
    const oldBinding = { ...binding };
    delete oldBinding.additionalRoots;
    await fs.writeFile(bindingPath, JSON.stringify(oldBinding), "utf8");
    await expect(getLocalWorkspaceBinding(project.id, dataDir)).resolves.toMatchObject({ additionalRoots: [] });
  });

  it("binds one workspace with read-only Phase 0 permissions and restores it", async () => {
    const project = await createLocalProject({
      name: "Workspace",
      prompt: "",
      model: "",
    }, dataDir);
    const binding = await bindLocalWorkspace({
      projectId: project.id,
      rootPath: workspaceRoot,
    }, dataDir);

    expect(binding).toMatchObject({
      projectId: project.id,
      status: "resolved",
      permissions: {
        read: true,
        write: false,
        delete: false,
        execute: false,
        gitWrite: false,
      },
    });
    await expect(getLocalProject(project.id, dataDir)).resolves.toMatchObject({
      workspaceBindingId: binding.id,
    });
    await expect(getLocalWorkspaceBinding(project.id, dataDir)).resolves.toMatchObject({
      id: binding.id,
      status: "resolved",
    });
  });

  it("marks a deleted workspace missing", async () => {
    const project = await createLocalProject({
      name: "Missing",
      prompt: "",
      model: "",
    }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspaceRoot }, dataDir);
    await fs.rm(workspaceRoot, {
      maxRetries: 5,
      recursive: true,
      retryDelay: 50,
    });

    const binding = await getLocalWorkspaceBinding(project.id, dataDir);
    expect(binding).toMatchObject({ status: "missing" });
    expect(canUseWorkspaceCapability(binding!, "read")).toBe(false);
  });

  it("resets elevated permissions when relinking to a different directory", async () => {
    const project = await createLocalProject({
      name: "Relink",
      prompt: "",
      model: "",
    }, dataDir);
    const first = await bindLocalWorkspace({
      projectId: project.id,
      rootPath: workspaceRoot,
    }, dataDir);
    const bindingPath = path.join(
      dataDir,
      "projects",
      project.id,
      "workspace",
      "binding.json",
    );
    await fs.writeFile(bindingPath, JSON.stringify({
      ...first,
      permissions: { ...first.permissions, write: true },
    }), "utf8");
    const otherRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-other-root-"));
    try {
      const rebound = await bindLocalWorkspace({
        projectId: project.id,
        rootPath: otherRoot,
      }, dataDir);
      expect(rebound.permissions).toEqual({
        read: true,
        write: false,
        delete: false,
        execute: false,
        gitWrite: false,
      });
    } finally {
      await fs.rm(otherRoot, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 50,
      });
    }
  });

  it("detects a different directory replacing the bound path", async () => {
    const project = await createLocalProject({
      name: "Mismatch",
      prompt: "",
      model: "",
    }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspaceRoot }, dataDir);
    await fs.rm(workspaceRoot, {
      maxRetries: 5,
      recursive: true,
      retryDelay: 50,
    });
    await fs.mkdir(workspaceRoot);
    await fs.writeFile(path.join(workspaceRoot, "different.txt"), "different", "utf8");

    await expect(getLocalWorkspaceBinding(project.id, dataDir)).resolves.toMatchObject({
      status: "identity_mismatch",
    });
  });

  it("unbinds without deleting any workspace content", async () => {
    const project = await createLocalProject({
      name: "Unbind",
      prompt: "",
      model: "",
    }, dataDir);
    await bindLocalWorkspace({ projectId: project.id, rootPath: workspaceRoot }, dataDir);
    await unbindLocalWorkspace(project.id, dataDir);

    await expect(getLocalWorkspaceBinding(project.id, dataDir)).resolves.toBeNull();
    await expect(fs.readFile(path.join(workspaceRoot, "README.md"), "utf8"))
      .resolves.toBe("workspace");
  });
});
