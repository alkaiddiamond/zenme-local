import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalProject } from "@/lib/local/project-repository";
import {
  addLocalWorkspaceRoot,
  bindLocalWorkspace,
  setLocalWorkspaceRootPermissions,
  setLocalWorkspaceWritePermission,
} from "@/lib/local/workspace-repository";
import {
  MAX_WORKSPACE_TEXT_BYTES,
  listWorkspaceFiles,
  openWorkspaceFileDocument,
  readWorkspaceFileDocument,
  saveWorkspaceFileDocument,
  WorkspaceFileError,
} from "@/lib/workspace/workspace-files";

const execFileAsync = promisify(execFile);
let dataDir: string;
let workspaceRoot: string;
let projectId: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-live-file-data-"));
  workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-live-file-root-"));
  await fs.mkdir(path.join(workspaceRoot, "src"));
  await fs.writeFile(path.join(workspaceRoot, "src", "app.ts"), "export const app = 1;\n");
  const project = await createLocalProject({ name: "Live files", prompt: "", model: "" }, dataDir);
  projectId = project.id;
  await bindLocalWorkspace({ projectId, rootPath: workspaceRoot }, dataDir);
});

afterEach(async () => {
  await fs.rm(dataDir, { force: true, recursive: true });
  await fs.rm(workspaceRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
});

describe("workspace live files", () => {
  it("lists Git-visible files and honors .gitignore", async () => {
    await fs.writeFile(path.join(workspaceRoot, ".gitignore"), "ignored.txt\n");
    await fs.writeFile(path.join(workspaceRoot, "ignored.txt"), "ignored");
    await execFileAsync("git", ["init", workspaceRoot], { windowsHide: true });

    const entries = await listWorkspaceFiles(projectId, dataDir);

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "directory", relativePath: "src" }),
      expect.objectContaining({ kind: "file", relativePath: "src/app.ts" }),
      expect.objectContaining({ kind: "file", relativePath: ".gitignore" }),
    ]));
    expect(entries.some((entry) => entry.relativePath === "ignored.txt")).toBe(false);
    expect(entries.some((entry) => entry.relativePath.startsWith(".git/"))).toBe(false);
  });

  it("limits Git discovery to a Workspace bound below the repository root", async () => {
    const nestedRoot = path.join(workspaceRoot, "nested-workspace");
    await fs.mkdir(nestedRoot);
    await fs.writeFile(path.join(nestedRoot, "inside.txt"), "inside\n");
    await fs.writeFile(path.join(workspaceRoot, "outside.txt"), "outside\n");
    await execFileAsync("git", ["init", workspaceRoot], { windowsHide: true });
    await bindLocalWorkspace({ projectId, rootPath: nestedRoot }, dataDir);

    const entries = await listWorkspaceFiles(projectId, dataDir);

    expect(entries).toContainEqual(expect.objectContaining({
      kind: "file",
      relativePath: "inside.txt",
    }));
    expect(entries.some((entry) => entry.relativePath.includes("outside.txt"))).toBe(false);
    expect(entries.some((entry) => entry.relativePath.startsWith("nested-workspace/"))).toBe(false);
  });

  it("honors .gitignore before a workspace becomes a Git repository", async () => {
    await fs.writeFile(path.join(workspaceRoot, ".gitignore"), "*.log\ntemp/\n");
    await fs.writeFile(path.join(workspaceRoot, "debug.log"), "ignored");
    await fs.mkdir(path.join(workspaceRoot, "temp"));
    await fs.writeFile(path.join(workspaceRoot, "temp", "draft.txt"), "ignored");

    const entries = await listWorkspaceFiles(projectId, dataDir);

    expect(entries.some((entry) => entry.relativePath === "debug.log")).toBe(false);
    expect(entries.some((entry) => entry.relativePath.startsWith("temp"))).toBe(false);
    expect(entries.some((entry) => entry.relativePath === "src/app.ts")).toBe(true);
  });

  it("reuses one File Document and observes modification and rename", async () => {
    const first = await openWorkspaceFileDocument({ projectId, relativePath: "src/app.ts" }, dataDir);
    const duplicate = await openWorkspaceFileDocument({ projectId, relativePath: "src/app.ts" }, dataDir);
    expect(duplicate.document.id).toBe(first.document.id);
    expect(first).toMatchObject({ content: "export const app = 1;\n", contentKind: "text" });

    await fs.writeFile(path.join(workspaceRoot, "src", "app.ts"), "export const app = 2;\n");
    await expect(readWorkspaceFileDocument(projectId, first.document.id, dataDir)).resolves.toMatchObject({
      change: "modified",
      content: "export const app = 2;\n",
    });

    await fs.rename(path.join(workspaceRoot, "src", "app.ts"), path.join(workspaceRoot, "src", "main.ts"));
    await expect(readWorkspaceFileDocument(projectId, first.document.id, dataDir)).resolves.toMatchObject({
      change: "renamed",
      document: { id: first.document.id, relativePath: "src/main.ts" },
    });
  }, 15_000);

  it("uses rootId plus relativePath as the Live File identity", async () => {
    const additionalRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zenme-live-file-additional-"));
    try {
      await fs.mkdir(path.join(additionalRoot, "src"));
      await fs.writeFile(path.join(additionalRoot, "src", "app.ts"), "export const app = 2;\n", "utf8");
      const binding = await addLocalWorkspaceRoot({ projectId, rootPath: additionalRoot }, dataDir);
      const rootId = binding.additionalRoots![0].id;

      const primary = await openWorkspaceFileDocument({ projectId, relativePath: "src/app.ts" }, dataDir);
      const additional = await openWorkspaceFileDocument({ projectId, rootId, relativePath: "src/app.ts" }, dataDir);
      expect(additional.document.id).not.toBe(primary.document.id);
      expect(primary).toMatchObject({ content: "export const app = 1;\n", document: { rootId: binding.id } });
      expect(additional).toMatchObject({ content: "export const app = 2;\n", document: { rootId } });
      expect((await listWorkspaceFiles(projectId, dataDir, rootId)).every((entry) => entry.rootId === rootId)).toBe(true);

      await expect(saveWorkspaceFileDocument({
        projectId,
        documentId: additional.document.id,
        expectedHash: additional.contentHash!,
        content: "export const app = 3;\n",
      }, dataDir)).rejects.toMatchObject({ code: "write_not_allowed" });
      await setLocalWorkspaceRootPermissions({ projectId, rootId, permissions: { write: true } }, dataDir);
      await expect(saveWorkspaceFileDocument({
        projectId,
        documentId: additional.document.id,
        expectedHash: additional.contentHash!,
        content: "export const app = 3;\n",
      }, dataDir)).resolves.toMatchObject({ content: "export const app = 3;\n" });
      await expect(fs.readFile(path.join(workspaceRoot, "src", "app.ts"), "utf8"))
        .resolves.toBe("export const app = 1;\n");
    } finally {
      await fs.rm(additionalRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 50 });
    }
  }, 15_000);

  it("reports deleted, binary and large files without returning unsafe content", async () => {
    await fs.writeFile(path.join(workspaceRoot, "binary.dat"), Buffer.from([1, 0, 2]));
    await fs.writeFile(path.join(workspaceRoot, "large.txt"), Buffer.alloc(MAX_WORKSPACE_TEXT_BYTES + 1, 65));
    const binary = await openWorkspaceFileDocument({ projectId, relativePath: "binary.dat" }, dataDir);
    const large = await openWorkspaceFileDocument({ projectId, relativePath: "large.txt" }, dataDir);
    expect(binary).toMatchObject({ content: null, contentKind: "binary" });
    expect(large).toMatchObject({ content: null, contentKind: "large" });

    await fs.rm(path.join(workspaceRoot, "binary.dat"));
    await expect(readWorkspaceFileDocument(projectId, binary.document.id, dataDir)).resolves.toMatchObject({
      status: "deleted",
      contentKind: "missing",
    });
  });

  it("marks credential-like files as sensitive", async () => {
    await fs.writeFile(path.join(workspaceRoot, ".env.local"), "SECRET=value");
    const entries = await listWorkspaceFiles(projectId, dataDir);
    expect(entries).toContainEqual(expect.objectContaining({
      relativePath: ".env.local",
      sensitive: true,
    }));
  });

  it("atomically saves user edits only with write capability and preserves CRLF", async () => {
    const opened = await openWorkspaceFileDocument({ projectId, relativePath: "src/app.ts" }, dataDir);
    await expect(saveWorkspaceFileDocument({
      content: "first\r\nsecond\r\n",
      documentId: opened.document.id,
      expectedHash: opened.contentHash!,
      projectId,
    }, dataDir)).rejects.toMatchObject({ code: "write_not_allowed" });

    await setLocalWorkspaceWritePermission({ allowed: true, projectId }, dataDir);
    const saved = await saveWorkspaceFileDocument({
      content: "first\r\nsecond\r\n",
      documentId: opened.document.id,
      expectedHash: opened.contentHash!,
      projectId,
    }, dataDir);

    expect(saved).toMatchObject({ content: "first\r\nsecond\r\n", writable: true });
    await expect(fs.readFile(path.join(workspaceRoot, "src", "app.ts"), "utf8"))
      .resolves.toBe("first\r\nsecond\r\n");
  });

  it("round-trips empty and UTF-8 LF text without changing line endings", async () => {
    await fs.writeFile(path.join(workspaceRoot, "empty.txt"), "", "utf8");
    await setLocalWorkspaceWritePermission({ allowed: true, projectId }, dataDir);
    const empty = await openWorkspaceFileDocument({ projectId, relativePath: "empty.txt" }, dataDir);
    expect(empty).toMatchObject({ content: "", contentKind: "text" });

    const saved = await saveWorkspaceFileDocument({
      content: "第一行\n第二行\n",
      documentId: empty.document.id,
      expectedHash: empty.contentHash!,
      projectId,
    }, dataDir);

    expect(saved.content).toBe("第一行\n第二行\n");
    await expect(fs.readFile(path.join(workspaceRoot, "empty.txt"), "utf8"))
      .resolves.toBe("第一行\n第二行\n");
  });

  it("preserves unknown File Document store and document fields during a forward-compatible write", async () => {
    const first = await openWorkspaceFileDocument({ projectId, relativePath: "src/app.ts" }, dataDir);
    const storePath = path.join(dataDir, "projects", projectId, "workspace", "documents.json");
    const stored = JSON.parse(await fs.readFile(storePath, "utf8")) as Record<string, unknown> & { documents: Array<Record<string, unknown>> };
    stored.futureStoreField = { enabled: true };
    stored.documents[0].futureDocumentField = "preserve-me";
    await fs.writeFile(storePath, JSON.stringify(stored), "utf8");
    await fs.writeFile(path.join(workspaceRoot, "second.txt"), "second\n", "utf8");

    await openWorkspaceFileDocument({ projectId, relativePath: "second.txt" }, dataDir);
    const rewritten = JSON.parse(await fs.readFile(storePath, "utf8")) as Record<string, unknown> & { documents: Array<Record<string, unknown>> };
    expect(rewritten.futureStoreField).toEqual({ enabled: true });
    expect(rewritten.documents.find((document) => document.id === first.document.id)?.futureDocumentField).toBe("preserve-me");
  });

  it("refuses to overwrite an unknown external version", async () => {
    await setLocalWorkspaceWritePermission({ allowed: true, projectId }, dataDir);
    const opened = await openWorkspaceFileDocument({ projectId, relativePath: "src/app.ts" }, dataDir);
    await fs.writeFile(path.join(workspaceRoot, "src", "app.ts"), "external version\n", "utf8");

    await expect(saveWorkspaceFileDocument({
      content: "my version\n",
      documentId: opened.document.id,
      expectedHash: opened.contentHash!,
      projectId,
    }, dataDir)).rejects.toBeInstanceOf(WorkspaceFileError);
    await expect(saveWorkspaceFileDocument({
      content: "my version\n",
      documentId: opened.document.id,
      expectedHash: opened.contentHash!,
      projectId,
    }, dataDir)).rejects.toMatchObject({ code: "version_conflict" });
    await expect(fs.readFile(path.join(workspaceRoot, "src", "app.ts"), "utf8"))
      .resolves.toBe("external version\n");
  });
});
