import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalProject } from "@/lib/local/project-repository";
import {
  addLocalWorkspaceRoot,
  bindLocalWorkspace,
  setLocalWorkspaceRootPermissions,
  setLocalWorkspacePermissions,
} from "@/lib/local/workspace-repository";
import {
  applyWorkspaceChangeSet,
  approveWorkspaceChangeSet,
  createWorkspaceChangeSet,
  listWorkspaceChangeSets,
  rejectWorkspaceChangeSet,
  revertWorkspaceChangeSet,
} from "@/lib/workspace/change-sets";
import { getContinuousGlobalAgentState } from "@/lib/global-agent/continuous-store";

let dataDir: string;
let workspaceRoot: string;
let additionalRoot: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-changeset-data-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-changeset-root-"));
  additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-changeset-additional-root-"));
  await fs.writeFile(path.join(workspaceRoot, "a.txt"), "alpha\n", "utf8");
  await fs.writeFile(path.join(workspaceRoot, "b.txt"), "bravo\n", "utf8");
  await fs.writeFile(path.join(additionalRoot, "a.txt"), "additional alpha\n", "utf8");
  const project = await createLocalProject({ name: "ChangeSets", prompt: "", model: "" }, dataDir);
  projectId = project.id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
  await setLocalWorkspacePermissions({
    permissions: { delete: true, write: true },
    projectId,
  }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
  await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
});

describe("workspace ChangeSets", () => {
  it("isolates the same relative path by stable root id and enforces that root's permissions", async () => {
    const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
    const rootId = binding.additionalRoots?.[0]?.id;
    expect(rootId).toBeTruthy();
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      rootId,
      title: "Update additional root",
      operations: [{ kind: "modify", relativePath: "a.txt", proposedContent: "changed additional\n" }],
    }, dataDir);
    expect(changeSet.rootId).toBe(rootId);
    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await expect(applyWorkspaceChangeSet(projectId, changeSet.id, dataDir))
      .rejects.toMatchObject({ code: "write_not_allowed" });

    await setLocalWorkspaceRootPermissions({
      projectId,
      rootId: rootId!,
      permissions: { write: true },
    }, dataDir);
    await applyWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await expect(fs.readFile(path.join(additionalRoot, "a.txt"), "utf8")).resolves.toBe("changed additional\n");
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha\n");
  }, 15_000);

  it("preserves unknown ChangeSet store and record fields during a forward-compatible write", async () => {
    const first = await createWorkspaceChangeSet({
      projectId,
      title: "First",
      operations: [{ kind: "modify", relativePath: "a.txt", proposedContent: "first\n" }],
    }, dataDir);
    const storePath = path.join(dataDir, "projects", projectId, "workspace", "change-sets.json");
    const stored = JSON.parse(await fs.readFile(storePath, "utf8")) as Record<string, unknown> & { changeSets: Array<Record<string, unknown>> };
    stored.futureStoreField = true;
    stored.changeSets[0].futureChangeSetField = "preserve-me";
    await fs.writeFile(storePath, JSON.stringify(stored), "utf8");

    await createWorkspaceChangeSet({
      projectId,
      title: "Second",
      operations: [{ kind: "modify", relativePath: "b.txt", proposedContent: "second\n" }],
    }, dataDir);
    const rewritten = JSON.parse(await fs.readFile(storePath, "utf8")) as Record<string, unknown> & { changeSets: Array<Record<string, unknown>> };
    expect(rewritten.futureStoreField).toBe(true);
    expect(rewritten.changeSets.find((changeSet) => changeSet.id === first.id)?.futureChangeSetField).toBe("preserve-me");
  });

  it("persists, approves and atomically applies a multi-file proposal", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "Update files",
      operations: [
        { kind: "modify", relativePath: "a.txt", proposedContent: "alpha 2\n" },
        { kind: "create", relativePath: "c.txt", proposedContent: "charlie\n" },
        { kind: "delete", relativePath: "b.txt" },
      ],
    }, dataDir);
    expect(changeSet.status).toBe("proposed");
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: changeSet.id, operations: expect.any(Array) }),
    ]);

    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    const applied = await applyWorkspaceChangeSet(projectId, changeSet.id, dataDir);

    expect(applied.status).toBe("applied");
    await expect(getContinuousGlobalAgentState(projectId, dataDir)).resolves.toMatchObject({
      events: [
        expect.objectContaining({ type: "changeSet.changed", sourceId: changeSet.id, data: expect.objectContaining({ status: "proposed" }) }),
        expect.objectContaining({ type: "changeSet.changed", sourceId: changeSet.id, data: expect.objectContaining({ status: "approved" }) }),
        expect.objectContaining({ type: "changeSet.changed", sourceId: changeSet.id, data: expect.objectContaining({ status: "applied" }) }),
      ],
    });
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha 2\n");
    await expect(fs.readFile(path.join(workspaceRoot, "c.txt"), "utf8")).resolves.toBe("charlie\n");
    await expect(fs.stat(path.join(workspaceRoot, "b.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks apply when any baseline changed and writes nothing", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "Conflicting update",
      operations: [
        { kind: "modify", relativePath: "a.txt", proposedContent: "mine\n" },
        { kind: "modify", relativePath: "b.txt", proposedContent: "mine b\n" },
      ],
    }, dataDir);
    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await fs.writeFile(path.join(workspaceRoot, "b.txt"), "external\n", "utf8");

    await expect(applyWorkspaceChangeSet(projectId, changeSet.id, dataDir))
      .rejects.toMatchObject({ code: "version_conflict" });
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha\n");
    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: changeSet.id, status: "conflict" }),
    ]);
  });

  it("reverts an applied create, modify, delete and rename group", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "All operations",
      operations: [
        { kind: "modify", relativePath: "a.txt", proposedContent: "updated\n" },
        { kind: "rename", relativePath: "b.txt", targetRelativePath: "renamed.txt" },
        { kind: "create", relativePath: "new.txt", proposedContent: "new\n" },
      ],
    }, dataDir);
    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await applyWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    const reverted = await revertWorkspaceChangeSet(projectId, changeSet.id, dataDir);

    expect(reverted.status).toBe("reverted");
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha\n");
    await expect(fs.readFile(path.join(workspaceRoot, "b.txt"), "utf8")).resolves.toBe("bravo\n");
    await expect(fs.stat(path.join(workspaceRoot, "renamed.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(workspaceRoot, "new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("restores proposed review after restart and supports rejection", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "Review later",
      operations: [{ kind: "modify", relativePath: "a.txt", proposedContent: "later\n" }],
    }, dataDir);

    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: changeSet.id, status: "proposed" }),
    ]);
    await expect(rejectWorkspaceChangeSet(projectId, changeSet.id, dataDir)).resolves.toMatchObject({
      status: "rejected",
    });
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha\n");
  });

  it("rolls back an interrupted multi-file apply when the store is read after restart", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "Interrupted apply",
      operations: [
        { kind: "modify", relativePath: "a.txt", proposedContent: "changed\n" },
        { kind: "delete", relativePath: "b.txt" },
      ],
    }, dataDir);
    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await setPersistedStatus(changeSet.id, "applying");
    await fs.writeFile(path.join(workspaceRoot, "a.txt"), "changed\n", "utf8");

    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({
        id: changeSet.id,
        status: "conflict",
        error: expect.stringContaining("已自动恢复"),
      }),
    ]);
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha\n");
    await expect(fs.readFile(path.join(workspaceRoot, "b.txt"), "utf8")).resolves.toBe("bravo\n");
  });

  it("finishes an interrupted revert after restart", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "Interrupted revert",
      operations: [
        { kind: "modify", relativePath: "a.txt", proposedContent: "changed\n" },
        { kind: "create", relativePath: "c.txt", proposedContent: "created\n" },
      ],
    }, dataDir);
    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await applyWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await setPersistedStatus(changeSet.id, "reverting");
    await fs.rm(path.join(workspaceRoot, "c.txt"));

    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({ id: changeSet.id, status: "reverted" }),
    ]);
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("alpha\n");
    await expect(fs.stat(path.join(workspaceRoot, "c.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite an unknown external state during interrupted recovery", async () => {
    const changeSet = await createWorkspaceChangeSet({
      projectId,
      title: "Unknown recovery state",
      operations: [{ kind: "modify", relativePath: "a.txt", proposedContent: "changed\n" }],
    }, dataDir);
    await approveWorkspaceChangeSet(projectId, changeSet.id, dataDir);
    await setPersistedStatus(changeSet.id, "applying");
    await fs.writeFile(path.join(workspaceRoot, "a.txt"), "external\n", "utf8");

    await expect(listWorkspaceChangeSets(projectId, dataDir)).resolves.toEqual([
      expect.objectContaining({
        id: changeSet.id,
        status: "conflict",
        error: expect.stringContaining("无法确认"),
      }),
    ]);
    await expect(fs.readFile(path.join(workspaceRoot, "a.txt"), "utf8")).resolves.toBe("external\n");
  });

  async function setPersistedStatus(changeSetId: string, status: "applying" | "reverting") {
    const storePath = path.join(dataDir, "projects", projectId, "workspace", "change-sets.json");
    const store = JSON.parse(await fs.readFile(storePath, "utf8")) as {
      changeSets: Array<{ id: string; status: string; updatedAt: string }>;
    };
    const entry = store.changeSets.find((candidate) => candidate.id === changeSetId);
    if (!entry) throw new Error("ChangeSet fixture missing");
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    await fs.writeFile(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }
});
